/**
 * 结构化日志工具 - 为 OMI 项目提供观测性支持
 *
 * 日志格式: { timestamp, level, component, message, context }
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  context?: Record<string, unknown>;
}

export interface LoggerOptions {
  component: string;
  minLevel?: LogLevel;
  enableConsole?: boolean;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * 创建结构化日志记录器
 */
export function createLogger(options: LoggerOptions) {
  const { component, minLevel = "info", enableConsole = true } = options;
  const minPriority = LOG_LEVEL_PRIORITY[minLevel];

  function shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= minPriority;
  }

  function log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (!shouldLog(level)) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      component,
      message,
      context,
    };

    if (enableConsole) {
      const consoleMethod = level === "error" ? console.error :
        level === "warn" ? console.warn :
        level === "debug" ? console.debug :
        console.log;

      const contextStr = context ? ` ${JSON.stringify(context)}` : "";
      consoleMethod(`[${entry.timestamp}] [${level.toUpperCase()}] [${component}] ${message}${contextStr}`);
    }

    // 可以在这里添加其他日志输出目标（文件、远程服务等）
  }

  return {
    debug: (message: string, context?: Record<string, unknown>) => log("debug", message, context),
    info: (message: string, context?: Record<string, unknown>) => log("info", message, context),
    warn: (message: string, context?: Record<string, unknown>) => log("warn", message, context),
    error: (message: string, context?: Record<string, unknown>) => log("error", message, context),
  };
}

export type Logger = ReturnType<typeof createLogger>;
