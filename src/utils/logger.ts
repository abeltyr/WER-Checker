import chalk from "chalk"

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent"

export interface LogEntry {
  timestamp: string
  level: LogLevel
  module: string
  message: string
  data?: Record<string, any>
}

class Logger {
  private level: LogLevel = "info"
  private readonly levels: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    silent: 4,
  }

  setLevel(level: LogLevel): void {
    this.level = level
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levels[level] >= this.levels[this.level]
  }

  private formatTimestamp(): string {
    return new Date().toISOString()
  }

  private formatEntry(entry: LogEntry): string {
    const timestamp = chalk.gray(entry.timestamp)
    const levelColors: Record<LogLevel, string> = {
      debug: chalk.magenta("DEBUG"),
      info: chalk.blue("INFO"),
      warn: chalk.yellow("WARN"),
      error: chalk.red("ERROR"),
      silent: "",
    }
    const level = levelColors[entry.level]
    const module = chalk.cyan(`[${entry.module}]`)

    let message = `${timestamp} ${level} ${module} ${entry.message}`
    if (entry.data) {
      message += ` ${chalk.gray(JSON.stringify(entry.data))}`
    }

    return message
  }

  debug(module: string, message: string, data?: Record<string, any>): void {
    if (!this.shouldLog("debug")) return
    console.log(this.formatEntry({
      timestamp: this.formatTimestamp(),
      level: "debug",
      module,
      message,
      data,
    }))
  }

  info(module: string, message: string, data?: Record<string, any>): void {
    if (!this.shouldLog("info")) return
    console.log(this.formatEntry({
      timestamp: this.formatTimestamp(),
      level: "info",
      module,
      message,
      data,
    }))
  }

  warn(module: string, message: string, data?: Record<string, any>): void {
    if (!this.shouldLog("warn")) return
    console.warn(this.formatEntry({
      timestamp: this.formatTimestamp(),
      level: "warn",
      module,
      message,
      data,
    }))
  }

  error(module: string, message: string, data?: Record<string, any>): void {
    if (!this.shouldLog("error")) return
    console.error(this.formatEntry({
      timestamp: this.formatTimestamp(),
      level: "error",
      module,
      message,
      data,
    }))
  }

  createModuleLogger(module: string): ModuleLogger {
    return new ModuleLogger(module, this)
  }
}

class ModuleLogger {
  constructor(
    private readonly module: string,
    private readonly logger: Logger
  ) {}

  debug(message: string, data?: Record<string, any>): void {
    this.logger.debug(this.module, message, data)
  }

  info(message: string, data?: Record<string, any>): void {
    this.logger.info(this.module, message, data)
  }

  warn(message: string, data?: Record<string, any>): void {
    this.logger.warn(this.module, message, data)
  }

  error(message: string, data?: Record<string, any>): void {
    this.logger.error(this.module, message, data)
  }
}

export const logger = new Logger()

export function createLogger(module: string): ModuleLogger {
  return logger.createModuleLogger(module)
}
