/**
 * Telemetry - 运行生命周期事件标准化
 *
 * 提供统一的事件发射接口，用于追踪：
 * - Run 生命周期（start, complete, fail, cancel）
 * - Compaction 观测（触发原因、释放 token、失败次数）
 * - SubAgent 观测（spawn/finish/fail/background）
 * - MCP 连接观测（状态变化、重连次数、认证失败）
 */

import { EventEmitter } from "node:events";
import { createEventBus, type EventBusController } from "./event-bus.js";

// ============================================================================
// Event Types
// ============================================================================

/**
 * Run 生命周期事件
 */
export type RunEvent =
	| RunStartedEvent
	| RunCompletedEvent
	| RunFailedEvent
	| RunCancelledEvent
	| RunBlockedEvent;

/**
 * Run 开始事件
 */
export interface RunStartedEvent {
	type: "run:started";
	sessionId: string;
	runId: string;
	prompt: string;
	model?: string;
	provider?: string;
	timestamp: string;
}

/**
 * Run 完成事件
 */
export interface RunCompletedEvent {
	type: "run:completed";
	sessionId: string;
	runId: string;
	responseLength: number;
	durationMs: number;
	tokenUsage?: TokenUsage;
	timestamp: string;
}

/**
 * Run 失败事件
 */
export interface RunFailedEvent {
	type: "run:failed";
	sessionId: string;
	runId: string;
	error: string;
	errorCode?: string;
	durationMs: number;
	timestamp: string;
}

/**
 * Run 取消事件
 */
export interface RunCancelledEvent {
	type: "run:cancelled";
	sessionId: string;
	runId: string;
	reason?: string;
	durationMs: number;
	timestamp: string;
}

/**
 * Run 阻塞事件
 */
export interface RunBlockedEvent {
	type: "run:blocked";
	sessionId: string;
	runId: string;
	toolCallId: string;
	toolName: string;
	timestamp: string;
}

/**
 * Token 使用量
 */
export interface TokenUsage {
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	cacheCreationTokens?: number;
	cacheReadTokens?: number;
}

/**
 * Compaction 事件
 */
export type CompactionEvent =
	| CompactionRequestedEvent
	| CompactionStartedEvent
	| CompactionCompletedEvent
	| CompactionFailedEvent;

export interface CompactionRequestedEvent {
	type: "compaction:requested";
	sessionId: string;
	reason: string;
	currentMessageCount: number;
	currentTokenCount: number;
	timestamp: string;
}

export interface CompactionStartedEvent {
	type: "compaction:started";
	sessionId: string;
	timestamp: string;
}

export interface CompactionCompletedEvent {
	type: "compaction:completed";
	sessionId: string;
	tokensFreed: number;
	messagesBefore: number;
	messagesAfter: number;
	durationMs: number;
	timestamp: string;
}

export interface CompactionFailedEvent {
	type: "compaction:failed";
	sessionId: string;
	error: string;
	durationMs: number;
	timestamp: string;
}

/**
 * SubAgent 事件
 */
export type SubAgentEvent =
	| SubAgentSpawnedEvent
	| SubAgentStartedEvent
	| SubAgentCompletedEvent
	| SubAgentFailedEvent
	| SubAgentBackgroundEvent
	| SubAgentForegroundEvent;

export interface SubAgentSpawnedEvent {
	type: "subagent:spawned";
	sessionId: string;
	subAgentId: string;
	name: string;
	isolated: boolean;
	timestamp: string;
}

export interface SubAgentStartedEvent {
	type: "subagent:started";
	sessionId: string;
	subAgentId: string;
	timestamp: string;
}

export interface SubAgentCompletedEvent {
	type: "subagent:completed";
	sessionId: string;
	subAgentId: string;
	durationMs: number;
	resultLength?: number;
	timestamp: string;
}

export interface SubAgentFailedEvent {
	type: "subagent:failed";
	sessionId: string;
	subAgentId: string;
	error: string;
	durationMs: number;
	timestamp: string;
}

export interface SubAgentBackgroundEvent {
	type: "subagent:background";
	sessionId: string;
	subAgentId: string;
	timestamp: string;
}

export interface SubAgentForegroundEvent {
	type: "subagent:foreground";
	sessionId: string;
	subAgentId: string;
	timestamp: string;
}

/**
 * MCP 连接事件
 */
export type McpConnectionEvent =
	| McpConnectedEvent
	| McpDisconnectedEvent
	| McpReconnectingEvent
	| McpAuthFailedEvent
	| McpErrorEvent;

export interface McpConnectedEvent {
	type: "mcp:connected";
	serverName: string;
	serverType: string;
	transport: string;
	latencyMs?: number;
	timestamp: string;
}

export interface McpDisconnectedEvent {
	type: "mcp:disconnected";
	serverName: string;
	serverType: string;
	reason?: string;
	timestamp: string;
}

export interface McpReconnectingEvent {
	type: "mcp:reconnecting";
	serverName: string;
	attemptNumber: number;
	maxAttempts: number;
	timestamp: string;
}

