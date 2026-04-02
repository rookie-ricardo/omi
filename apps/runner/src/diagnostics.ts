/**
 * Diagnostics - 观测性与运维面板
 *
 * 提供诊断信息和运维指标：
 * - Run 状态和性能指标
 * - 连接状态（MCP、Provider）
 * - 资源使用情况
 * - 健康检查接口
 */

import { createEventBus, type EventBusController } from "@omi/agent/event-bus";
import { getGlobalTelemetry, type TelemetryService } from "@omi/agent/telemetry";
import { getGlobalAuditLog, type AuditLogService } from "@omi/agent/audit-log";

// ============================================================================
// Types
// ============================================================================

/**
 * Run 诊断信息
 */
export interface RunDiagnostics {
	runId: string;
	sessionId: string;
	status: RunStatus;
	startTime: string;
	durationMs: number;
	model?: string;
	provider?: string;
	tokenUsage?: TokenUsageInfo;
	lastActivity: string;
}

/**
 * Run 状态
 */
export type RunStatus = "pending" | "running" | "blocked" | "completed" | "failed" | "cancelled";

/**
 * Token 使用信息
 */
export interface TokenUsageInfo {
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	cacheHits?: number;
	cacheMisses?: number;
}

/**
 * MCP 服务器诊断信息
 */
export interface McpServerDiagnostics {
	serverName: string;
	serverType: string;
	status: McpServerStatus;
	connectedAt?: string;
	lastActivity?: string;
	reconnectCount: number;
	errorCount: number;
	lastError?: string;
	latencyMs?: number;
}

/**
 * MCP 服务器状态
 */
export type McpServerStatus = "connecting" | "connected" | "disconnected" | "error" | "reconnecting";

/**
 * Provider 诊断信息
 */
export interface ProviderDiagnostics {
	providerId: string;
	status: ProviderStatus;
	model?: string;
	latencyMs?: number;
	errorCount: number;
	lastError?: string;
	requestCount: number;
}

/**
 * Provider 状态
 */
export type ProviderStatus = "healthy" | "degraded" | "error" | "rate_limited";

/**
 * 系统诊断信息
 */
export interface SystemDiagnostics {
	uptime: number;
	memoryUsage: NodeJS.MemoryUsage;
	cpuUsage: NodeJS.CpuUsage;
	activeSessions: number;
	activeRuns: number;
	pendingToolCalls: number;
}

/**
 * 健康检查结果
 */
export interface HealthCheckResult {
	status: "healthy" | "degraded" | "unhealthy";
	checks: HealthCheck[];
	timestamp: string;
}

/**
 * 单个健康检查项
 */
export interface HealthCheck {
	name: string;
	status: "pass" | "fail" | "warn";
	message?: string;
	details?: Record<string, unknown>;
}

// ============================================================================
// Diagnostics Service
// ============================================================================

/**
 * 诊断服务配置
 */
export interface DiagnosticsConfig {
	/** Telemetry 服务实例 */
	telemetry?: TelemetryService;
	/** 审计日志服务实例 */
	auditLog?: AuditLogService;
	/** 健康检查间隔（毫秒） */
	healthCheckIntervalMs?: number;
}

/**
 * 诊断服务
 */
export class DiagnosticsService {
	private readonly eventBus: EventBusController;
	private readonly telemetry: TelemetryService;
	private readonly auditLog: AuditLogService;
	private readonly runs = new Map<string, RunDiagnostics>();
	private readonly mcpServers = new Map<string, McpServerDiagnostics>();
	private readonly providers = new Map<string, ProviderDiagnostics>();
	private readonly startTime: Date;

	constructor(config: DiagnosticsConfig = {}) {
		this.eventBus = createEventBus();
		this.telemetry = config.telemetry ?? getGlobalTelemetry();
		this.auditLog = config.auditLog ?? getGlobalAuditLog();
		this.startTime = new Date();

		// 订阅事件
		this.subscribeToEvents();
	}

	/**
	 * 注册 Run
	 */
	registerRun(run: Omit<RunDiagnostics, "lastActivity">): void {
		this.runs.set(run.runId, {
			...run,
			lastActivity: run.startTime,
		});
		this.emitEvent("run:registered", { runId: run.runId });
	}

	/**
	 * 更新 Run 状态
	 */
	updateRunStatus(runId: string, status: RunStatus): void {
		const run = this.runs.get(runId);
		if (run) {
			run.status = status;
			run.lastActivity = new Date().toISOString();
			this.emitEvent("run:status_changed", { runId, status });
		}
	}

	/**
	 * 更新 Token 使用量
	 */
	updateTokenUsage(runId: string, usage: TokenUsageInfo): void {
		const run = this.runs.get(runId);
		if (run) {
			run.tokenUsage = usage;
			run.lastActivity = new Date().toISOString();
		}
	}

