import type { Request, Response } from 'express'
import * as cookie from 'cookie'
import { COOKIE_NAME_DID, COOKIE_NAME_SID, Environment, addCookie, assertPath, getAuthClientMountPath, getAuthOrigin, getCustomHeaderNames, getMainAuthDomain, getMainAuthDomainVariants, getOrigin } from '@onelyid/common'
import { AuthMiddlewareConfig, UserInfo } from './types/common';

// List of cookie names which are allowed to be forwarded (from the obtained proxy response)
const allowedCookiesNames = new Set([COOKIE_NAME_SID, COOKIE_NAME_DID])

export async function initAuthFlow(req: Request, res: Response, config: AuthMiddlewareConfig | undefined) {
  const searchParams = new URLSearchParams(req.query as Record<string, string>)
  const redirectUrl = searchParams.get('continue') || '/'
  if (await req.getAuth()) {
    return res.redirect(redirectUrl)
  }

  const authOriginObj = getAuthOrigin(req)
  const authClientMountPath = getAuthClientMountPath()
  const { isMainAuthDomainVariant } = getMainAuthDomainVariants(req)

  if (authOriginObj && !isMainAuthDomainVariant) {
    const authOrigin = authOriginObj.authOrigin
    let continueUrl = config?.loginRedirect
    if (!continueUrl) {
      continueUrl = req.get('referer')
    }
    if (!continueUrl) {
      continueUrl = `${getOrigin(req)}${req.originalUrl}`
    }
    const redirectUrl = new URL(`${authOrigin}${authClientMountPath}/login/redirect`)
    redirectUrl.searchParams.set('continue', continueUrl)
    redirectUrl.searchParams.set('origin_id', res.locals.origin_id ?? '')
    if (req.mode) {
      redirectUrl.searchParams.set('request_mode', req.mode)
    }
    return res.redirect(redirectUrl.href)
  }
  res.redirect('/')
}

async function authSessionApi<T extends object>(route: string, req: Request, res?: Response, body?: object | null) {
  type RetType = Partial<T & { ok?: boolean, error?: string }>

  const isPost = typeof body !== 'undefined'
  const authClientMountPath = getAuthClientMountPath()
  const customHeaders = getCustomHeaderNames()

  const authOriginObj = getAuthOrigin(req);
  if (!authOriginObj) {
    return { ok: true } as RetType
  }

  const routePath = assertPath(route)
  const mainAuthDomain = getMainAuthDomain(req)
  if (authOriginObj && routePath) {
    const authOrigin = authOriginObj.authOrigin
    const apiUrl = `${authOrigin}${authClientMountPath}${routePath}`
    try {
      const resp = await fetch(apiUrl, {
        method: isPost ? 'POST' : 'GET',
        headers: {
          /**
           * Note:
           * On Node.js (v18+), the built-in 'fetch' (powered by Undici) does NOT block
           * manually setting the `Cookie` header in server context, unlike in browsers.
           */
          Cookie: req.headers.cookie ?? '',
          Accept: 'application/json',
          [customHeaders.requestMode]: req.mode || Environment.Prod,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      if (res) {
        const cookiesToForward = resp.headers.getSetCookie().filter((c) => {
          const parsed = cookie.parseSetCookie(c)
          return allowedCookiesNames.has(parsed.name)
        })
        for (const setCookie of cookiesToForward) {
          addCookie(res, setCookie)
        }
      }

      const respText = await resp.text()

      let data: RetType | null = null;
      try {
        data = JSON.parse(respText) as RetType
      } catch(e) {}

      if (typeof data?.ok !== 'undefined') {
        return data
      } else {
        req.ctx.logger.debug('resp:', respText);
        return { error: `Invalid response for api call for ${apiUrl} [${req.path}] (${mainAuthDomain})` } as RetType
      }
    } catch(err: any) {
      req.ctx.logger.error(err)
      return { error: `Error during auth session api call for ${apiUrl} [${req.path}] (${mainAuthDomain})` } as RetType
    }
  }

  return { error: `Invalid auth session api call for ${authOriginObj?.authOrigin} [${routePath}] (${mainAuthDomain})` } as RetType
}

export async function getSessionUser(req: Request, res: Response) {
  return authSessionApi<{ user?: UserInfo | null }>('/userinfo', req, res)
}

export async function destroySession(req: Request, res: Response) {
  return authSessionApi<{}>('/logout', req, res, null)
}