export interface McpAuthFailedEvent {
	type: "mcp:auth_failed";
	serverName: string;
	authType: string;
	error: string;
	timestamp: string;
}

export interface McpErrorEvent {
	type: "mcp:error";
	serverName: string;
	error: string;
	errorCode?: string;
	timestamp: string;
}

// ============================================================================
// Telemetry Service
// ============================================================================

/**
 * Telemetry 配置
 */
export interface TelemetryConfig {
	/** 是否启用遥测 */
	enabled?: boolean;
	/** 最大事件队列大小 */
	maxQueueSize?: number;
	/** 事件采样率 (0-1) */
	sampleRate?: number;
}

/**
 * Telemetry 服务
 * 统一的事件发射和收集服务
 */
export class TelemetryService {
	private readonly eventBus: EventBusController;
	private readonly config: Required<TelemetryConfig>;
	private readonly eventCounters = new Map<string, number>();

	constructor(config: TelemetryConfig = {}) {
		this.eventBus = createEventBus();
		this.config = {
			enabled: config.enabled ?? true,
			maxQueueSize: config.maxQueueSize ?? 10000,
			sampleRate: config.sampleRate ?? 1.0,
		};
	}

	/**
	 * 发射 Run 事件
	 */
	emitRunEvent(event: RunEvent): void {
		if (!this.config.enabled) return;
		this.incrementCounter(`run:${event.type}`);
		this.eventBus.emit("run", event);
		this.eventBus.emit(event.type, event);
	}

	/**
	 * 发射 Compaction 事件
	 */
	emitCompactionEvent(event: CompactionEvent): void {
		if (!this.config.enabled) return;
		this.incrementCounter(`compaction:${event.type}`);
		this.eventBus.emit("compaction", event);
		this.eventBus.emit(event.type, event);
	}

	/**
	 * 发射 SubAgent 事件
	 */
	emitSubAgentEvent(event: SubAgentEvent): void {
		if (!this.config.enabled) return;
		this.incrementCounter(`subagent:${event.type}`);
		this.eventBus.emit("subagent", event);
		this.eventBus.emit(event.type, event);
	}

	/**
	 * 发射 MCP 连接事件
	 */
	emitMcpConnectionEvent(event: McpConnectionEvent): void {
		if (!this.config.enabled) return;
		this.incrementCounter(`mcp:${event.type}`);
		this.eventBus.emit("mcp", event);
		this.eventBus.emit(event.type, event);
	}

	/**
	 * 订阅事件
	 */
	on(channel: "run" | "compaction" | "subagent" | "mcp" | string, handler: (event: unknown) => void): () => void {
		return this.eventBus.on(channel, handler);
	}

	/**
	 * 获取事件计数器
	 */
	getCounter(eventType: string): number {
		return this.eventCounters.get(eventType) ?? 0;
	}

	/**
	 * 获取所有计数器
	 */
	getAllCounters(): Record<string, number> {
		return Object.fromEntries(this.eventCounters);
	}

	/**
	 * 重置计数器
	 */
	resetCounters(): void {
		this.eventCounters.clear();
	}

	/**
	 * 清空事件总线
	 */
	clear(): void {
		this.eventBus.clear();
		this.eventCounters.clear();
	}

	private incrementCounter(eventType: string): void {
		const count = this.eventCounters.get(eventType) ?? 0;
		this.eventCounters.set(eventType, count + 1);
	}
}

// ============================================================================
// Run 事件发射辅助函数
// ============================================================================

/**
 * 发射 Run 开始事件
 */
export function emitRunStarted(
	sessionId: string,
	runId: string,
	prompt: string,
	options?: { model?: string; provider?: string },
): void {
	getGlobalTelemetry().emitRunEvent({
		type: "run:started",
		sessionId,
		runId,
		prompt,
		model: options?.model,
		provider: options?.provider,
		timestamp: new Date().toISOString(),
	});
}

/**
 * 发射 Run 完成事件
 */
export function emitRunCompleted(
	sessionId: string,
	runId: string,
	responseLength: number,
	durationMs: number,
	tokenUsage?: TokenUsage,
): void {
	getGlobalTelemetry().emitRunEvent({
		type: "run:completed",
		sessionId,
		runId,
		responseLength,
		durationMs,
		tokenUsage,
		timestamp: new Date().toISOString(),
	});
}

/**
 * 发射 Run 失败事件
 */
export function emitRunFailed(
	sessionId: string,
	runId: string,
	error: string,
	durationMs: number,
	errorCode?: string,
): void {
	getGlobalTelemetry().emitRunEvent({
		type: "run:failed",
		sessionId,
		runId,
		error,
		errorCode,
		durationMs,
		timestamp: new Date().toISOString(),
	});
}

// ============================================================================
// Compaction 事件发射辅助函数
// ============================================================================

/**
 * 发射 Compaction 请求事件
 */
