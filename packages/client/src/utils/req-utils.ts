import type { Request } from 'express'
import { getOrigin } from '@onelyid/common'
import { assertPublicUrl } from './utils';
import { RespGlobals } from '../types/common';
import { DEMO_HANDLE } from '../const';

export function getBaseUrls(req: Request, globals: RespGlobals) {
  const origin = getOrigin(req)
  const host = new URL(origin).host
  const publicUrl = globals.publicUrl || assertPublicUrl(origin)

  // NOTE: `publicUrl` remains empty string ('') for localhost/127.0.0.1
  let baseUrl: string;
  if (publicUrl) {
    baseUrl = publicUrl
  } else {
    let port = host?.split(':')[1] ?? ''
    if (port === '80') {
      port = ''
    }
    baseUrl = `http://127.0.0.1${port ? `:${port}` : ''}`
  }
  const basePath = `${baseUrl}${globals.mountPath}`
  return { publicUrl, baseUrl, basePath }
}

export function getDocRoutes(req: Request, globals: RespGlobals) {
  const demoHandle = DEMO_HANDLE;
  const { basePath } = getBaseUrls(req, globals)

  const login = `${basePath}/login?handle=${demoHandle}`;
  const logout = `${basePath}/logout`;
  const userinfo = `${basePath}/userinfo`;
  return { login, logout, userinfo }
}