	/**
	 * 注册 MCP 服务器
	 */
	registerMcpServer(server: Omit<McpServerDiagnostics, "reconnectCount" | "errorCount">): void {
		this.mcpServers.set(server.serverName, {
			...server,
			reconnectCount: 0,
			errorCount: 0,
		});
		this.emitEvent("mcp:server_registered", { serverName: server.serverName });
	}

	/**
	 * 更新 MCP 服务器状态
	 */
	updateMcpServerStatus(serverName: string, status: McpServerStatus, error?: string): void {
		const server = this.mcpServers.get(serverName);
		if (server) {
			server.status = status;
			server.lastActivity = new Date().toISOString();
			if (error) {
				server.lastError = error;
				server.errorCount++;
			}
			if (status === "connected") {
				server.connectedAt = new Date().toISOString();
			}
			if (status === "reconnecting") {
				server.reconnectCount++;
			}
			this.emitEvent("mcp:server_status_changed", { serverName, status });
		}
	}

	/**
	 * 注册 Provider
	 */
	registerProvider(provider: Omit<ProviderDiagnostics, "errorCount" | "requestCount">): void {
		this.providers.set(provider.providerId, {
			...provider,
			errorCount: 0,
			requestCount: 0,
		});
		this.emitEvent("provider:registered", { providerId: provider.providerId });
	}

	/**
	 * 更新 Provider 状态
	 */
	updateProviderStatus(providerId: string, status: ProviderStatus, error?: string): void {
		const provider = this.providers.get(providerId);
		if (provider) {
			provider.status = status;
			if (error) {
				provider.lastError = error;
				provider.errorCount++;
			}
			this.emitEvent("provider:status_changed", { providerId, status });
		}
	}

	/**
	 * 记录 Provider 请求
	 */
	recordProviderRequest(providerId: string, latencyMs: number): void {
		const provider = this.providers.get(providerId);
		if (provider) {
			provider.requestCount++;
			provider.latencyMs = latencyMs;
		}
	}

	/**
	 * 获取 Run 诊断信息
	 */
	getRun(runId: string): RunDiagnostics | undefined {
		return this.runs.get(runId);
	}

	/**
	 * 获取所有 Runs
	 */
	getAllRuns(): RunDiagnostics[] {
		return [...this.runs.values()];
	}

	/**
	 * 获取活跃 Runs
	 */
	getActiveRuns(): RunDiagnostics[] {
		return this.runs.values().filter((run) => run.status === "running" || run.status === "blocked");
	}

	/**
	 * 获取 MCP 服务器诊断信息
	 */
	getMcpServer(serverName: string): McpServerDiagnostics | undefined {
		return this.mcpServers.get(serverName);
	}

	/**
	 * 获取所有 MCP 服务器
	 */
	getAllMcpServers(): McpServerDiagnostics[] {
		return [...this.mcpServers.values()];
	}

	/**
	 * 获取 Provider 诊断信息
	 */
	getProvider(providerId: string): ProviderDiagnostics | undefined {
		return this.providers.get(providerId);
	}

	/**
	 * 获取所有 Providers
	 */
	getAllProviders(): ProviderDiagnostics[] {
		return [...this.providers.values()];
	}

	/**
	 * 获取系统诊断信息
	 */
	getSystemDiagnostics(): SystemDiagnostics {
		const memUsage = process.memoryUsage();
		const cpuUsage = process.cpuUsage();

		return {
			uptime: Date.now() - this.startTime.getTime(),
			memoryUsage: memUsage,
			cpuUsage: cpuUsage,
			activeSessions: this.runs.size,
			activeRuns: this.getActiveRuns().length,
			pendingToolCalls: this.auditLog.getToolCallEntries().filter((e) => e.status === "pending").length,
		};
	}

	/**
	 * 执行健康检查
	 */
	performHealthCheck(): HealthCheckResult {
		const checks: HealthCheck[] = [];

		// 检查 Runs
		const failedRuns = this.runs.values().filter((run) => run.status === "failed");
		checks.push({
			name: "runs",
			status: failedRuns.length > 0 ? "warn" : "pass",
			message: `${this.runs.size} runs registered, ${failedRuns.length} failed`,
			details: {
				total: this.runs.size,
				failed: failedRuns.length,
			},
		});

		// 检查 MCP 服务器
		const disconnectedMcpServers = this.mcpServers.values().filter((server) => server.status !== "connected");
		checks.push({
			name: "mcp_servers",
			status: disconnectedMcpServers.length > 0 ? "warn" : "pass",
			message: `${this.mcpServers.size} servers registered, ${disconnectedMcpServers.length} disconnected`,
			details: {
				total: this.mcpServers.size,
				disconnected: disconnectedMcpServers.length,
			},
		});

		// 检查 Providers
		const errorProviders = this.providers.values().filter((provider) => provider.status === "error");
		checks.push({
			name: "providers",
			status: errorProviders.length > 0 ? "fail" : "pass",
			message: `${this.providers.size} providers, ${errorProviders.length} errors`,
			details: {
				total: this.providers.size,
				errors: errorProviders.length,
			},
		});

		// 检查内存使用
		const memUsage = process.memoryUsage();
		const heapUsedPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
		checks.push({
			name: "memory",
			status: heapUsedPercent > 90 ? "fail" : heapUsedPercent > 70 ? "warn" : "pass",
			message: `Heap usage: ${heapUsedPercent.toFixed(1)}%`,
			details: {
				heapUsed: memUsage.heapUsed,
				heapTotal: memUsage.heapTotal,
				heapUsedPercent,
			},
		});

		// 确定整体状态
		const hasFails = checks.some((c) => c.status === "fail");
		const hasWarns = checks.some((c) => c.status === "warn");

		return {
			status: hasFails ? "unhealthy" : hasWarns ? "degraded" : "healthy",
			checks,
			timestamp: new Date().toISOString(),
		};
	}

