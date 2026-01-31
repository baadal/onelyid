import type { Request } from 'express'

export function getHost(req: Request) {
  // const host = req.get('X-Forwarded-Host') || req.get('host')
  const host = req.get('host')
  return host
}

export function getOrigin(req: Request) {
  const host = getHost(req)
  const origin = `${req.protocol}://${host}`
  return origin
}
