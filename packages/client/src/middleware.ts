import express from 'express'
import type { Handler, Request, Response, NextFunction, RequestHandler, Router } from 'express'
import { OAuthClient, OAuthResolverError } from '@atproto/oauth-client-node'
import { AUTH_CLIENT_NAME, authBodyParser, assertOrigin, assertPath, getHostname, getOrigin, isLocalHostname, openState, sealState, packObject, unpackObject, getMainAuthDomain, getAuthClientMountPath, getMainAuthDomainVariants, getCustomHeaderNames, assertRequestMode, Environment, getMainAuthDomainsList, getRequestMetadata, getCustomRedirectFunc, isIgnoreRequest, isProductionEnv, getLoggerInstance } from '@onelyid/common'
import { createDbClient } from './db'
import { OAuthClientFactory } from './oauth-client'
import { getOrCreateCookieSecret, getOrCreateStateSecret } from './db/queries'
import { createBidirectionalResolver, createIdResolver } from './id-resolver'
import { deleteSession, getSessionUser, setSession } from './session'
import { assertPublicUrl, getAppPackageName, getDatabasePath, isValidHandle } from './utils/utils'
import { getDocRoutes } from './utils/req-utils'
import type { AppContext, AuthMiddlewareConfig, InternalGlobals, Logger, LoginPageProps, LoginPageState, RespGlobals, UserInfo } from './types/common'
import { INVALID } from './const'

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
      if (req.ctx?.logger) {
        req.ctx.logger.error(err)
      }
      next(err)
    }
  }

// NOTE: Only use `iGlobals` where the usage is not direcly via `authMiddleware` setup
// E.g. `setAuth` and `redirect` middlewares
const iGlobals: InternalGlobals = {
  globals: null,
};

export const authMiddleware = (config?: AuthMiddlewareConfig): RequestHandler => {
  const router = express.Router()

  router.use(handler(authBodyParser))

  const globals: RespGlobals = {
    // initialized on mount
    cookieSecret: '',
    stateSecret: '',
    mountPath: '',
    publicUrl: '',
  };

  const authClientMountPath = getAuthClientMountPath()

  globals.cookieSecret = config?.cookieSecret ?? '';
  globals.stateSecret = config?.stateSecret ?? '';
  globals.mountPath = assertPath(authClientMountPath);
  globals.publicUrl = assertPublicUrl(config?.publicUrl);

  const packageName = getAppPackageName()
  const loggerName = AUTH_CLIENT_NAME
  const logger = getLoggerInstance(config?.logger, {
    name: packageName ?? loggerName,
  })

  let initError: unknown = null
  const ctx: AppContext = {
    db: null,
    resolver: null,
    oauthClientFactory: null,
  };

  iGlobals.globals = globals;

  // kick off async initialization immediately
  ;(async () => {
    try {
      const dbPath = config?.dbPath || getDatabasePath()
      ctx.db = await createDbClient(dbPath)

      if (!globals.cookieSecret) {
        globals.cookieSecret = await getOrCreateCookieSecret(ctx.db)
      }
      if (!globals.stateSecret) {
        globals.stateSecret = await getOrCreateStateSecret(ctx.db)
      }

      const baseIdResolver = createIdResolver()
      ctx.resolver = createBidirectionalResolver(baseIdResolver)

      ctx.oauthClientFactory = new OAuthClientFactory()

      registerRoutes(router, ctx, globals, config)
    } catch (err) {
      initError = err
    }
  })()

  // gate middleware
  router.use(handler(async (req, res, next) => {
    if (isIgnoreRequest(req, res, next)) {
      return
    }

    const prodUsageMessage = `Mode 'prod' can only be used in production environment. NODE_ENV: ${process.env.NODE_ENV}`

    const deferLog = req.path === `${globals.mountPath}/callback`
    const metadataOptions = { loggerName, mode: config?.mode, deferLog }

    const reqLogger = logger.child({
      child_name: loggerName,
      ...getRequestMetadata(req, res, metadataOptions),
    })

    if (deferLog) {
      reqLogger.defer('New request')
    } else {
      reqLogger.trace('New request')
    }

    if (initError) {
      return next(initError)
    }
    if (!ctx.db || !globals.cookieSecret || !globals.stateSecret || !ctx.resolver || !ctx.oauthClientFactory) {
      return res.status(503).send('Service initializing')
    }
    if (globals.publicUrl === INVALID) {
      return res.status(503).send('Invalid publicUrl provided! Valid example: https://example.com')
    }
    if (req.baseUrl) {
      const message = `authMiddleware() must be mounted at root, not at \`${req.baseUrl}\``
      return next(new Error(message));
    }

    const hostname = getHostname(req)
    const isLocalhost = isLocalHostname(hostname)
    const isProduction = isProductionEnv()
    if (!isLocalhost && !isProduction) {
      const message = `Non-localhost domain must run in production environment. NODE_ENV: ${process.env.NODE_ENV}`
      return next(new Error(message))
    }
    if (config?.mode === Environment.Prod && !isProduction) {
      return next(new Error(prodUsageMessage))
    }

    let oauthClient: OAuthClient | null = null
    try {
      oauthClient = await ctx.oauthClientFactory.create(req, ctx, globals)
      if (!oauthClient) throw new Error('Unable to create oauthClient!') // caught by next catch
    } catch(err) {
      return next(err)
    }

    req.ctx = {
      logger: reqLogger,
      oauthClient,
    };

    const modeConfigured = assertRequestMode(config?.mode)
    const modeInferred = getRequestMode(req, globals)
    if (modeConfigured && modeInferred && modeConfigured !== modeInferred) {
      const message = `Environment (request mode) mismatch! ${modeConfigured} ${modeInferred}`
      const acceptsJSON = req.accepts(['json', 'html']) === 'json'

      res.status(500)
      if (acceptsJSON) {
        res.json({ error: message })
      } else {
        res.send(message)
      }
      return
    }

    const requestMode = modeConfigured || modeInferred
    if (requestMode) {
      req.mode = requestMode
    } else if (req.path !== `${globals.mountPath}/callback`) {
      // NOTE: The (OAuth) callback route finalises `req.mode` separately
      req.mode = Environment.Prod  // finalise `req.mode`
    }

    // Duplicate check! (after finilization of `req.mode`) [Possibly not needed]
    if (req.mode === Environment.Prod && !isProduction) {
      return next(new Error(prodUsageMessage))
    }

    req.authFlow = () => initAuthFlow(req, res);
    req.getAuth = () => setReqAuth(req, res);

    res.clearAuth = () => deleteSession(req, res, globals);

    // custom json response
    res.json = (data: unknown) => sendJson(res, data)

    // custom redirect function
    res.redirect = getCustomRedirectFunc(req, res)

    next()
  }))

  return router
}

