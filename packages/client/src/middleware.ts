import express from 'express'
import type { Handler, Request, Response, NextFunction, RequestHandler, Router } from 'express'
import { OAuthResolverError } from '@atproto/oauth-client-node'
import { assertPath } from '@onelyid/common'
import { createDb, migrateToLatest } from './db'
import { OAuthClientFactory } from './oauth-client'
import { getOrCreateCookieSecret } from './db/queries'
import { getSession } from './session'
import { assertPublicUrl, getConsoleLogger, getDatabasePath, isValidHandle } from './utils/utils'
import { AppContext, AuthMiddlewareConfig, RespGlobals } from './types/common'
import { DEFAULT_MOUNT_PATH, INVALID } from './const'

// Helper function for defining routes
const handler =
  (fn: Handler) =>
  async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      await fn(req, res, next)
    } catch (err) {
      next(err)
    }
  }

export const authMiddleware = (config: AuthMiddlewareConfig): RequestHandler => {
  const router = express.Router()

  const globals: RespGlobals = {
    // initialized on mount
    cookieSecret: '',
    mountPath: '',
    publicUrl: '',
  };

  globals.cookieSecret = config.cookieSecret ?? '';
  globals.mountPath = assertPath(config.mountPath ?? DEFAULT_MOUNT_PATH);
  globals.publicUrl = assertPublicUrl(config.publicUrl);

  let initError: unknown = null
  const ctx: AppContext = {
    logger: config.logger ?? getConsoleLogger(),
    db: null,
    oauthClientFactory: null,
  };

  // kick off async initialization immediately
  ;(async () => {
    try {
      const dbPath = config.dbPath || getDatabasePath()
      ctx.db = createDb(dbPath)
      await migrateToLatest(ctx.db)

      if (!globals.cookieSecret) {
        globals.cookieSecret = await getOrCreateCookieSecret(ctx.db)
      }

      ctx.oauthClientFactory = new OAuthClientFactory()

      registerRoutes(router, ctx, globals, config)
    } catch (err) {
      initError = err
    }
  })()

  // gate middleware
  router.use(async (req, res, next) => {
    if (initError) {
      return next(initError)
    }
    if (!ctx.db || !globals.cookieSecret || !ctx.oauthClientFactory) {
      return res.status(503).send('Service initializing')
    }
    if (globals.publicUrl === INVALID) {
      return res.status(503).send('Invalid publicUrl provided! Valid example: https://example.com')
    }
    if (req.baseUrl) {
      const message = `authMiddleware() must be mounted at root, not at \`${req.baseUrl}\``
      throw new Error(message);
    }

    req.ctx = {
      oauthClient: await ctx.oauthClientFactory.create(req, ctx, globals)
    };

    // custom json response
    res.json = (data: unknown) => sendJson(res, data)

    next()
  })

  return router
}

async function initAuthFlow(handle: string, req: Request, res: Response, globals: RespGlobals, config: AuthMiddlewareConfig | undefined) {
  let loginRedirect = assertPath(config?.loginRedirect);
  if (!loginRedirect) {
    loginRedirect = '/'
  }

  const purpose = req.get('Sec-Purpose') ?? req.get('Purpose')
  const parts = purpose?.split(/[;,]/) ?? []
  const isSpeculative = parts.includes('prefetch') || parts.includes('prerender')
  if (isSpeculative) {
    return
  }

  const url = await req.ctx.oauthClient!.authorize(handle, {
    scope: 'atproto transition:generic',
    state: JSON.stringify({ loginRedirect }),
  })
  return res.redirect(url.toString())
}

function registerRoutes(router: Router, ctx: AppContext, globals: RespGlobals, config: AuthMiddlewareConfig) {
  // OAuth metadata
  router.get(
    '/oauth-client-metadata.json',
    handler((req, res) => {
      return res.json(req.ctx.oauthClient!.clientMetadata)
    })
  )

  // OAuth callback to complete session creation
  router.get(
    `${globals.mountPath}/callback`,
    handler(async (req, res) => {
      const params = new URLSearchParams(req.originalUrl.split('?')[1])
      let stateStr: string | null;
      try {
        const { session, state } = await req.ctx.oauthClient!.callback(params)
        stateStr = state
        const clientSession = await getSession(req, res, globals.cookieSecret);
        // assert(!clientSession.did, 'session already exists')
        clientSession.did = session.did
        await clientSession.save()
      } catch (err) {
        ctx.logger.error({ err }, 'oauth callback failed')
        return res.redirect('/?error')
      }

      let loginRedirect: string | undefined;
      if (stateStr) {
        try {
          const stateObj = JSON.parse(stateStr)
          loginRedirect = stateObj.loginRedirect
        } catch(err) {}
      }
      if (!loginRedirect) {
        loginRedirect = '/'
      }

      return res.redirect(loginRedirect)
    })
  )

  // Login handler
  router.get(
    `${globals.mountPath}/login`,
    handler(async (req, res) => {
      // Validate
      const handle = req.query.handle as string
      if (!isValidHandle(handle)) {
        return res.json({ handle: `${handle ?? ''}`, error: 'invalid handle' })
      }

      // Initiate the OAuth flow
      try {
        await initAuthFlow(handle, req, res, globals, config)
      } catch (err) {
        ctx.logger.error({ err }, 'oauth authorize failed')
        return res.json({
          error:
            err instanceof OAuthResolverError
              ? err.message
              : "couldn't initiate login",
        })
      }
    })
  )
}

function sendJson(res: Response, data: unknown) {
  const dataStr = JSON.stringify(data, null, 2)
  return res.type('json').send(dataStr)
}
