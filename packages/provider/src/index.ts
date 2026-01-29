import { Router } from 'express';
import { AppContext, envToCfg, envToSecrets, readEnv } from '@atproto/pds'
import { createRouter } from './auth-routes';

export async function oauthMiddleware(): Promise<Router> {
  const env = readEnv()
  const cfg = envToCfg(env)
  const secrets = envToSecrets(env)
  const ctx = await AppContext.fromConfig(cfg, secrets)
  return createRouter(ctx)
}