async function initAuthFlow(req: Request, res: Response): Promise<LoginPageProps | void> {
  const { isMainAuthDomain, isMainAuthDomainVariant } = getMainAuthDomainVariants(req)

  const searchParams = new URLSearchParams(req.query as Record<string, string>)
  const state = searchParams.get('state') ?? ''
  let redirectUrl = searchParams.get('continue') || '/'

  if (!isMainAuthDomain || !state) {
    if (await req.getAuth()) {
      return res.redirect(redirectUrl)
    }
  }

  if (!isMainAuthDomain) {
    if (!isMainAuthDomainVariant) {
      const authClientMountPath = getAuthClientMountPath()

      const searchParams = new URLSearchParams()
      searchParams.set('continue', redirectUrl)
      searchParams.set('origin_id', res.locals.origin_id ?? '')
      if (req.mode) {
        searchParams.set('request_mode', req.mode)
      }

      return res.redirect(`${authClientMountPath}/login/redirect?${searchParams.toString()}`)
    } else {
      return res.redirect(redirectUrl)
    }
  }

  let authOrigin = ''
  let originId = ''
  if (state) {
    const stateObj = unpackObject(state) as LoginPageState | null
    redirectUrl = stateObj?.redirectUrl || redirectUrl
    authOrigin = stateObj?.authOrigin || ''
    originId = stateObj?.originId || ''
  }

  const authClientMountPath = getAuthClientMountPath()
  const authActioUrl = `${authOrigin || ''}${authClientMountPath}/login`;

  const loginProps: LoginPageProps = { redirectUrl, authActioUrl, originId }
  if (req.mode) {
    loginProps.requestMode = req.mode
  }
  return loginProps
}

async function initOAuthFlow(handle: string, redirectUrl: string | undefined, req: Request, res: Response, globals: RespGlobals, config: AuthMiddlewareConfig | undefined, devMode?: boolean) {
  let loginRedirect = redirectUrl || assertPath(config?.loginRedirect);
  if (!loginRedirect) {
    if (devMode) {
      loginRedirect = `${globals.mountPath}/userinfo`
    } else {
      loginRedirect = '/'
    }
  }

  let localAuth = ''
  const hostname = getHostname(req)
  if (isLocalHostname(hostname)) {
    localAuth = hostname
  }

  if (!handle) {
    return res.redirect(loginRedirect)
  }

  const stateObj: any = {
    loginRedirect,
    originId: res.locals.origin_id ?? '',
    timestamp: Date.now(),
  }
  if (req.mode) {
    stateObj.requestMode = req.mode
  }
  if (localAuth) {
    stateObj.localAuth = localAuth
  }

  const url = await req.ctx.oauthClient!.authorize(handle, {
    scope: 'atproto transition:email',
    state: JSON.stringify(stateObj),
  })
  return res.redirect(url.toString())
}

