type LoggerFunc = (...args: unknown[]) => void

export type Logger = {
  error: LoggerFunc;
  warn: LoggerFunc;
  info: LoggerFunc;
  debug: LoggerFunc;
  trace: LoggerFunc;
}

export type RawLoggerOptions = {
  verbose?: boolean
}

export type FileLoggerOptions = {
  destination?: string
}

export type AwsLoggerOptions = {
  table?: string;
}
