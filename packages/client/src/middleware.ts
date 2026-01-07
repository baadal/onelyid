import express from 'express'
import type { Handler, Request, Response, NextFunction, RequestHandler, Router } from 'express'
import { OAuthResolverError } from '@atproto/oauth-client-node'
import { createDb, migrateToLatest } from './db'
import { createClient } from './oauth-client'
import { getSession } from './session'
import { assertPath, assertPublicUrl, getConsoleLogger, isValidHandle } from './utils'
import { AppContext, MiddlewareConfig, RespGlobals } from './types/common'
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

export const authMiddleware = (config: MiddlewareConfig): RequestHandler => {
  const router = express.Router()

  const globals: RespGlobals = {
    // initialized on mount
    publicUrl: '',  // possibly updated on first request
    mountPath: '',

    // initialized on first request
    baseUrl: '',
    prefixPath: '',
    basePath: '',
  }

  globals.publicUrl = assertPublicUrl(config.publicUrl);
  globals.mountPath = assertPath(config.mountPath);

  const { dbPath } = config

  let initError: unknown = null
  let routesRegistered = false
  const ctx: AppContext = {
    logger: config.logger ?? getConsoleLogger(),
    db: null,
    oauthClient: null,
  };

  // kick off async initialization immediately
  ;(async () => {
    try {
      ctx.db = createDb(dbPath)
      await migrateToLatest(ctx.db)
    } catch (err) {
      initError = err
    }
  })()

  // gate middleware
  router.use(async (req, res, next) => {
    if (initError) {
      return next(initError)
    }
    if (!ctx.db) {
      return res.status(503).send('Service initializing')
    }

    if (!globals.publicUrl) {
      const host = req.get('host')
      const detectedPublicUrl = assertPublicUrl(`${req.protocol}://${host}`)
      if (detectedPublicUrl) {
        globals.publicUrl = detectedPublicUrl
        globals.baseUrl = globals.publicUrl
      } else {
        const port = host?.split(':')[1] ?? ''
        globals.baseUrl = `http://127.0.0.1${port === '80' ? '' : `:${port}`}`
      }
    }

    if (globals.publicUrl === INVALID) {
      return res.status(503).send('Invalid publicUrl provided! Valid example: https://example.com')
    }

    if (!globals.basePath) {
      const baseUrl = req.baseUrl;
      if (baseUrl) {
        const message = `authMiddleware() must be mounted at root, not at \`${baseUrl}\``
        throw new Error(message);
      }
      globals.prefixPath = globals.mountPath || DEFAULT_MOUNT_PATH;
      globals.basePath = `${globals.baseUrl}${globals.prefixPath}`  
    }

    if (!routesRegistered) {
      registerRoutes(router, ctx, globals, config)
      routesRegistered = true;
    }

    if (!ctx.oauthClient) {
      ctx.oauthClient = await createClient(ctx, globals)
    }

    // custom json response
    res.json = (data: unknown) => sendJson(res, data)

    next()
  })

  return router
}

async function initAuthFlow(handle: string, req: Request, res: Response, ctx: AppContext, globals: RespGlobals, config: MiddlewareConfig | undefined, devMode?: boolean) {
  let loginRedirect = assertPath(config?.loginRedirect);
  if (!loginRedirect) {
    if (devMode) {
      const prefixPath = assertPath(globals.prefixPath)
      loginRedirect = `${prefixPath}/userinfo`
    } else {
      loginRedirect = '/'
    }
  }

  const purpose = req.get('Sec-Purpose') ?? req.get('Purpose')
  const parts = purpose?.split(/[;,]/) ?? []
  const isSpeculative = parts.includes('prefetch') || parts.includes('prerender')
  if (isSpeculative) {
    return
  }

  const url = await ctx.oauthClient!.authorize(handle, {
    scope: 'atproto transition:generic',
    state: JSON.stringify({ loginRedirect }),
  })
  return res.redirect(url.toString())
}

function registerRoutes(router: Router, ctx: AppContext, globals: RespGlobals, config: MiddlewareConfig) {
  // OAuth metadata
  router.get(
    '/oauth-client-metadata.json',
    handler((_req, res) => {
      return res.json(ctx.oauthClient!.clientMetadata)
    })
  )

  // OAuth callback to complete session creation
  router.get(
    `${globals.prefixPath}/callback`,
    handler(async (req, res) => {
      const params = new URLSearchParams(req.originalUrl.split('?')[1])
      let stateStr: string | null;
      try {
        const { session, state } = await ctx.oauthClient!.callback(params)
        stateStr = state
        const clientSession = await getSession(req, res, config.cookieSecret);
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
    `${globals.prefixPath}/login`,
    handler(async (req, res) => {
      // Validate
      const handle = req.query.handle as string
      if (!isValidHandle(handle)) {
        return res.json({ handle: `${handle ?? ''}`, error: 'invalid handle' })
      }

      // Initiate the OAuth flow
      try {
        await initAuthFlow(handle, req, res, ctx, globals, config, true)
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