	/**
	 * 获取诊断快照
	 */
	getSnapshot(): DiagnosticsSnapshot {
		return {
			system: this.getSystemDiagnostics(),
			runs: this.getAllRuns(),
			mcpServers: this.getAllMcpServers(),
			providers: this.getAllProviders(),
			telemetry: this.telemetry.getAllCounters(),
			auditStats: this.auditLog.getStats(),
			timestamp: new Date().toISOString(),
		};
	}

	/**
	 * 订阅诊断事件
	 */
	on(channel: string, handler: (data: unknown) => void): () => void {
		return this.eventBus.on(channel, handler);
	}

	private emitEvent(channel: string, data: unknown): void {
		this.eventBus.emit(channel, data);
	}

	private subscribeToEvents(): void {
		// 订阅 Telemetry 事件
		this.telemetry.on("run", (event: unknown) => {
			const runEvent = event as { runId: string; sessionId: string };
			this.emitEvent("telemetry:run", runEvent);
		});

		this.telemetry.on("compaction", (event: unknown) => {
			this.emitEvent("telemetry:compaction", event);
		});

		this.telemetry.on("mcp", (event: unknown) => {
			const mcpEvent = event as { serverName: string; type: string };
			if (mcpEvent.type === "mcp:connected" || mcpEvent.type === "mcp:disconnected") {
				this.updateMcpServerStatus(
					mcpEvent.serverName,
					mcpEvent.type === "mcp:connected" ? "connected" : "disconnected",
				);
			}
		});
	}
}

/**
 * 诊断快照
 */
export interface DiagnosticsSnapshot {
	system: SystemDiagnostics;
	runs: RunDiagnostics[];
	mcpServers: McpServerDiagnostics[];
	providers: ProviderDiagnostics[];
	telemetry: Record<string, number>;
	auditStats: {
		totalToolCalls: number;
		permissionsApproved: number;
		permissionsRejected: number;
		securityEventsBlocked: number;
	};
	timestamp: string;
}

// ============================================================================
// Global Diagnostics Instance
// ============================================================================

let globalDiagnostics: DiagnosticsService | null = null;

/**
 * 获取全局诊断服务实例
 */
export function getGlobalDiagnostics(): DiagnosticsService {
	if (!globalDiagnostics) {
		globalDiagnostics = new DiagnosticsService();
	}
	return globalDiagnostics;
}

/**
 * 设置全局诊断服务实例
 */
export function setGlobalDiagnostics(diagnostics: DiagnosticsService): void {
	globalDiagnostics = diagnostics;
}

/**
 * 创建新的诊断服务
 */
export function createDiagnostics(config?: DiagnosticsConfig): DiagnosticsService {
	return new DiagnosticsService(config);
}

// ============================================================================
// Express Middleware for Diagnostics Endpoints
// ============================================================================

/**
 * 创建诊断路由处理器
 * 用于在 Express/Fastify 等框架中暴露诊断端点
 */
export function createDiagnosticsMiddleware(diagnostics: DiagnosticsService) {
	return {
		/**
		 * GET /health - 健康检查
		 */
		healthCheck: async (): Promise<HealthCheckResult> => {
			return diagnostics.performHealthCheck();
		},

		/**
		 * GET /diagnostics - 完整诊断快照
		 */
		snapshot: async (): Promise<DiagnosticsSnapshot> => {
			return diagnostics.getSnapshot();
		},

		/**
		 * GET /diagnostics/runs - Runs 状态
		 */
		getRuns: async (): Promise<RunDiagnostics[]> => {
			return diagnostics.getAllRuns();
		},

		/**
		 * GET /diagnostics/mcp - MCP 服务器状态
		 */
		getMcpServers: async (): Promise<McpServerDiagnostics[]> => {
			return diagnostics.getAllMcpServers();
		},

		/**
		 * GET /diagnostics/providers - Provider 状态
		 */
		getProviders: async (): Promise<ProviderDiagnostics[]> => {
			return diagnostics.getAllProviders();
		},
	};
}
