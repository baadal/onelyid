import { IncomingMessage, ServerResponse } from 'node:http'
import * as cookie from 'cookie'
import type { Request, Response, NextFunction } from 'express'
import { baseCookieDomain, getAuthClientMountPath, getHostname, getOrigin, isLocalHostname, isProductionEnv } from './host'
import { addCookie } from './cookie'
import { unpackObject } from './convert'
import { COOKIE_NAME_DID, COOKIE_NAME_TID, COOKIE_NAME_UID } from './const-export'
import { addRedirectTraceCookie } from './response'
import { getUuid } from './utils'
import { AUTH_CLIENT_NAME, APP_CLIENT_NAME } from './const-export'

export type MetadataOptions = {
  loggerName: string,
  mode?: 'prod' | 'uat',
  deferLog?: boolean
}

export function getRequestMetadata(_req: IncomingMessage, _res: ServerResponse, options: MetadataOptions) {
  const req = _req as Request;
  const res = _res as Response;

  const isAuthClient = options.loggerName === AUTH_CLIENT_NAME
  const isAppClient = options.loggerName === APP_CLIENT_NAME

  const hostname = getHostname(req)
  const reqOrigin = getOrigin(req)
  const isLocalhost = isLocalHostname(hostname)
  const authClientMountPath = getAuthClientMountPath()

  const request_id  = getUuid()

  let origin_id: string | undefined
  let did: string | undefined
  let trace_id: string | undefined

  if (req.headers.cookie) {
    const cookieObj = cookie.parseCookie(req.headers.cookie)
    if (cookieObj[COOKIE_NAME_TID]) {
      const { value, path, origin } = unpackObject<string>(cookieObj[COOKIE_NAME_TID]) ?? {}
      if (path === req.path && (!origin || origin === reqOrigin)) {
        trace_id = value

        // Delete cookie
        // NOTE: (name, path, domain) must match for removing the cookie
        // Ref: packages/client/src/middleware.ts::res.redirect
        addRedirectTraceCookie(req, res, {
          maxAgeSecs: 0, // expire immediately (delete cookie)
          path,
        })
      }
    }
    if (cookieObj[COOKIE_NAME_UID]) {
      origin_id = cookieObj[COOKIE_NAME_UID]
    }
    if (cookieObj[COOKIE_NAME_DID]) {
      did = cookieObj[COOKIE_NAME_DID]
    }
  }

  if (!trace_id) {
    trace_id = getUuid()
  }
  res.locals.trace_id = trace_id

  if (req.path === '/login' && req.method === 'GET') {
    const searchParams = new URLSearchParams(req.query as Record<string, string>)
    const state = searchParams.get('state') ?? ''
    if (state) {
      const stateObj = unpackObject<string>(state)
      if (stateObj?.originId) {
        // Use origin_id from query state (ignore origin_id from cookie header) on mainAuthDomain
        origin_id = stateObj.originId
      }
    }
  } else if (req.path === `${authClientMountPath}/login` && req.method === 'POST') {
    // NOTE: Cookie header (origin_id) is not sent for cross-origin POST redirection
    if (req.body?.origin_id) {
      // Use origin_id of form submission from mainAuthDomain
      origin_id = req.body?.origin_id
    }
  }
  if (!origin_id) {
    origin_id = getUuid()

    const cookieBaseDomain = baseCookieDomain(req)
    addCookie(res, cookie.stringifySetCookie({
      name: COOKIE_NAME_UID,
      value: origin_id,
      domain: cookieBaseDomain, // undefined means 'Host-only' cookie
      path: '/',
      secure: !isLocalhost && isProductionEnv(),
      sameSite: 'lax',
      // httpOnly: true, // Do not set to make the cookie accessible to client-side script
      maxAge: 60 * 60 * 24 * 180, // 180 days
    }))
  }
  res.locals.origin_id = origin_id

  // override log context
  if (options.deferLog) {
    origin_id = ''
    res.locals.origin_id = origin_id
  }

  const [path, params = ''] = req.originalUrl.split('?', 2);

  const referer = req.headers.referer ?? ''

  let requestType = ''
  if (isAuthClient) {
    requestType = 'request-auth'
  } else if (isAppClient) {
    requestType = 'request-app'
  }
  if (referer) {
    const refererUrl = new URL(referer)
    if (refererUrl.protocol === 'http:') {
      if (reqOrigin === refererUrl.origin.replace('http:', 'https:')) {
        requestType = 'sus'
      }
    }
  }

  return {
    request_id,
    trace_id,
    origin_id,
    mode: options.mode ?? '',
    type: requestType,
    method: req.method,
    path,
    params,
    host: req.get('host') ?? '',
    origin: reqOrigin,
    cookie: req.headers.cookie ?? '',
    referer,
    client_ip: req.ip ?? '',  // `req.ip` (by Express) is proxy-aware version of `req.socket.remoteAddress` (by TCP socket)
    ...(did ? { did } : {})
  }
}

