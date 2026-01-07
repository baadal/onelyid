import type { IncomingMessage, ServerResponse } from 'node:http'
import { getIronSession } from 'iron-session'
import { getBaseDomain } from '@onelyid/common'
import { Session } from './types/common'

export async function getSession(
  req: IncomingMessage,
  res: ServerResponse<IncomingMessage>,
  cookieSecret: string,
) {
  const host = (req as any).hostname;
  const baseDomain = getBaseDomain(host);
  const cookieDomain = baseDomain ? `.${baseDomain}` : undefined;

  const session = await getIronSession<Session>(req, res, {
    cookieName: 'sid',
    password: cookieSecret,
    cookieOptions: {
      domain: cookieDomain,
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
    }
  })
  return session;
}
