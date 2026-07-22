/* eslint-disable no-console -- this logger is the explicit console adapter */
import type {Logger, LogLevel} from "./Logger.ts"

type ConsoleLoggerOptions = {
  level?: LogLevel // minimum level to log
}

export class ConsoleLogger implements Logger {
  private prefix: string
  private level: LogLevel

  private static readonly levelPriority: Record<LogLevel, number> = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
    trace: 4,
  }

  constructor(prefix = "coco-cashu", options: ConsoleLoggerOptions = {}) {
    this.prefix = prefix
    this.level = options.level ?? "info"
  }

  private shouldLog(level: LogLevel): boolean {
    return ConsoleLogger.levelPriority[level] <= ConsoleLogger.levelPriority[this.level]
  }

  error(message: string, ...meta: unknown[]): void {
    if (!this.shouldLog("error")) return

    console.error(`[${this.prefix}] ERROR: ${message}`, ...meta)
  }
  warn(message: string, ...meta: unknown[]): void {
    if (!this.shouldLog("warn")) return

    console.warn(`[${this.prefix}] WARN: ${message}`, ...meta)
  }
  info(message: string, ...meta: unknown[]): void {
    if (!this.shouldLog("info")) return

    console.info(`[${this.prefix}] INFO: ${message}`, ...meta)
  }
  debug(message: string, ...meta: unknown[]): void {
    if (!this.shouldLog("debug")) return

    console.debug(`[${this.prefix}] DEBUG: ${message}`, ...meta)
  }
  trace(message: string, ...meta: unknown[]): void {
    if (!this.shouldLog("trace")) return

    console.debug(`[${this.prefix}] TRACE: ${message}`, ...meta)
  }
  log(level: LogLevel, message: string, ...meta: unknown[]): void {
    switch (level) {
      case "error":
        this.error(message, ...meta)
        break
      case "warn":
        this.warn(message, ...meta)
        break
      case "info":
        this.info(message, ...meta)
        break
      case "debug":
        this.debug(message, ...meta)
        break
      case "trace":
        this.trace(message, ...meta)
        break
    }
  }
  child(bindings: Record<string, unknown>): Logger {
    const name = [
      this.prefix,
      ...Object.entries(bindings).map(([k, v]) => `${k}=${String(v)}`),
    ].join(" ")
    return new ConsoleLogger(name, {level: this.level})
  }
}
