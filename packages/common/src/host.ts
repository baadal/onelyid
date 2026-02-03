import net from 'node:net'
import { IncomingMessage } from 'node:http'
import type { Request } from 'express'
import psl, { type ParsedDomain } from 'psl';
import { assertOrigin } from './utils'
import { Environment } from './const-export';
import { VERIFIED_BASE_AUTH_DOMAINS, AUTH_CLIENT_MOUNT_PATH, MAIN_AUTH_DOMAINS, CUSTOM_HEADERS, TEST_BASE_DOMAINS } from './const'
import type { AuthOrigin, BaseDomain, DomainConfig } from './types/common';

export function getCustomHeaderNames() {
  return CUSTOM_HEADERS
}

export function getAuthClientMountPath() {
  return AUTH_CLIENT_MOUNT_PATH
}

export function getMainAuthDomainsList() {
  return MAIN_AUTH_DOMAINS
}

export function getOrigin(_req: IncomingMessage) {
  const req = _req as Request;

  const customHeaders = getCustomHeaderNames()
  let proxyOrigin = req.get(customHeaders.proxyOrigin)
  proxyOrigin = assertOrigin(proxyOrigin)
  if (proxyOrigin) {
    return proxyOrigin
  }

  const host = req.get('host') || req.get('X-Forwarded-Host')
  const protocol = req.protocol // 'x-forwarded-proto' header value automatically used if 'trust proxy' is set
  const origin = `${protocol}://${host}`
  return origin
}

// export function getHost(req: IncomingMessage) {
//   return new URL(getOrigin(req)).host
// }

export function getHostname(req: IncomingMessage) {
  return new URL(getOrigin(req)).hostname
}

export function getProtocol(req: IncomingMessage) {
  return new URL(getOrigin(req)).protocol
}

// Note: This returns `true` on non-localhost servers, when responding to proxy-requests from localhost
export function isLocalHostname(hostname: string): boolean {
  if (!hostname) return false

  // Normalize
  const host = hostname.toLowerCase()

  // Obvious local hostnames
  if (host === "localhost") return true
  if (host.endsWith(".localhost")) return true

  // Check if it's an IP address
  const ipType = net.isIP(host)
  if (!ipType) return false

  // IPv4
  if (ipType === 4) {
    return (
      host.startsWith("127.") ||        // loopback
      host.startsWith("10.") ||         // private
      host.startsWith("192.168.") ||    // private
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) // private
    )
  }

  // IPv6
  if (ipType === 6) {
    return (
      host === "::1" ||                 // loopback
      host.startsWith("fc") ||          // unique local
      host.startsWith("fd")
    )
  }

  return false
}

// Note: This just checks NODE_ENV, so the request mode can still be 'prod' or 'uat
export function isProductionEnv() {
  const isProduction = process.env.NODE_ENV === 'production'
  return isProduction
}

export function getMainAuthDomain(_req: IncomingMessage) {
  const req = _req as Request;

  const requestMode = (req as any).mode as Environment
  if (!requestMode) {
    throw new Error(`Request mode not set! mode: ${requestMode}, path: ${req.path}`)
  }

  const mainAuthDomains = getMainAuthDomainsList()
  const mainAuthDomain = mainAuthDomains[requestMode]
  if (!mainAuthDomain) {
    throw new Error(`Unable to resolve mainAuthDomain! mode: ${requestMode}`)
  }

  return mainAuthDomain
}

export function getMainAuthDomainVariants(req: IncomingMessage) {
  const hostname = getHostname(req)
  const mainAuthDomain = getMainAuthDomain(req)
  const isMainAuthDomain = hostname === mainAuthDomain
  return {
    mainAuthDomain,
    isMainAuthDomain,
    isMainAuthDomainVariant: isMainAuthDomain || hostname.endsWith(`.${mainAuthDomain}`) || mainAuthDomain.endsWith(`.${hostname}`),
  }
}

