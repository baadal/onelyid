import { NodeOAuthClient, OAuthClient } from '@atproto/oauth-client-node'
import type { Request } from 'express'
import type { AppContext, RespGlobals } from './types/common'
import { SessionStore, StateStore } from './storage'
import { getBaseUrls } from './utils/req-utils'
import { getDatabase2Path } from './utils/utils'
import { createDb2Client } from './db'
import { sqliteRequestLock } from './db/lock'
import type { Database2 } from './db/db2'

type InternalContext = {
  db: Database2 | null;
}

const createClient = async (ctx: InternalContext, publicUrl: string, baseUrl: string, basePath: string) => {
  const enc = encodeURIComponent
  return new NodeOAuthClient({
    clientMetadata: {
      client_name: 'ATProto client',
      client_id: publicUrl
        ? `${baseUrl}/oauth-client-metadata.json`
        : `http://localhost?redirect_uri=${enc(`${basePath}/callback`)}&scope=${enc('atproto transition:generic transition:email')}`,
      client_uri: baseUrl,
      redirect_uris: [`${basePath}/callback`],
      scope: 'atproto transition:generic transition:email',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      application_type: 'web',
      token_endpoint_auth_method: 'none',
      dpop_bound_access_tokens: true,
    },
    stateStore: new StateStore(ctx.db!),
    sessionStore: new SessionStore(ctx.db!),
    requestLock: sqliteRequestLock(ctx.db!),
  })
}

export class OAuthClientFactory {
  private readonly cache = new Map<string, Promise<OAuthClient>>();

  async create(req: Request, _ctx: AppContext, globals: RespGlobals): Promise<OAuthClient> {
    const { publicUrl, baseUrl, basePath } = getBaseUrls(req, globals)

    let cached = this.cache.get(baseUrl)
    if (!cached) {
      const dbPath = getDatabase2Path(baseUrl)
      const db = await createDb2Client(dbPath)
      const ctx: InternalContext = { db }

      cached = createClient(ctx, publicUrl, baseUrl, basePath).catch(err => {
        this.cache.delete(baseUrl);
        req.ctx.logger.debug({ publicUrl, baseUrl, basePath })
        throw err;
      })
      this.cache.set(baseUrl, cached)
    }
    return cached
  }
}
