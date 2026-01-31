import express from 'express';
import type { Request, Response, RequestHandler } from 'express'
import { assertPath } from '@onelyid/common'
import { destroySession, getSessionUser, initAuthFlow } from './session';
import { AuthMiddlewareConfig } from './types/common';

export const authMiddleware = (config?: AuthMiddlewareConfig): RequestHandler => {
  const router = express.Router()

  // gate middleware
  router.use(async (req, res, next) => {
    req.authFlow = () => initAuthFlow(req, res, config);
    req.getAuth = () => setReqAuth(req);

    res.clearAuth = () => deleteSession(req, res);

    // custom json response
    res.json = (data: unknown) => sendJson(res, data)

    next()
  })

  return router
}

export const setAuth: RequestHandler = async (req, _res, next) => {
  await setReqAuth(req)
  next()
};

export const redirect: (path: string) => RequestHandler = (redirectPath: string) => (async (req, res, next) => {
  await setReqAuth(req)
  if (!req.auth) {
    const path = assertPath(redirectPath ?? '/');
    return res.redirect(path)
  }
  next()
}) satisfies RequestHandler;

async function setReqAuth(req: Request) {
  const { user, error } = await getSessionUser(req)
  if (error) {
    console.error('[setReqAuth]', error);
  }

  if (!error && user) {
    req.auth = user
  }
  if (!req.auth) {
    req.auth = null
  }
}

async function deleteSession(req: Request, res: Response) {
  const { ok, error } = await destroySession(req, res)
  if (!ok || error) {
    console.error('[deleteSession]', { ok, error });
  }
}

function sendJson(res: Response, data: unknown) {
  const dataStr = JSON.stringify(data, null, 2)
  return res.type('json').send(dataStr)
}