function getPslBaseAuthDomain(appDomain: string): [string, string] | null {
  const pslBaseDomain = getPslBaseDomain(appDomain)
  if (!pslBaseDomain) return null;

  const authDomain = VERIFIED_BASE_AUTH_DOMAINS.get(pslBaseDomain)
  if (!authDomain) return null;

  const authDomainObj = psl.parse(authDomain) as ParsedDomain
  if (!authDomainObj.subdomain || authDomainObj.subdomain.includes('.')) {
    return null
  }

  if (pslBaseDomain === authDomainObj.domain) {
    return [pslBaseDomain, authDomain]
  }
  return null
}

/*
getDomainConfig(req: app.statusphere.dev) -> {
  baseDomain: 'statusphere.dev',
  authOrigin: 'https://auth.statusphere.dev',
  isVerified: true
}
getDomainConfig(req: app.statusphere.social) -> {
  baseDomain: 'app.statusphere.social',
  authOrigin: 'https://app.statusphere.social',
  isVerified: false
}
*/
function getDomainConfig(req: IncomingMessage): DomainConfig | null {
  const hostname = getHostname(req)
  const protocol = getProtocol(req)
  if (!hostname) return null;

  if (isLocalHostname(hostname)) {
    return { baseDomain: hostname, authOrigin: getOrigin(req), isLocalhost: true }
  }

  const { mainAuthDomain, isMainAuthDomain, isMainAuthDomainVariant } = getMainAuthDomainVariants(req)
  if (isMainAuthDomainVariant) {
    if (isMainAuthDomain) {
      // const authOrigin = `https://${mainAuthDomain}`
      const authOrigin = null; // NOTE: Currently, no need to return auth origin for `mainAuthDomain`
      return { baseDomain: mainAuthDomain, authOrigin };
    } else {
      return null;
    }
  }

  const baseAuthPair = getPslBaseAuthDomain(hostname)
  if (baseAuthPair) {
    const [pslBaseDomain, authDomain] = baseAuthPair
    return { baseDomain: pslBaseDomain, authOrigin: `${protocol}//${authDomain}`, isVerified: true }
  }

  return { baseDomain: hostname, authOrigin: `${protocol}//${hostname}`, isVerified: false }
}

/*
getBaseDomain(req: app.statusphere.dev) -> {
  baseDomain: 'statusphere.dev',
  isVerified: true
}
getBaseDomain(req: app.statusphere.social) -> {
  baseDomain: 'app.statusphere.social',
  isVerified: false
}
*/
// NOTE: Here, `baseDomain` is the domain where auth cookie should be saved
export function getBaseDomain(req: IncomingMessage): BaseDomain | undefined {
  const domainConfig = getDomainConfig(req)
  if (!domainConfig) return undefined

  const { baseDomain, isLocalhost, isVerified } = domainConfig
  return { baseDomain, isLocalhost, isVerified }
}

export function getPslBaseDomain(hostname: string): string | null {
  if (!psl.isValid(hostname)) return null;
  const domainObj = psl.parse(hostname) as ParsedDomain
  const pslBaseDomain = domainObj.domain
  if (!pslBaseDomain) return null;
  return pslBaseDomain
}

export function baseCookieDomain(req: Request) {
  const hostname = getHostname(req)
  if (isLocalHostname(hostname)) {
    return hostname
  }

  const pslBaseDomain = getPslBaseDomain(hostname)
  let cookieDomain = pslBaseDomain
  if (cookieDomain) {
    cookieDomain = `.${cookieDomain}` // Not needed for modern browsers
  }
  return cookieDomain || undefined
}

export function getAuthOrigin(req: Request): AuthOrigin | null {
  const domainConfig = getDomainConfig(req)
  if (!domainConfig) return null

  const { authOrigin, isLocalhost } = domainConfig
  if (!authOrigin) return null

  return { authOrigin, isLocalhost }
}

export function isTestDomain(req: Request) {
  const hostname = getHostname(req)
  if (isLocalHostname(hostname)) {
    return true
  }

  const pslBaseDomain = getPslBaseDomain(hostname)
  if (!pslBaseDomain) {
    return false
  }
  return TEST_BASE_DOMAINS.includes(pslBaseDomain)
}
