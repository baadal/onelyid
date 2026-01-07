import { isValidHandle as isValidHandleSyntax } from '@atproto/syntax'
import { isLocalHostname } from '@onelyid/common'
import { Logger } from '../types/common'
import { INVALID } from '../const'

export function getConsoleLogger(): Logger {
  return {
    info: console.info,
    warn: console.warn,
    error: console.error,
  }
}

// NOTE: `publicUrl` remains empty string ('') for localhost/127.0.0.1
export function assertPublicUrl(url?: string) {
  let publicUrl = url ?? '';
  publicUrl = publicUrl.trim();
  if (!publicUrl) return publicUrl;
  
  publicUrl = publicUrl.toLowerCase()
  if (publicUrl.endsWith('/')) {
    publicUrl = publicUrl.substring(0, publicUrl.length-1)
  }
  if (!publicUrl.startsWith('http://') && !publicUrl.startsWith('https://')) {
    return INVALID
  }

  try {
    const urlObj = new URL(publicUrl)
    if (isLocalHostname(urlObj.hostname)) {
      return ''
    } else {
      return publicUrl
    }
  } catch(err) {
    return INVALID
  }
}

export function isValidHandle(handle?: string) {
  if (!handle || typeof handle !== 'string') {
    return false
  }
  return isValidHandleSyntax(handle);
}