export function emitCompactionRequested(
	sessionId: string,
	reason: string,
	currentMessageCount: number,
	currentTokenCount: number,
): void {
	getGlobalTelemetry().emitCompactionEvent({
		type: "compaction:requested",
		sessionId,
		reason,
		currentMessageCount,
		currentTokenCount,
		timestamp: new Date().toISOString(),
	});
}

/**
 * 发射 Compaction 开始事件
 */
export function emitCompactionStarted(sessionId: string): void {
	getGlobalTelemetry().emitCompactionEvent({
		type: "compaction:started",
		sessionId,
		timestamp: new Date().toISOString(),
	});
}

/**
 * 发射 Compaction 完成事件
 */
export function emitCompactionCompleted(
	sessionId: string,
	tokensFreed: number,
	messagesBefore: number,
	messagesAfter: number,
	durationMs: number,
): void {
	getGlobalTelemetry().emitCompactionEvent({
		type: "compaction:completed",
		sessionId,
		tokensFreed,
		messagesBefore,
		messagesAfter,
		durationMs,
		timestamp: new Date().toISOString(),
	});
}

/**
 * 发射 Compaction 失败事件
 */
export function emitCompactionFailed(sessionId: string, error: string, durationMs: number): void {
	getGlobalTelemetry().emitCompactionEvent({
		type: "compaction:failed",
		sessionId,
		error,
		durationMs,
		timestamp: new Date().toISOString(),
	});
}

// ============================================================================
// SubAgent 事件发射辅助函数
// ============================================================================

/**
 * 发射 SubAgent spawn 事件
 */
export function emitSubAgentSpawned(
	sessionId: string,
	subAgentId: string,
	name: string,
	isolated: boolean,
): void {
	getGlobalTelemetry().emitSubAgentEvent({
		type: "subagent:spawned",
		sessionId,
		subAgentId,
		name,
		isolated,
		timestamp: new Date().toISOString(),
	});
}

/**
 * 发射 SubAgent 完成事件
 */
export function emitSubAgentCompleted(
	sessionId: string,
	subAgentId: string,
	durationMs: number,
	resultLength?: number,
): void {
	getGlobalTelemetry().emitSubAgentEvent({
		type: "subagent:completed",
		sessionId,
		subAgentId,
		durationMs,
		resultLength,
		timestamp: new Date().toISOString(),
	});
}

/**
 * 发射 SubAgent 失败事件
 */
export function emitSubAgentFailed(
	sessionId: string,
	subAgentId: string,
	error: string,
	durationMs: number,
): void {
	getGlobalTelemetry().emitSubAgentEvent({
		type: "subagent:failed",
		sessionId,
		subAgentId,
		error,
		durationMs,
		timestamp: new Date().toISOString(),
	});
}

// ============================================================================
// MCP 连接事件发射辅助函数
// ============================================================================

/**
 * 发射 MCP 连接事件
 */
export function emitMcpConnected(
	serverName: string,
	serverType: string,
	transport: string,
	latencyMs?: number,
): void {
	getGlobalTelemetry().emitMcpConnectionEvent({
		type: "mcp:connected",
		serverName,
		serverType,
		transport,
		latencyMs,
		timestamp: new Date().toISOString(),
	});
}

/**
 * 发射 MCP 断开连接事件
 */
export function emitMcpDisconnected(serverName: string, serverType: string, reason?: string): void {
	getGlobalTelemetry().emitMcpConnectionEvent({
		type: "mcp:disconnected",
		serverName,
		serverType,
		reason,
		timestamp: new Date().toISOString(),
	});
}

/**
 * 发射 MCP 重连事件
 */
export function emitMcpReconnecting(serverName: string, attemptNumber: number, maxAttempts: number): void {
	getGlobalTelemetry().emitMcpConnectionEvent({
		type: "mcp:reconnecting",
		serverName,
		attemptNumber,
		maxAttempts,
		timestamp: new Date().toISOString(),
	});
}

/**
 * 发射 MCP 认证失败事件
 */
export function emitMcpAuthFailed(serverName: string, authType: string, error: string): void {
	getGlobalTelemetry().emitMcpConnectionEvent({
		type: "mcp:auth_failed",
		serverName,
		authType,
		error,
		timestamp: new Date().toISOString(),
	});
}

// ============================================================================
// Global Telemetry Instance
// ============================================================================

let globalTelemetry: TelemetryService | null = null;

/**
 * 获取全局 Telemetry 服务实例
 */
export function getGlobalTelemetry(): TelemetryService {
	if (!globalTelemetry) {
		globalTelemetry = new TelemetryService();
	}
	return globalTelemetry;
}

/**
 * 设置全局 Telemetry 服务实例
 */
export function setGlobalTelemetry(telemetry: TelemetryService): void {
	globalTelemetry = telemetry;
}

/**
 * 创建新的 Telemetry 服务
 */
export function createTelemetry(config?: TelemetryConfig): TelemetryService {
	return new TelemetryService(config);
}
