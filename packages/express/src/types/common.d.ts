import type { Logger, RequestMode } from '@onelyid/common'

export type { Logger }

export type AuthMiddlewareConfig = {
  loginRedirect?: string;
  logger?: Logger;
  mode?: RequestMode;
}

// request-specific context
export type RequestContext = {
  logger: Logger;
}

export type UserInfo = {
  did: string;
  handle: string;
  email: string;
  emailVerified: boolean;
  displayName?: string;
  avatar?: string;
}
