import { Writable } from 'node:stream'
// import build from 'pino-abstract-transport'
import type { RawLoggerOptions } from '../types/logger-types';

function createTransport(opts?: RawLoggerOptions) {
  return new Writable({
    write(chunk, _enc, cb) {
      // Note: chunk is a `Buffer`
      // Note: Logs come as newline-delimited JSON (NDJSON)
      const lines = chunk.toString().split('\n').filter(Boolean)

      // for (const line of lines) {
      //   console.log(line)
      // }
      // cb()

      for (const line of lines) {
        // process.stdout.write(line + '\n', cb)
        process.stdout.write(line + '\n')
      }
      cb()
    }
  })
}

export = createTransport
