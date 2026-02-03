import express from 'express';
import type { Request, Response, RequestHandler, Handler, NextFunction } from 'express'
import { APP_CLIENT_NAME, Environment, authBodyParser, assertPath, assertRequestMode, getHostname, isLocalHostname, getRequestMetadata, getAuthClientMountPath, getCustomRedirectFunc, isIgnoreRequest, getLoggerInstance } from '@onelyid/common'
import { destroySession, getSessionUser, initAuthFlow } from './auth';
import { authProxyMiddleware } from './proxy-middleware';
import { getAppPackageName } from './utils';
import type { AuthMiddlewareConfig, Logger, UserInfo } from './types/common';

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

export const authMiddleware = (config?: AuthMiddlewareConfig): RequestHandler => {
  const subApp = express()

  // Note: This allows `req.protocol` to use 'x-forwarded-proto' header
  subApp.set('trust proxy', true)

  subApp.disable('x-powered-by')

  subApp.use(handler(authBodyParser))

  const packageName = getAppPackageName()
  const loggerName = APP_CLIENT_NAME
  const logger = getLoggerInstance(config?.logger, {
    name: packageName ?? loggerName,
  })

  // gate middleware
  subApp.use(handler(async (req, res, next) => {
    if (isIgnoreRequest(req, res, next)) {
      return
    }

    const authClientMountPath = getAuthClientMountPath()

    const deferLog = req.path === `${authClientMountPath}/callback`
    const metadataOptions = { loggerName, mode: config?.mode, deferLog }

    const reqLogger = logger.child({
      child_name: loggerName,
      ...getRequestMetadata(req, res, metadataOptions),
    })

    reqLogger.trace('New request')

    req.ctx = {
      logger: reqLogger,
    }

    // Note: Must be set before `req.protocol` is used anywhere
    // Note: 'trust proxy' must be set for consuming 'x-forwarded-proto' header
    setForwardedHeader(req);

    // Freeze request context, e.g. `req.protocol`
    freezeConnectionContext(req);

    req.mode = assertRequestMode(config?.mode) || Environment.Prod

    req.authFlow = () => initAuthFlow(req, res, config)
    req.getAuth = () => setReqAuth(req, res)

    res.clearAuth = () => deleteSession(req, res)

    // custom json response
    res.json = (data: unknown) => sendJson(res, data)

    // custom redirect function
    res.redirect = getCustomRedirectFunc(req, res)

    next()
  }))

  subApp.use(handler(authProxyMiddleware))

  return subApp
}

function setForwardedHeader(req: Request) {
  const hostname = getHostname(req)
  const isLocalhost = isLocalHostname(hostname)
  if (!isLocalhost && req.headers['x-forwarded-proto'] !== 'https') {
    req.headers['x-forwarded-proto'] = 'https'
  }
}

function freezeConnectionContext(req: Request) {
  // Compute values while subApp context is active
  const protocol = req.protocol
  const secure = req.secure
  const ip = req.ip

  // Freeze them onto the request
  Object.defineProperty(req, 'protocol', {
    value: protocol,
    configurable: true,
    enumerable: true,
    writable: false
  })
  Object.defineProperty(req, 'secure', {
    value: secure,
    configurable: true,
    enumerable: true,
    writable: false
  })
  Object.defineProperty(req, 'ip', {
    value: ip,
    configurable: true,
    enumerable: true,
    writable: false
  })
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

  const { user, error } = await getSessionUser(req, res)
  if (error) {
    req.ctx.logger.error('[setReqAuth]', error)
  }

  if (!error && user) {
    req.auth = user
  }
  if (!req.auth) {
    req.auth = null
  }
  return req.auth
}

async function deleteSession(req: Request, res: Response) {
  const { ok, error } = await destroySession(req, res)
  if (!ok || error) {
    req.ctx.logger.error('[deleteSession]', { ok, error });
  }
}

function sendJson(res: Response, data: unknown) {
  const dataStr = JSON.stringify(data, null, 2)
  return res.type('json').send(dataStr)
}
