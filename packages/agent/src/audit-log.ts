/**
 * Audit Log - Tool Call 审计日志
 *
 * 记录所有工具调用的详细信息，包括：
 * - 权限裁决来源（auto/plan/manual/teammate）
 * - 工具执行结果
 * - 安全相关事件
 */

import { createEventBus, type EventBusController } from "./event-bus.js";
import { nowIso } from "@omi/core";

// ============================================================================
// Types
// ============================================================================

/**
 * 权限裁决来源
 */
export type PermissionSource =
	| "auto" // 自动批准
	| "plan" // Plan Mode 允许
	| "manual" // 用户手动批准
	| "teammate" // Teammate 模式
	| "allowed_prompts" // Plan Mode allowed prompts
	| "hook"; // Hook 批准

/**
 * 权限裁决结果
 */
export type PermissionDecision = "approved" | "rejected";

/**
 * 工具调用状态
 */
export type ToolCallStatus = "pending" | "approved" | "rejected" | "failed" | "skipped";

/**
 * 工具调用审计日志条目
 */
export interface ToolCallAuditEntry {
	/** 唯一标识 */
	id: string;
	/** 会话 ID */
	sessionId: string;
	/** Run ID */
	runId: string;
	/** 工具调用 ID */
	toolCallId: string;
	/** 工具名称 */
	toolName: string;
	/** 工具输入参数（脱敏后） */
	toolInput: Record<string, unknown>;
	/** 调用状态 */
	status: ToolCallStatus;
	/** 权限裁决来源 */
	permissionSource?: PermissionSource;
	/** 是否需要批准 */
	requiresApproval: boolean;
	/** 执行结果 */
	result?: ToolCallResult;
	/** 开始时间 */
	startedAt: string;
	/** 结束时间 */
	completedAt?: string;
	/** 执行时长（毫秒） */
	durationMs?: number;
	/** 错误信息 */
	error?: string;
}

/**
 * 工具调用结果
 */
export interface ToolCallResult {
	/** 是否成功 */
	success: boolean;
	/** 输出内容长度 */
	outputLength?: number;
	/** 错误代码 */
	errorCode?: string;
}

/**
 * 权限审计日志条目
 */
export interface PermissionAuditEntry {
	/** 唯一标识 */
	id: string;
	/** 会话 ID */
	sessionId: string;
	/** Run ID */
	runId: string;
	/** 工具调用 ID */
	toolCallId: string;
	/** 工具名称 */
	toolName: string;
	/** 裁决来源 */
	source: PermissionSource;
	/** 裁决结果 */
	decision: PermissionDecision;
	/** 是否批准 */
	approved: boolean;
	/** 用户确认（如果是手动裁决） */
	userConfirmed?: boolean;
	/** 理由（如果是 allowed_prompts） */
	promptMatch?: string;
	/** 时间戳 */
	timestamp: string;
}

/**
 * 安全事件类型
 */
export type SecurityEventType =
	| "tool:blocked_in_plan_mode"
	| "worktree:delete_blocked"
	| "permission:escalation_attempt"
	| "dangerous_command_blocked"
	| "path_traversal_attempt"
	| "sensitive_data_access";

/**
 * 安全审计日志条目
 */
export interface SecurityAuditEntry {
	/** 唯一标识 */
	id: string;
	/** 会话 ID */
	sessionId: string;
	/** 事件类型 */
	eventType: SecurityEventType;
	/** 工具名称 */
	toolName?: string;
	/** 事件详情 */
	details: Record<string, unknown>;
	/** 是否阻止操作 */
	blocked: boolean;
	/** 时间戳 */
	timestamp: string;
}

/**
 * 审计日志事件类型
 */
export type AuditEvent =
	| { type: "tool_call"; entry: ToolCallAuditEntry }
	| { type: "permission"; entry: PermissionAuditEntry }
	| { type: "security"; entry: SecurityAuditEntry };

// ============================================================================
// Audit Log Service
// ============================================================================

/**
 * 审计日志配置
 */
export interface AuditLogConfig {
	/** 是否启用审计日志 */
	enabled?: boolean;
	/** 最大条目数量 */
	maxEntries?: number;
	/** 是否记录工具输入 */
	recordInputs?: boolean;
	/** 脱敏字段列表 */
	sensitiveFields?: string[];
}

/**
 * 审计日志服务
 */
export class AuditLogService {
	private readonly eventBus: EventBusController;
	private readonly config: Required<AuditLogConfig>;
	private readonly toolCallEntries: ToolCallAuditEntry[] = [];
	private readonly permissionEntries: PermissionAuditEntry[] = [];
	private readonly securityEntries: SecurityAuditEntry[] = [];
	private idCounter = 0;

