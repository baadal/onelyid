import type { OAuthClient } from '@atproto/oauth-client-node'
import type { Database } from '../db';
import type { BidirectionalResolver } from '../id-resolver'

export type { Database } from '../db'

export type Logger = {
  info: Function;
  warn: Function;
  error: Function;
}

export type Session = { did: string }

export type MiddlewareConfig = {
  dbPath?: string;
  cookieSecret?: string;
  publicUrl?: string;
  logger?: Logger;
  mountPath?: string;
  loginRedirect?: string;
}

export type RespGlobals = {
  cookieSecret: string;
  publicUrl: string;
  mountPath: string;
  baseUrl: string;
  prefixPath: string;
  basePath: string;
}

// Application state passed to the router and elsewhere
export type AppContext = {
  logger: Logger;
  db: Database | null;
  oauthClient: OAuthClient | null;
  resolver: BidirectionalResolver | null;
}

export type UserInfo = {
  did: string;
  handle: string;
  email: string;
  emailTrusted: boolean;
  displayName?: string;
  avatar?: string;
}
