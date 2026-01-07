import { NodeOAuthClient, OAuthClient } from '@atproto/oauth-client-node'
import type { Request } from 'express'
import type { AppContext, RespGlobals } from './types/common'
import { SessionStore, StateStore } from './storage'
import { getBaseUrls } from './utils/req-utils'

const createClient = async (ctx: AppContext, publicUrl: string, baseUrl: string, basePath: string) => {
  const enc = encodeURIComponent
  return new NodeOAuthClient({
    clientMetadata: {
      client_name: 'ATProto client',
      client_id: publicUrl
        ? `${baseUrl}/oauth-client-metadata.json`
        : `http://localhost?redirect_uri=${enc(`${basePath}/callback`)}&scope=${enc('atproto transition:generic')}`,
      client_uri: baseUrl,
      redirect_uris: [`${basePath}/callback`],
      scope: 'atproto transition:generic',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      application_type: 'web',
      token_endpoint_auth_method: 'none',
      dpop_bound_access_tokens: true,
    },
    stateStore: new StateStore(ctx.db!),
    sessionStore: new SessionStore(ctx.db!),
  })
}

export class OAuthClientFactory {
  private readonly cache = new Map<string, Promise<OAuthClient>>();

  create(req: Request, ctx: AppContext, globals: RespGlobals): Promise<OAuthClient> {
    const { publicUrl, baseUrl, basePath } = getBaseUrls(req, globals)

    let cached = this.cache.get(baseUrl)
    if (!cached) {
      cached = createClient(ctx, publicUrl, baseUrl, basePath).catch(err => {
        this.cache.delete(baseUrl);
        throw err;
      })
      this.cache.set(baseUrl, cached)
    }
    return cached
  }
}