	constructor(config: AuditLogConfig = {}) {
		this.eventBus = createEventBus();
		this.config = {
			enabled: config.enabled ?? true,
			maxEntries: config.maxEntries ?? 10000,
			recordInputs: config.recordInputs ?? true,
			sensitiveFields: config.sensitiveFields ?? ["password", "token", "secret", "api_key", "credential"],
		};
	}

	/**
	 * 记录工具调用开始
	 */
	recordToolCallStart(
		sessionId: string,
		runId: string,
		toolCallId: string,
		toolName: string,
		toolInput: Record<string, unknown>,
		requiresApproval: boolean,
	): string {
		if (!this.config.enabled) return "";

		const id = this.generateId();
		const entry: ToolCallAuditEntry = {
			id,
			sessionId,
			runId,
			toolCallId,
			toolName,
			toolInput: this.config.recordInputs ? this.sanitizeInput(toolInput) : {},
			status: "pending",
			requiresApproval,
			startedAt: nowIso(),
		};

		this.addEntry(this.toolCallEntries, entry);
		this.emitEvent({ type: "tool_call", entry });
		return id;
	}

	/**
	 * 记录工具调用完成
	 */
	recordToolCallComplete(
		id: string,
		status: ToolCallStatus,
		result?: ToolCallResult,
		error?: string,
	): void {
		if (!this.config.enabled) return;

		const entry = this.toolCallEntries.find((e) => e.id === id);
		if (!entry) return;

		entry.status = status;
		entry.result = result;
		entry.error = error;
		entry.completedAt = nowIso();
		entry.durationMs = new Date(entry.completedAt).getTime() - new Date(entry.startedAt).getTime();

		this.emitEvent({ type: "tool_call", entry });
	}

	/**
	 * 记录权限裁决
	 */
	recordPermission(
		sessionId: string,
		runId: string,
		toolCallId: string,
		toolName: string,
		source: PermissionSource,
		decision: PermissionDecision,
		options?: {
			userConfirmed?: boolean;
			promptMatch?: string;
		},
	): string {
		if (!this.config.enabled) return "";

		const id = this.generateId();
		const entry: PermissionAuditEntry = {
			id,
			sessionId,
			runId,
			toolCallId,
			toolName,
			source,
			decision,
			approved: decision === "approved",
			userConfirmed: options?.userConfirmed,
			promptMatch: options?.promptMatch,
			timestamp: nowIso(),
		};

		this.addEntry(this.permissionEntries, entry);
		this.emitEvent({ type: "permission", entry });
		return id;
	}

	/**
	 * 记录安全事件
	 */
	recordSecurityEvent(
		sessionId: string,
		eventType: SecurityEventType,
		details: Record<string, unknown>,
		blocked: boolean,
		options?: { toolName?: string },
	): string {
		const id = this.generateId();
		const entry: SecurityAuditEntry = {
			id,
			sessionId,
			eventType,
			toolName: options?.toolName,
			details,
			blocked,
			timestamp: nowIso(),
		};

		this.addEntry(this.securityEntries, entry);
		this.emitEvent({ type: "security", entry });
		return id;
	}

	/**
	 * 获取工具调用审计日志
	 */
	getToolCallEntries(sessionId?: string): ToolCallAuditEntry[] {
		if (sessionId) {
			return this.toolCallEntries.filter((e) => e.sessionId === sessionId);
		}
		return [...this.toolCallEntries];
	}

	/**
	 * 获取权限审计日志
	 */
	getPermissionEntries(sessionId?: string): PermissionAuditEntry[] {
		if (sessionId) {
			return this.permissionEntries.filter((e) => e.sessionId === sessionId);
		}
		return [...this.permissionEntries];
	}

	/**
	 * 获取安全审计日志
	 */
	getSecurityEntries(sessionId?: string): SecurityAuditEntry[] {
		if (sessionId) {
			return this.securityEntries.filter((e) => e.sessionId === sessionId);
		}
		return [...this.securityEntries];
	}

	/**
	 * 获取统计信息
	 */
	getStats(): AuditStats {
		const toolCallsByStatus = this.groupByStatus(this.toolCallEntries);
		const permissionsBySource = this.groupBySource(this.permissionEntries);

		return {
			totalToolCalls: this.toolCallEntries.length,
			toolCallsByStatus,
			totalPermissions: this.permissionEntries.length,
			permissionsBySource,
			permissionsApproved: this.permissionEntries.filter((e) => e.approved).length,
			permissionsRejected: this.permissionEntries.filter((e) => !e.approved).length,
			totalSecurityEvents: this.securityEntries.length,
			securityEventsBlocked: this.securityEntries.filter((e) => e.blocked).length,
		};
	}

