/**
 * 内存包结构化日志工具。
 *
 * 这里保持包内自洽，避免依赖 agent 包的 logger 实现。
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  errorWithError(message: string, error: unknown, context?: Record<string, unknown>): void;
}

function log(level: LogLevel, component: string, message: string, context?: Record<string, unknown>): void {
  const prefix = `[${new Date().toISOString()}] [${level.toUpperCase()}] [${component}]`;
  const payload = context ? JSON.stringify(context) : "";

  switch (level) {
    case "debug":
      console.debug(prefix, message, payload);
      break;
    case "info":
      console.info(prefix, message, payload);
      break;
    case "warn":
      console.warn(prefix, message, payload);
      break;
    case "error":
      console.error(prefix, message, payload);
      break;
  }
}

/**
 * 获取内存包的日志记录器。
 */
export function getLogger(component: string): Logger {
  const loggerComponent = `memory:${component}`;

  return {
    debug(message, context) {
      log("debug", loggerComponent, message, context);
    },
    info(message, context) {
      log("info", loggerComponent, message, context);
    },
    warn(message, context) {
      log("warn", loggerComponent, message, context);
    },
    error(message, context) {
      log("error", loggerComponent, message, context);
    },
    errorWithError(message, error, context) {
      log("error", loggerComponent, message, {
        ...context,
        error: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
      });
    },
  };
}
