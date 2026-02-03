import path from 'node:path'
import fs from 'node:fs'
import pino from 'pino'
import { getAuthClientMountPath } from './host';
import type { Logger, FileLoggerOptions, AwsLoggerOptions, RawLoggerOptions } from './types/logger-types';

export type LoggerConfig = {
  name?: string;
  awsLoggerOptions?: AwsLoggerOptions;
  fileLoggerOptions?: FileLoggerOptions;
  rawLoggerOptions?: RawLoggerOptions;
  appRoutes?: string[],
  verbose?: boolean;
}

export type LoggerType = 'raw' | 'pretty' | 'file' | 'aws' | 'external'
export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace'

type LogContext = Record<string, unknown>
type LogTuple = [any, string]
type InitOpts = {
  verbose?: boolean;
  appRoutes?: string[],
}

export class WrappedLogger<C extends LogContext = {}> {
  private logQueue: LogTuple[] = []
  private verbose: boolean | undefined
  private appRoutes: string[] = []

  constructor(private logger: Logger, private logger2: pino.Logger | null, private loggerType: LoggerType, private context: C, initOpts: InitOpts) {
    this.verbose = initOpts.verbose
    this.appRoutes = initOpts.appRoutes ?? []
  }

  child<NC extends LogContext>(extra: NC): WrappedLogger<C | C & NC> {
    if (this.loggerType === 'external') {
      return new WrappedLogger(this.logger, null, this.loggerType, { ...this.context }, {})
    }

    const newCtx = { ...this.context, ...extra }

    // const logger = (this.logger as any).child ? (this.logger as any).child({}) : this.logger
    const logger = this.logger

    return new WrappedLogger(logger, this.logger2, this.loggerType, newCtx as C & NC, { verbose: this.verbose, appRoutes: this.appRoutes })
  }

  update<NC extends LogContext>(ctx: NC): void {
    if (this.loggerType === 'external') return

    this.context = { ...this.context, ...ctx }
  }

  flush(cb?: (err?: Error) => void): void {
    if (this.loggerType === 'external') return

    if (this.logQueue.length) {
      const messages = this.logQueue.map(t => t[1])
      this.logQueue = []
      const logTuple = this.getLog('trace', messages)
      if (logTuple) {
        const [ctx, msg] = logTuple
        this.logger.info?.(ctx, msg)
      }
    }

    if ((this.logger as any).flush) {
      (this.logger as any).flush(cb)
    } else {
      if (cb) cb()
    }
  }

  error(...messages: any[]) {
    if (this.loggerType === 'external') {
      return this.logger.error?.(...messages)
    }
    if (this.logQueue.length) {
      this.logQueue.map(t => this.logger.info?.(...t))
      this.logQueue = []
    }

    const logTuple = this.getLog('error', messages)
    if (logTuple) {
      const [ctx, msg] = logTuple
      this.logger.error?.(ctx, msg)
      this.logger2?.error?.(ctx, msg)
    }
  }

  warn(...messages: any[]) {
    if (this.loggerType === 'external') {
      return this.logger.warn?.(...messages)
    }

    const logTuple = this.getLog('warn', messages)
    if (logTuple) {
      const [ctx, msg] = logTuple
      this.logger.warn?.(ctx, msg)
      this.logger2?.warn?.(ctx, msg)
    }
  }

  info(...messages: any[]) {
    if (this.loggerType === 'external') {
      return this.logger.info?.(...messages)
    }

    const logTuple = this.getLog('info', messages)
    if (logTuple) {
      const [ctx, msg] = logTuple
      this.logger.info?.(ctx, msg)
      this.logger2?.info?.(ctx, msg)
    }
  }

  debug(...messages: any[]) {
    if (this.loggerType === 'external') {
      return this.logger.debug?.(...messages)
    }

    const logTuple = this.getLog('debug', messages)
    if (logTuple) {
      const [ctx, msg] = logTuple
      this.logger.info?.(ctx, msg)
      this.logger2?.info?.(ctx, msg)
    }
  }

  trace(...messages: any[]) {
    if (this.loggerType === 'external') {
      return this.logger.trace?.(...messages)
    }
    if (this.loggerType === 'pretty') return

    const logTuple = this.getLog('trace', messages)
    if (logTuple) {
      const [ctx, msg] = logTuple
      this.logger.info?.(ctx, msg) // Note: using `info` instead of `trace` (as `trace` does not log)
      if (this.verbose) this.logger2?.info?.(ctx, msg)
    }
  }

  defer(...messages: any[]) {
    if (this.loggerType === 'external') return

    const logTuple = this.getLog('trace', messages)
    if (logTuple) {
      const [ctx, msg] = logTuple
      this.logQueue.push([ctx, msg]) // enqueue log
      if (this.verbose) this.logger2?.info?.(ctx, msg)
    }
  }

