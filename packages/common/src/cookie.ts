import { ServerResponse } from 'node:http'
import * as cookie from 'cookie'

// NOTE: To delete a cookie, just call `addCookie()` with a cookie with `maxAge: 0`
export function addCookie(res: ServerResponse, newCookie: string) {
  const existing = res.getHeader('Set-Cookie')

  let cookies: string[] = []
  if (Array.isArray(existing)) {
    cookies = existing
  } else if (typeof existing === 'string') {
    cookies = [existing]
  }

  const parsedNew = cookie.parseSetCookie(newCookie)
  const filtered = cookies.filter((c) => {
    const parsed = cookie.parseSetCookie(c)
    return !(
      parsed.name === parsedNew.name &&
      (parsed.path || '/') === (parsedNew.path || '/') &&
      (parsed.domain || '') === (parsedNew.domain || '')
    )
  })

  filtered.push(newCookie)
  res.setHeader('Set-Cookie', filtered)
}