function isSpeculativeReq(req: Request): boolean {
  const purpose = req.get('Sec-Purpose') ?? req.get('Purpose')
  const parts = purpose?.split(/[;,]/) ?? []
  const isSpeculative = parts.includes('prefetch') || parts.includes('prerender')
  return isSpeculative
}

function isDevtoolsReq(req: Request): boolean {
  return req.method === 'GET' &&
    req.path === '/.well-known/appspecific/com.chrome.devtools.json'
}

function isSpamReq(req: Request): boolean {
  const list1 = ['wp-includes', 'wp-content', 'wp-admin', 'wp-json']
  const list2 = ['cgi-bin', '.git', '.well-known', 'public', 'media', 'uploads']

  const path = req.path.toLowerCase()

  // e.g. `/wp-login.php`, `/xmlrpc.php`, `/.env`, `/admin.php.`
  const isPhp = path.endsWith('.php') || path.endsWith('.php7') || path.endsWith('.php8') || path.endsWith('.php/') || path.endsWith('/php.ini')
  const isEnv = path.endsWith('.env')
  const isInvalid = path.endsWith('.')
  if (isPhp || isEnv || isInvalid) {
    return true
  }

  // e.g. `/wp-admin/login`, `/data/wp-json/users`
  const isList1 = list1.some(term => path.includes(term))
  if (isList1) {
    return true
  }

  // e.g. `/cgi-bin/page.html`, `/.git/config`
  const isList2 = list2.some(term => path.startsWith(`/${term}/`))
  if (isList2) {
    return true
  }

  return false
}

function isStaticFileReq(req: Request): boolean {
  const path = req.path.toLowerCase()

  const allowList = ['/robots.txt']
  if (allowList.includes(path)) {
    return false
  }

  const extList = ['.html', '.css', '.js', '.txt', '.ico', '.png', '.jpg', '.jpeg', '.gif']
  return extList.some(ext => path.endsWith(ext))
}

function isAuthClientReq(req: Request): boolean {
  const authClientMountPath = getAuthClientMountPath()
  return req.path === '/oauth-client-metadata.json' || req.path.startsWith(authClientMountPath)
}

export function isIgnoreRequest(req: Request, res: Response, next: NextFunction): boolean {
  const isAuthClientRequest = isAuthClientReq(req)

  const isSpeculative = isSpeculativeReq(req)
  if (isSpeculative) {
    // NOTE: Just block or allow all speculative requests
    const blockSpeculativeRequests = true

    // NOTE: Blocking only a subset of speculative requests, and allowing others using `next()`
    // based on `isAuthClientRequest` might render (and cache) the speculative request incorrectly,
    // possibly causing inconsistent behavior.
    if (blockSpeculativeRequests) {
      res.set({ 'Cache-Control': 'no-store, max-age=0' })
      res.status(204).end()  // No Content
      return true
    }
  }

  const isDevtoolsRequest = isDevtoolsReq(req)
  const isSpamRequest = isSpamReq(req)
  const isStaticFileRequest = isStaticFileReq(req)
  const skipAuthMiddleware = isDevtoolsRequest || isSpamRequest || isStaticFileRequest
  if (skipAuthMiddleware) {
    if (isAuthClientRequest) {
      res.status(404).send('Not Found')
    } else {
      next()
    }
    return true
  }

  return false
}
