import build from 'pino-abstract-transport'
import { aws } from '@baadal-sdk/dapi'
import { getUuid } from '../utils'
import { consoleError } from '../logger'
import type { AwsLoggerOptions } from '../types/logger-types'

function createTransport(opts?: AwsLoggerOptions) {
  return build(async function (source) {
    for await (const obj of source) {
      try {
        const item = { id: getUuid(), ...obj }

        // Note: removing `await` can cause unbounded fire-and-forget
        const retItem = await aws.db.writeItemUnique({ table: opts?.table as string, item })
        if (!retItem) {
          throw new Error(`writeItemUnique failed! Item: ${JSON.stringify(item)}`)
        }
      } catch(err) {
        consoleError('aws-transport error:', err);
      }
    }
  })
}

export = createTransport
