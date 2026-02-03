import build from 'pino-abstract-transport'
import { getUuid } from '../utils';
import { consoleError } from '../logger';
import type { RawLoggerOptions } from '../types/logger-types';

function createTransport(opts?: RawLoggerOptions) {
  return build(async function (source) {
    for await (const obj of source) {
      try {
        // obj is already parsed JSON
        const item = { id: getUuid(), ...obj }
        const log = JSON.stringify(item)

        const showLog = opts?.verbose || obj.level_name !== 'trace'
        if (showLog) {
          // Note: Avoid `process.stdout.write` as `console.log` is better managed to avoid pipe errors
          // process.stdout.write(log + '\n')
          console.log(log);
        }
      } catch(err) {
        consoleError('transport error:', err);
      }
    }
  })
}

export = createTransport