export const setAuth: RequestHandler = async (req, res, next) => {
  await setReqAuth(req, res)
  next()
};

export const redirect: (path: string) => RequestHandler = (redirectPath: string) => (async (req, res, next) => {
  await setReqAuth(req, res)
  if (!req.auth) {
    const path = assertPath(redirectPath ?? '/');
    return res.redirect(path)
  }
  next()
}) satisfies RequestHandler;

async function setReqAuth(req: Request, res: Response): Promise<UserInfo | null> {
  if (req.auth) {
    return req.auth
  }

  if (iGlobals.globals?.cookieSecret) {
    const { user, error } = await getSessionUser(req, res, iGlobals.globals.cookieSecret)
    if (!error && user) {
      req.auth = user
    }
  }
  if (!req.auth) {
    req.auth = null
  }
  return req.auth
}

function getRequestMode(req: Request, globals: RespGlobals): Environment | undefined {
  let requestMode: Environment | undefined = undefined
  const searchParams = new URLSearchParams(req.query as Record<string, string>)

  const customHeaders = getCustomHeaderNames()
  const requestModeValue = req.get(customHeaders.requestMode)
  requestMode = assertRequestMode(requestModeValue)

  if (!requestMode) {
    let _requestModeValue = searchParams.get('request_mode')
    if (!_requestModeValue && req.body?.request_mode) {
      _requestModeValue = (req.body.request_mode as string)
    }

    if (_requestModeValue) {
      const _requestMode = assertRequestMode(_requestModeValue)
      if (_requestMode) {
        requestMode = _requestMode
      }
    }
  }

  if (!requestMode && req.path === '/login') {
    const state = searchParams.get('state')
    if (state) {
      const stateObj = unpackObject<string>(state)
      const _requestMode = assertRequestMode(stateObj?.requestMode)
      if (_requestMode) {
        requestMode = _requestMode
      }
    }
  }

  if (!requestMode && req.path === `${globals.mountPath}/transfer-local-session`) {
    const sealedState = searchParams.get('xstate')
    if (sealedState) {
      const stateObj = openState(sealedState, globals.stateSecret)
      const _requestMode = assertRequestMode(stateObj.requestMode)
      if (_requestMode) {
        requestMode = _requestMode
      }
    }
  }

  if (!requestMode) {
    const hostname = getHostname(req)
    for (const [mode, authDomain] of Object.entries(getMainAuthDomainsList())) {
      if (hostname === authDomain) {
        const _requestMode = assertRequestMode(mode)
        requestMode = _requestMode
      }
    }
  }

  return requestMode
}

