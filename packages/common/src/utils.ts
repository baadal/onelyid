import net from 'node:net'
import { ALLOWED_BASE_DOMAINS } from './const'

export function assertPath(path?: string) {
  let newPath = path ?? '';
  newPath = newPath.trim();
  if (!newPath) return newPath;

  if (!newPath.startsWith('/')) {
    newPath = `/${newPath}`
  }
  if (newPath.length > 1 && newPath.endsWith('/')) {
    newPath = newPath.substring(0, newPath.length-1)
  }
  return newPath;
}

export function isLocalHostname(hostname: string): boolean {
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

export function getBaseDomain(hostname: string): string | null {
  if (!hostname || isLocalHostname(hostname)) {
    return null
  }
  for (const base of ALLOWED_BASE_DOMAINS) {
    if (hostname === base || hostname.endsWith(`.${base}`)) {
      return base
    }
  }
  return null
}
