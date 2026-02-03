import { Environment } from './const-export';

export const AUTH_CLIENT_MOUNT_PATH = '/@onelyid/client'

export const CUSTOM_HEADERS = {
  proxyOrigin: 'X-Onelyid-Proxy-Origin',
  requestMode: 'X-Onelyid-Request-Mode',
} as const

export const MAIN_AUTH_DOMAINS = {
  [Environment.Prod]: 'atproto.id',
  [Environment.Uat]: 'atproto.is',
} as const

export const VERIFIED_BASE_AUTH_DOMAINS = new Map<string, string>(Object.entries({
  'statusphere.dev': 'auth.statusphere.dev',
  // 'statusphere.social': 'auth.statusphere.social',
}));
for (const value of Object.values(MAIN_AUTH_DOMAINS)) {
  VERIFIED_BASE_AUTH_DOMAINS.delete(value)
}

export const TEST_BASE_DOMAINS = ['statusphere.dev', 'statusphere.social']