	/**
	 * 订阅审计事件
	 */
	on(handler: (event: AuditEvent) => void): () => void {
		return this.eventBus.on("audit", handler as (data: unknown) => void);
	}

	/**
	 * 清空所有日志
	 */
	clear(): void {
		this.toolCallEntries.length = 0;
		this.permissionEntries.length = 0;
		this.securityEntries.length = 0;
	}

	private emitEvent(event: AuditEvent): void {
		this.eventBus.emit("audit", event);
	}

	private generateId(): string {
		return `audit_${Date.now()}_${++this.idCounter}`;
	}

	private sanitizeInput(input: Record<string, unknown>): Record<string, unknown> {
		const sanitized: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(input)) {
			if (this.isSensitiveField(key)) {
				sanitized[key] = "[REDACTED]";
			} else if (typeof value === "object" && value !== null) {
				sanitized[key] = this.sanitizeInput(value as Record<string, unknown>);
			} else {
				sanitized[key] = value;
			}
		}
		return sanitized;
	}

	private isSensitiveField(key: string): boolean {
		const lowerKey = key.toLowerCase();
		return this.config.sensitiveFields.some((field) => lowerKey.includes(field.toLowerCase()));
	}

	private addEntry<T>(array: T[], entry: T): void {
		array.push(entry);
		// 保持数组大小限制
		if (array.length > this.config.maxEntries) {
			array.shift();
		}
	}

	private groupByStatus(entries: ToolCallAuditEntry[]): Record<ToolCallStatus, number> {
		const counts: Record<ToolCallStatus, number> = {
			pending: 0,
			approved: 0,
			rejected: 0,
			failed: 0,
			skipped: 0,
		};
		for (const entry of entries) {
			counts[entry.status]++;
		}
		return counts;
	}

	private groupBySource(entries: PermissionAuditEntry[]): Record<PermissionSource, number> {
		const counts: Record<PermissionSource, number> = {
			auto: 0,
			plan: 0,
			manual: 0,
			teammate: 0,
			allowed_prompts: 0,
			hook: 0,
		};
		for (const entry of entries) {
			counts[entry.source]++;
		}
		return counts;
	}
}

/**
 * 审计统计信息
 */
export interface AuditStats {
	totalToolCalls: number;
	toolCallsByStatus: Record<ToolCallStatus, number>;
	totalPermissions: number;
	permissionsBySource: Record<PermissionSource, number>;
	permissionsApproved: number;
	permissionsRejected: number;
	totalSecurityEvents: number;
	securityEventsBlocked: number;
}

// ============================================================================
// Global Audit Log Instance
// ============================================================================

let globalAuditLog: AuditLogService | null = null;

/**
 * 获取全局审计日志服务实例
 */
export function getGlobalAuditLog(): AuditLogService {
	if (!globalAuditLog) {
		globalAuditLog = new AuditLogService();
	}
	return globalAuditLog;
}

/**
 * 设置全局审计日志服务实例
 */
export function setGlobalAuditLog(auditLog: AuditLogService): void {
	globalAuditLog = auditLog;
}

/**
 * 创建新的审计日志服务
 */
export function createAuditLog(config?: AuditLogConfig): AuditLogService {
	return new AuditLogService(config);
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * 记录工具调用开始
 */
export function recordToolStart(
	sessionId: string,
	runId: string,
	toolCallId: string,
	toolName: string,
	toolInput: Record<string, unknown>,
	requiresApproval: boolean,
): string {
	return getGlobalAuditLog().recordToolCallStart(sessionId, runId, toolCallId, toolName, toolInput, requiresApproval);
}

/**
 * 记录工具调用完成
 */
export function recordToolComplete(
	id: string,
	status: ToolCallStatus,
	result?: ToolCallResult,
	error?: string,
): void {
	getGlobalAuditLog().recordToolCallComplete(id, status, result, error);
}

/**
 * 记录权限裁决
 */
export function recordPermissionDecision(
	sessionId: string,
	runId: string,
	toolCallId: string,
	toolName: string,
	source: PermissionSource,
	decision: PermissionDecision,
	options?: { userConfirmed?: boolean; promptMatch?: string },
): string {
	return getGlobalAuditLog().recordPermission(sessionId, runId, toolCallId, toolName, source, decision, options);
}

/**
 * 记录安全事件
 */
export function recordSecurityEvent(
	sessionId: string,
	eventType: SecurityEventType,
	details: Record<string, unknown>,
	blocked: boolean,
	options?: { toolName?: string },
): string {
	return getGlobalAuditLog().recordSecurityEvent(sessionId, eventType, details, blocked, options);
}
