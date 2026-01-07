import type { Request } from 'express'
import { getHost } from '@onelyid/common'
import { assertPublicUrl } from './utils';
import { RespGlobals } from '../types/common';

export function getBaseUrls(req: Request, globals: RespGlobals) {
  const host = getHost(req)
  const publicUrl = globals.publicUrl || assertPublicUrl(`${req.protocol}://${host}`)

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
