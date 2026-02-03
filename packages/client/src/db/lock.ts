import type { RuntimeLock } from '@atproto/oauth-client'
import type { Database2 } from './db2'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export const sqliteRequestLock =
  (db: Database2): RuntimeLock =>
  async <T>(
    name: string,
    fn: () => T | PromiseLike<T>
  ): Promise<T> => {
    // acquire
    while (true) {
      try {
        await db
          .insertInto('oauth_lock')
          .values({ key: name })
          .execute()
        break
      } catch {
        await sleep(50)
      }
    }

    try {
      return await fn()
    } finally {
      // release
      await db
        .deleteFrom('oauth_lock')
        .where('key', '=', name)
        .execute()
    }
  }
