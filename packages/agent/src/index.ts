// Public API exports only — internal modules are not re-exported
export * from "./agent-session";
export * from "./orchestrator";
export * from "./session-manager";
export * from "./resource-loader";
export * from "./skills/index.js";
export * from "./event-bus";

// Telemetry and Audit Log
export * from "./telemetry";
export * from "./audit-log";

// Observability
export * from "./logger";
export {
	createLogger,
	type LogEntry as ObservabilityLogEntry,
	type LogLevel as ObservabilityLogLevel,
	type Logger as ObservabilityLogger,
} from "./observability";

// Narrowed internal module exports
export * from "./bash-executor";
export * from "./slash-commands";
export * from "./prompt-templates";
export * from "./modes";
export * from "./vcs";
