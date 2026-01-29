import { type IncomingMessage } from 'node:http'

export type Logger = {
  info: Function;
  warn: Function;
  error: Function;
}

export interface SerializedRequest {
  method?: string | undefined
  url?: string | undefined
  headers: Record<string, string>
  remoteAddress?: string | undefined
  remotePort?: number | undefined
}

export const oauthLogger: Logger = getConsoleLogger()

export function getConsoleLogger(): Logger {
  return {
    info: console.info,
    warn: console.warn,
    error: console.error,
  }
}

export function reqSerializer(req: IncomingMessage): SerializedRequest {
  const serialized = stdSerializersReq(req)
  const headers = obfuscateHeaders(serialized.headers)
  return { ...serialized, headers }
}

function stdSerializersReq(req: IncomingMessage): SerializedRequest {
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') {
      headers[key] = value
    } else if (Array.isArray(value)) {
      headers[key] = value.join(', ')
    }
  }

  return {
    method: req.method,
    url: req.url,
    headers,
    remoteAddress: req.socket?.remoteAddress,
    remotePort: req.socket?.remotePort,
  }
}

function obfuscateHeaders(headers: Record<string, string>): Record<string, string> {
  const SENSITIVE_HEADERS = new Set([
    'authorization',
    'proxy-authorization',
    'cookie',
    'set-cookie',
    'x-api-key',
    'x-auth-token',
  ])

  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (SENSITIVE_HEADERS.has(key.toLowerCase())) {
      result[key] = '[REDACTED]'
    } else {
      result[key] = value
    }
  }

  return result
}
