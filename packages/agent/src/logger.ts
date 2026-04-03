/**
 * 结构化日志工具
 *
 * 提供统一的日志接口，输出结构化格式：
 * { timestamp, level, component, message, context }
 *
 * 日志级别：debug, info, warn, error
 * 关键事件必须记录：启动、错误、恢复、关闭
 */

// ============================================================================
// Types
// ============================================================================

/**
 * 日志级别
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * 日志条目
 */
export interface LogEntry {
	timestamp: string;
	level: LogLevel;
	component: string;
	message: string;
	context?: Record<string, unknown>;
}

/**
 * 日志配置
 */
export interface LoggerConfig {
	/** 最小日志级别 */
	minLevel?: LogLevel;
	/** 是否输出到控制台 */
	console?: boolean;
	/** 自定义输出处理器 */
	handler?: (entry: LogEntry) => void;
}

// ============================================================================
// Log Level Constants
// ============================================================================

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
};

// ============================================================================
// Logger Implementation
// ============================================================================

/**
 * 结构化日志记录器
 */
export class Logger {
	private readonly config: Required<LoggerConfig>;

	constructor(component: string, config: LoggerConfig = {}) {
		this.config = {
			minLevel: config.minLevel ?? (process.env.LOG_LEVEL as LogLevel) ?? "info",
			console: config.console ?? true,
			handler: config.handler ?? defaultHandler,
		};
		this.component = component;
	}

	readonly component: string;

	/**
	 * 记录 debug 级别日志
	 */
	debug(message: string, context?: Record<string, unknown>): void {
		this.log("debug", message, context);
	}

	/**
	 * 记录 info 级别日志
	 */
	info(message: string, context?: Record<string, unknown>): void {
		this.log("info", message, context);
	}

	/**
	 * 记录 warn 级别日志
	 */
	warn(message: string, context?: Record<string, unknown>): void {
		this.log("warn", message, context);
	}

	/**
	 * 记录 error 级别日志
	 */
	error(message: string, context?: Record<string, unknown>): void {
		this.log("error", message, context);
	}

	/**
	 * 记录带错误的 error 级别日志
	 */
	errorWithError(message: string, error: unknown, context?: Record<string, unknown>): void {
		const errorContext = {
			...context,
			error: error instanceof Error ? error.message : String(error),
			errorStack: error instanceof Error ? error.stack : undefined,
		};
		this.log("error", message, errorContext);
	}

	/**
	 * 创建子日志记录器（继承组件名作为前缀）
	 */
	child(subComponent: string): Logger {
		return new Logger(`${this.component}:${subComponent}`, {
			minLevel: this.config.minLevel,
			console: this.config.console,
			handler: this.config.handler,
		});
	}

	private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
		if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[this.config.minLevel]) {
			return;
		}

		const entry: LogEntry = {
			timestamp: new Date().toISOString(),
			level,
			component: this.component,
			message,
			context,
		};

		this.config.handler(entry);
	}
}

/**
 * 默认日志处理器 - 输出到控制台
 */
function defaultHandler(entry: LogEntry): void {
	const { timestamp, level, component, message, context } = entry;

	// 构建前缀
	const prefix = `[${timestamp}] [${level.toUpperCase()}] [${component}]`;

	// 根据级别选择输出方式
	switch (level) {
		case "debug":
			console.debug(prefix, message, context ? JSON.stringify(context) : "");
			break;
		case "info":
			console.info(prefix, message, context ? JSON.stringify(context) : "");
			break;
		case "warn":
			console.warn(prefix, message, context ? JSON.stringify(context) : "");
			break;
		case "error":
			console.error(prefix, message, context ? JSON.stringify(context) : "");
			break;
	}
}

// ============================================================================
// Global Logger Registry
// ============================================================================

const loggers = new Map<string, Logger>();
let globalConfig: LoggerConfig = {};

/**
 * 获取或创建日志记录器
 */
export function getLogger(component: string, config?: LoggerConfig): Logger {
	const key = component;
	if (!loggers.has(key)) {
		loggers.set(key, new Logger(component, { ...globalConfig, ...config }));
	}
	return loggers.get(key)!;
}

/**
 * 设置全局日志配置
 */
export function setGlobalLoggerConfig(config: LoggerConfig): void {
	globalConfig = config;
	// 更新现有日志记录器的配置
	for (const [key, logger] of loggers) {
		loggers.set(key, new Logger(logger.component, config));
	}
}

/**
 * 清除所有日志记录器缓存
 */
export function clearLoggers(): void {
	loggers.clear();
}

// ============================================================================
// Convenience Exports
// ============================================================================

/**
 * 快速创建日志条目（用于内联日志）
 */
export function log(level: LogLevel, component: string, message: string, context?: Record<string, unknown>): void {
	const logger = getLogger(component);
	switch (level) {
		case "debug":
			logger.debug(message, context);
			break;
		case "info":
			logger.info(message, context);
			break;
		case "warn":
			logger.warn(message, context);
			break;
		case "error":
			logger.error(message, context);
			break;
	}
}

/**
 * 快速记录 debug 日志
 */
export function debug(component: string, message: string, context?: Record<string, unknown>): void {
	getLogger(component).debug(message, context);
}

/**
 * 快速记录 info 日志
 */
export function info(component: string, message: string, context?: Record<string, unknown>): void {
	getLogger(component).info(message, context);
}

/**
 * 快速记录 warn 日志
 */
export function warn(component: string, message: string, context?: Record<string, unknown>): void {
	getLogger(component).warn(message, context);
}

/**
 * 快速记录 error 日志
 */
export function error(component: string, message: string, context?: Record<string, unknown>): void {
	getLogger(component).error(message, context);
}
