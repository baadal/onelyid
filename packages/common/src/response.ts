import * as cookie from 'cookie'
import type { Request, Response } from 'express'
import { baseCookieDomain, getHostname, isLocalHostname, isProductionEnv } from './host'
import { addCookie } from './cookie'
import { COOKIE_NAME_TID, TEST_ORIGIN } from './const-export'
import { packObject } from './convert'

export function getCustomRedirectFunc(req: Request, res: Response) {
  const originalRedirect = res.redirect.bind(res)
  return ((...args: [string] | [number, string]) => {
    let statusCode = 200
    let redirUrl
    if (args.length === 1) {
      redirUrl = args[0]
    } else {
      statusCode = args[0]
      redirUrl = args[1]
    }

    const url = new URL(redirUrl, TEST_ORIGIN)

    const trace_id = res.locals.trace_id
    const trace_path = url.pathname
    const trace_origin = url.origin === TEST_ORIGIN ? '' : url.origin
    const value = packObject({ value: trace_id, path: trace_path, origin: trace_origin })
    addRedirectTraceCookie(req, res, { maxAgeSecs: 10, path: trace_path, value })

    if (args.length === 1) {
      return originalRedirect(redirUrl)
    } else {
      return originalRedirect(statusCode, redirUrl)
    }
  }) as typeof res.redirect
}

export function addRedirectTraceCookie(req: Request, res: Response, opts: { maxAgeSecs: number, path: string, value?: string }) {
  const hostname = getHostname(req)
  const isLocalhost = isLocalHostname(hostname)

  const cookieBaseDomain = baseCookieDomain(req)
  addCookie(res, cookie.stringifySetCookie({
    name: COOKIE_NAME_TID,
    value: opts.value || '',
    domain: cookieBaseDomain, // undefined means 'Host-only' cookie
    path: opts.path || '/', // In practice, any subpath would also be able to access this cookie, e.g. `/` --> `/@onelyid/client/userinfo`
    secure: !isLocalhost && isProductionEnv(),
    sameSite: 'lax',
    httpOnly: true,
    maxAge: opts.maxAgeSecs,
  }))
}
