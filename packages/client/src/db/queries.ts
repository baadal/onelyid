import crypto from 'node:crypto'
import type { Database } from './db';
import { COOKIE_SECRET_KEY, STATE_SECRET_KEY } from '../const';

export async function getOrCreateAppSecret(db: Database, keyName: string, bytesLength = 32) {
  const existing = await db
    .selectFrom('app_secrets')
    .select('value')
    .where('key', '=', keyName)
    .executeTakeFirst()

  if (existing) {
    return existing.value
  }

  // equivalent to `openssl rand -hex 32`
  const secret = crypto.randomBytes(bytesLength).toString('hex')

  await db
    .insertInto('app_secrets')
    .values({
      key: keyName,
      value: secret,
    })
    .onConflict((oc) => oc.doNothing())
    .execute()

  return secret
}

export async function getOrCreateCookieSecret(db: Database) {
  return getOrCreateAppSecret(db, COOKIE_SECRET_KEY)
}

export async function getOrCreateStateSecret(db: Database) {
  return getOrCreateAppSecret(db, STATE_SECRET_KEY)
}
