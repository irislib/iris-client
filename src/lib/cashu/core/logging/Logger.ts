export type LogLevel = "error" | "warn" | "info" | "debug" | "trace"

export interface Logger {
  error(message: string, ...meta: unknown[]): void
  warn(message: string, ...meta: unknown[]): void
  info(message: string, ...meta: unknown[]): void
  debug(message: string, ...meta: unknown[]): void
  trace(message: string, ...meta: unknown[]): void
  log(level: LogLevel, message: string, ...meta: unknown[]): void
  child?(bindings: Record<string, unknown>): Logger
}