function registerRoutes(router: Router, ctx: AppContext, globals: RespGlobals, config?: AuthMiddlewareConfig) {
  // OAuth metadata
  router.get(
    '/oauth-client-metadata.json',
    handler((req, res) => {
      return res.json(req.ctx.oauthClient!.clientMetadata)
    })
  )

  // Middleware root (base)
  router.get(
    `${globals.mountPath ?? '/'}`,
    handler((req, res) => {
      const { login, logout, userinfo } = getDocRoutes(req, globals)
      return res.json({
        info: "middleware root endpoint",
        try: [{ login, logout, userinfo }],
      })
    })
  )

  // OAuth callback to complete session creation
  router.get(
    `${globals.mountPath}/callback`,
    handler(async (req, res) => {
      let loginRedirect: string | undefined;
      const params = new URLSearchParams(req.originalUrl.split('?', 2)[1])
      try {
        const { session, state } = await req.ctx.oauthClient!.callback(params)
        if (state) {
          const stateObj = JSON.parse(state)
          loginRedirect = stateObj.loginRedirect
          const requestMode = stateObj.requestMode
          const originId = stateObj.originId

          // finalise `req.mode` for (OAuth) callback route
          if (!req.mode) {
            req.mode = requestMode || Environment.Prod
          }

          // finalise `res.locals.origin_id` for (OAuth) callback route
          res.locals.origin_id = originId
          req.ctx.logger.update({ origin_id: originId, did: session.did })
          req.ctx.logger.flush()  // deferred log

          const proxyOrigin = getProxyOrigin(req)
          const localAuth = stateObj.localAuth
          const hostname = getHostname(req)

          const transferLocalAuth = proxyOrigin && localAuth && isLocalHostname(localAuth) && isLocalHostname(hostname) && localAuth !== hostname
          if (transferLocalAuth) {
            const state: any = { loginRedirect, did: session.did }
            if (req.mode) {
              state.requestMode = req.mode
            }
            const sealedState = sealState(state, globals.stateSecret)

            const url = new URL(`${getOrigin(req)}${globals.mountPath}/transfer-local-session`)
            url.hostname = localAuth
            url.searchParams.set('xstate', sealedState)

            return res.redirect(url.href)
          } else {
            await setSession(req, res, globals.cookieSecret, { did: session.did })
          }
        } else {
          throw new Error('state missing in oauth callback!')
        }
      } catch (err) {
        req.ctx.logger.error('oauth callback failed', err)
        return res.redirect('/?error')
      }

      if (!loginRedirect) {
        loginRedirect = '/'
      }

      return res.redirect(loginRedirect)
    })
  )

  // Login redirect handler
  router.get(
    `${globals.mountPath}/login/redirect`,
    handler(async (req, res) => {
      const searchParams = new URLSearchParams(req.query as Record<string, string>)
      const redirectUrl = searchParams.get('continue') || '/'
      const originId = searchParams.get('origin_id') || ''
      const authOrigin = getOrigin(req)

      const stateObj: LoginPageState = { redirectUrl, authOrigin, originId }
      if (req.mode) {
        stateObj.requestMode = req.mode
      }
      const state = packObject(stateObj)

      const mainAuthDomain = getMainAuthDomain(req)
      const url = new URL(`https://${mainAuthDomain}/login`)
      url.searchParams.set('state', state);
      return res.redirect(url.href)
    })
  )

  // Login handler
  router.route(`${globals.mountPath}/login`)
    .get(handler(async (req, res) => {
      const searchParams = new URLSearchParams(req.query as Record<string, string>)
      const handle = searchParams.get('handle')
      if (handle) {
        await handleLoginFlow(handle, undefined, req, res, true)
      } else {
        throw new Error('Handle missing!')
      }
    }))
    .post(handler(async (req, res) => {
      const handle = req.body?.handle
      const redirectUrl = req.body?.redirect_url
      if (handle) {
        await handleLoginFlow(handle, redirectUrl, req, res)
      } else {
        throw new Error('Handle missing!')
      }
    }))

  // Logout handler
  // TODO: Can make it as POST-only later, with an info message for GET
  router.all(
    `${globals.mountPath}/logout`,
    handler(async (req, res) => {
      await deleteSession(req, res, globals)

      const acceptsJSON = req.accepts(['json', 'html']) === 'json'
      if (acceptsJSON) {
        return res.json({ ok: true })
      } else {
        return res.redirect('/')
      }
    })
  )

  // User info for current session
  router.get(
    `${globals.mountPath}/userinfo`,
    handler(async (req, res) => {
      const { login, logout, userinfo } = getDocRoutes(req, globals)
      const { user, error } = await getSessionUser(req, res, globals.cookieSecret)
      if (user === null) {
        return res.json({ ok: true, user, info: 'not logged-in', try: [{ login, userinfo }] })
      } else if (!user) {
        return res.json({ ok: true, user: null, error, try: [{ login, userinfo }] })
      }
      return res.json({ ok: true, user, try: [{ logout, userinfo }] })
    })
  )

  // Transfer local session (e.g. 127.0.0.1 --> localhost)
  router.get(
    `${globals.mountPath}/transfer-local-session`,
    handler(async (req, res) => {
      const proxyOrigin = getProxyOrigin(req)
      const hostname = getHostname(req)

      const transferLocalAuth = proxyOrigin && isLocalHostname(hostname)
      const sealedState = new URLSearchParams(req.query as Record<string, string>).get('xstate')
      if (transferLocalAuth && sealedState) {
        const stateObj = openState(sealedState, globals.stateSecret)
        if (stateObj) {
          const { loginRedirect, did } = stateObj
          await setSession(req, res, globals.cookieSecret, { did })
          return res.redirect(loginRedirect)
        }
      }

      return res.redirect('/')
    })
  )

  async function handleLoginFlow(handle: string, redirectUrl: string | undefined, req: Request, res: Response, devMode?: boolean) {
    const { login, userinfo } = getDocRoutes(req, globals)
    // const isPost = req.method === 'POST'

    // Validate
    if (!isValidHandle(handle)) {
      req.ctx.logger.error(`Invalid handle: ${handle}`)
      return res.json({
        handle: `${handle ?? ''}`,
        error: 'Invalid handle',
        try: [{ login, userinfo }],
      })
    }

    // Initiate the OAuth flow
    try {
      await initOAuthFlow(handle, redirectUrl, req, res, globals, config, devMode)
    } catch (err) {
      req.ctx.logger.error('oauth authorize failed', err)
      return res.json({
        error:
          err instanceof OAuthResolverError
            ? err.message
            : "couldn't initiate login",
      })
    }
  }
}

function sendJson(res: Response, data: unknown) {
  const dataStr = JSON.stringify(data, null, 2)
  return res.type('json').send(dataStr)
}

function getProxyOrigin(req: Request) {
  const customHeaders = getCustomHeaderNames()
  let proxyOrigin = req.get(customHeaders.proxyOrigin)
  proxyOrigin = assertOrigin(proxyOrigin)
  return proxyOrigin
}
