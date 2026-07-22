import type {Logger, LogLevel} from "./Logger.ts"

export class NullLogger implements Logger {
  error(_message: string, ..._meta: unknown[]): void {}
  warn(_message: string, ..._meta: unknown[]): void {}
  info(_message: string, ..._meta: unknown[]): void {}
  debug(_message: string, ..._meta: unknown[]): void {}
  trace(_message: string, ..._meta: unknown[]): void {}
  log(_level: LogLevel, _message: string, ..._meta: unknown[]): void {}
  child(_bindings: Record<string, unknown>): Logger {
    return this
  }
}
