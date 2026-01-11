import type { OAuthClient } from '@atproto/oauth-client-node';
import type { OAuthClientFactory } from '../oauth-client';
import type { Database } from '../db';

export type { Database } from '../db'

export type Logger = {
  info: Function;
  warn: Function;
  error: Function;
}

export type Session = { did: string }

export type AuthMiddlewareConfig = {
  dbPath?: string;
  cookieSecret: string;
  publicUrl?: string;
  mountPath?: string;
  loginRedirect?: string;
  logger?: Logger;
}

export type RespGlobals = {
  mountPath: string;
  publicUrl: string;
}

// Application state passed to the router and elsewhere
export type AppContext = {
  logger: Logger;
  db: Database | null;
  oauthClientFactory: OAuthClientFactory | null;
}

// request-specific context
export type RequestContext = {
  oauthClient: OAuthClient | null;
}