  private getLog(level: LogLevel, messages: any[]): LogTuple | null {
    let logCtx = {};
    let allMessages = messages;
    if (messages.length > 1 && typeof messages[0] === 'object') {
      logCtx = messages[0]
      allMessages = messages.slice(1)
    }

    let msg = allMessages.map(toString).map(s => s.trim()).join('\n')
    if (level === 'debug') {
      msg = `\n---\n${msg}\n---`
    }

    const datetime = new Date()
    let ctx: any = {
      ...this.context,
      ...logCtx,
      // time: datetime.getTime(),
      tdate: Math.floor(datetime.getTime() / (24*3600*1000)),
      level_name: level,
    }

    let isAuthClientRequest = false
    let isAppRoute = false
    let isCrawlerRoute = false
    if (ctx.path) {
      const authClientMountPath = getAuthClientMountPath()
      isAuthClientRequest = ctx.path === '/oauth-client-metadata.json' || ctx.path.startsWith(authClientMountPath)
      isAppRoute = this.appRoutes.includes(ctx.path)
      isCrawlerRoute = ['/robots.txt', '/sitemap.xml'].includes(ctx.path)
    }
    const showLog = !ctx.path || isAuthClientRequest || isAppRoute || isCrawlerRoute
    if (!showLog) {
      // return null
      ctx.type = 'sus'; // log as 'sus' (for short-term investigation) rather than not logging at all
    }

    if (this.loggerType === 'pretty') {
      const pinoBaseKeys = ['level', 'time', 'pid', 'hostname', 'name', 'msg']
      ctx = Object.fromEntries(
        Object.entries(ctx).filter(([k]) => pinoBaseKeys.includes(k))
      )
    }
    return [ctx, msg]
  }
}

function toString(v: any) {
  return stringify(replaceErrors(v))
}

function replaceErrors(value: unknown): unknown {
  if (value instanceof Error) {
    const err = value
    return err.stack || err.toString();
  }
  if (Array.isArray(value)) {
    return value.map(replaceErrors);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, replaceErrors(v)])
    );
  }
  return value;
}

function stringify(v: any) {
  if (Array.isArray(v) || typeof v === 'object') {
    return JSON.stringify(v, null, 2)
  } else {
    return String(v)
  }
}

export function createPrettyLogger<C extends LogContext = {}>(options: LoggerConfig, context?: C) {
  const name = options.name ?? 'pretty-logger'
  const logger = pino({
      name,
      transport: {
        target: 'pino-pretty',
      },
  })
  return new WrappedLogger(logger, null, 'pretty', { ...(context ?? {}) }, { verbose: options.verbose, appRoutes: options.appRoutes })
}

function createRawPinoLogger(options: LoggerConfig) {
  const name = options.name ?? 'raw-logger'
  return pino({
      name,
      transport: {
        // target: path.join(__dirname, 'transports', 'raw-transport.js'),
        target: path.join(__dirname, 'transports', 'build-transport.js'),
        options: { verbose: options.verbose }
      },
  })
}
function createRawLogger<C extends LogContext = {}>(options: LoggerConfig, context?: C) {
  const logger = createRawPinoLogger(options)
  return new WrappedLogger(logger, null, 'raw', { ...(context ?? {}) }, { verbose: options.verbose, appRoutes: options.appRoutes })
}

function createFilePinoLogger(options: LoggerConfig) {
  const name = options.name ?? 'file-logger'
  const dest = path.resolve(options.fileLoggerOptions?.destination || './app.log')
  const logDir = path.dirname(dest)

  // Note: ensure that `logDir` must exist (otherwise pino will throw error)
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true })
  }
  return pino({
    name,
    transport: {
      target: 'pino/file',
      options: { destination: dest },
    },
  })
}
// function createFileLogger<C extends LogContext = {}>(options: LoggerConfig, context?: C) {
//   const logger = createFilePinoLogger(options)
//   return new WrappedLogger(logger, null, 'file', { ...(context ?? {}) }, { verbose: options.verbose, appRoutes: options.appRoutes })
// }

function createAwsPinoLogger(options: LoggerConfig) {
  const name = options.name ?? 'aws-logger'
  const table = options.awsLoggerOptions?.table
  if (!table) {
    throw new Error('table name not provided!')
  }
  return pino({
      name,
      transport: {
        targets: [
          { target: path.join(__dirname, 'transports', 'aws-transport.js'), options: { table } },
          // Note: Avoid multiple transports (to avoid `write EPIPE` errors)
        ]
      },
  })
}
function createAwsLogger<C extends LogContext = {}>(options: LoggerConfig, context?: C, logger2?: pino.Logger) {
  const logger = createAwsPinoLogger(options)
  return new WrappedLogger(logger, logger2 ?? pino(pino.destination({ sync: true })), 'aws', { ...(context ?? {}) }, { verbose: options.verbose, appRoutes: options.appRoutes })
}

function createExternalLogger(logger: Logger) {
  return new WrappedLogger(logger, null, 'external', {}, {})
}

export function createLogger<C extends LogContext = {}>(options: LoggerConfig, context?: C) {
  options.name = options.name ?? 'default-logger'

  if (options.awsLoggerOptions) {
    let logger2: pino.Logger
    if (options.fileLoggerOptions) {
      logger2 = createFilePinoLogger(options)
    } else {
      logger2 = createRawPinoLogger(options)
    }
    return createAwsLogger(options, context, logger2)
  }

  if (options.rawLoggerOptions) {
    return createRawLogger(options, context)
  }

  return createPrettyLogger(options, context)
}

export function getLoggerInstance<C extends LogContext = {}>(logger: Logger | undefined, options: LoggerConfig, context?: C) {
  if (!logger) {
    return createLogger(options, context)
  } else if (logger instanceof WrappedLogger) {
    return logger as WrappedLogger<C>
  } else {
    return createExternalLogger(logger)
  }
}

export function consoleError(...messages: any[]) {
  console.error(...messages)

  const timeStr = `[${new Date().toISOString()}]`
  let msg = [timeStr, ...messages].map(toString).map(s => s.trim()).join('\n')
  const logDir = path.join(process.cwd(), 'logs')
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true })
  }
  fs.appendFileSync(path.join(logDir, 'app.err.log'), msg + '\n\n', { encoding: 'utf8' })
}
