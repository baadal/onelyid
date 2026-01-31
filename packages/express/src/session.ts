import type { Request, Response } from 'express'
import { assertPath, getBaseDomain, getOrigin } from '@onelyid/common'
import { AuthMiddlewareConfig, UserInfo } from './types/common';

const DEFAULT_AUTH_SUBDOMAIN = 'auth'
const DEFAULT_MOUNT_PATH = '/auth'

export async function initAuthFlow(req: Request, res: Response, config?: AuthMiddlewareConfig) {
  const hostname = req.hostname
  const baseDomain = getBaseDomain(hostname);

  const authDomain = baseDomain ? `${DEFAULT_AUTH_SUBDOMAIN}.${baseDomain}` : undefined
  if (authDomain) {
    let continueUrl = config?.loginRedirect
    if (!continueUrl) {
      continueUrl = req.get('referer')
    }
    if (!continueUrl) {
      continueUrl = `${getOrigin(req)}${req.originalUrl}`
    }
    const redirectUrl = new URL(`https://${authDomain}/login`)
    redirectUrl.searchParams.set('continue', continueUrl)
    return res.redirect(redirectUrl.href)
  }
  res.redirect('/')
}

async function authSessionApi<T extends object>(route: string, req: Request, res?: Response) {
  type RetType = Partial<T & { ok?: boolean, error?: string }>

  const hostname = req.hostname
  const baseDomain = getBaseDomain(hostname);

  const authDomain = baseDomain ? `${DEFAULT_AUTH_SUBDOMAIN}.${baseDomain}` : undefined
  const routePath = assertPath(route)
  if (authDomain && routePath) {
    const apiUrl = `https://${authDomain}${DEFAULT_MOUNT_PATH}${routePath}`
    try {
      const resp = await fetch(apiUrl, {
        headers: {
          Cookie: req.headers.cookie ?? '',
          Accept: 'application/json'
        }
      })
      if (res) {
        const setCookie = resp.headers.getSetCookie().find(v => v.startsWith('sid='))
        if (setCookie) {
          res.setHeader('set-cookie', setCookie)
        }
      }

      const data = (await resp.json()) as RetType
      if (typeof data.ok !== 'undefined') {
        return data
      } else {
        return { error: `Invalid response for [${req.path}]` } as RetType
      }
    } catch(err: any) {
      // console.error(err);
      console.error(`${err.name}: ${err.message}`);
      return { error: `Error fetching user session [${req.path}]` } as RetType
    }
  }

  return { error: `Invalid auth session api call for ${hostname} [${routePath}]` } as RetType
}

export async function getSessionUser(req: Request) {
  return authSessionApi<{ user?: UserInfo | null }>('/userinfo', req)
}

export async function destroySession(req: Request, res: Response) {
  return authSessionApi<{}>('/logout', req, res)
}
