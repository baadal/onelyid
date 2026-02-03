import { IncomingMessage } from 'node:http';
import type { OAuthClient } from '@atproto/oauth-client-node';
import type { Logger, RequestMode, WrappedLogger } from '@onelyid/common'
import type { OAuthClientFactory } from '../oauth-client';
import type { Database } from '../db/db';
import type { BidirectionalResolver } from '../id-resolver'

export type { Logger }

export type Session = { did: string }

export type AuthMiddlewareConfig = {
  dbPath?: string;
  cookieSecret?: string;
  stateSecret?: string;
  publicUrl?: string;
  loginRedirect?: string;
  logger?: Logger;
  mode?: RequestMode;
}

export type InternalGlobals = {
  globals: RespGlobals | null;
}

export type RespGlobals = {
  cookieSecret: string;
  stateSecret: string;
  mountPath: string;
  publicUrl: string;
}

// Application state passed to the router and elsewhere
export type AppContext = {
  db: Database | null;
  resolver: BidirectionalResolver | null;
  oauthClientFactory: OAuthClientFactory | null;
}

// request-specific context
export type RequestContext = {
  logger: WrappedLogger;
  oauthClient: OAuthClient;
}

export type IncomingMessageRequest = IncomingMessage & { ctx: RequestContext }

export type UserInfo = {
  did: string;
  handle: string;
  email: string;
  emailVerified: boolean;
  displayName?: string;
  avatar?: string;
}

export type LoginPageState = {
  redirectUrl: string;
  authOrigin: string;
  originId: string;
  requestMode?: string;
}

export type LoginPageProps = {
  redirectUrl: string;
  authActioUrl: string;
  originId: string;
  requestMode?: string;
}
