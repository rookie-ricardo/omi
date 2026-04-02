/**
 * Audit Log Module
 *
 * Provides audit trail for security-critical operations:
 * - Tool call approvals/rejections with decision source
 * - Permission rule changes
 * - Mode transitions
 * - Session/branch operations
 */

import { createId, nowIso } from "@omi/core";

// ============================================================================
// Audit Event Types
// ============================================================================

export type AuditEventType =
  | "tool.approved"
  | "tool.rejected"
  | "tool.denied"
  | "tool.executed"
  | "tool.failed"
  | "rule.added"
  | "rule.updated"
  | "rule.deleted"
  | "mode.entered"
  | "mode.exited"
  | "session.created"
  | "session.branch.created"
  | "session.branch.switched"
  | "subagent.spawned"
  | "subagent.aborted"
  | "worktree.created"
  | "worktree.cleaned"
  | "permission.check";

// ============================================================================
// Audit Event Payloads
// ============================================================================

export interface ToolApprovalAuditPayload {
  toolCallId: string;
  runId: string;
  sessionId: string;
  toolName: string;
  input: Record<string, unknown>;
  decision: "approved" | "rejected" | "denied";
  reason?: string;
  ruleId?: string;
  ruleName?: string;
  decisionSource: "user" | "rule" | "policy" | "system";
  latencyMs?: number;
}

export interface ToolExecutedAuditPayload {
  toolCallId: string;
  runId: string;
  sessionId: string;
  toolName: string;
  durationMs: number;
  success: boolean;
  outputSize?: number;
  error?: string;
}

export interface RuleChangeAuditPayload {
  ruleId: string;
  ruleName: string;
  action: "added" | "updated" | "deleted";
  sessionId?: string;
  changes?: Record<string, { from: unknown; to: unknown }>;
  actor: "user" | "system" | "extension";
}

export interface ModeTransitionAuditPayload {
  sessionId: string;
  fromMode: string;
  toMode: string;
  reason?: string;
  stepsApproved?: number;
  stepsRejected?: number;
}

export interface SessionAuditPayload {
  sessionId: string;
  action: "created" | "branch_created" | "branch_switched";
  parentSessionId?: string;
  branchName?: string;
  branchId?: string;
}

export interface SubagentAuditPayload {
  taskId: string;
  ownerId: string;
  action: "spawned" | "aborted";
  writeScope: "shared" | "isolated" | "worktree";
  prompt?: string;
  reason?: string;
}

export interface WorktreeAuditPayload {
  worktreeId: string;
  action: "created" | "cleaned";
  path: string;
  branch: string;
  changesDetected?: number;
  force?: boolean;
}

export interface PermissionCheckAuditPayload {
  sessionId: string;
  toolName: string;
  decision: "allow" | "deny" | "require_approval";
  reason?: string;
  ruleId?: string;
  matchedRules: Array<{
    ruleId: string;
    ruleName: string;
    priority: number;
  }>;
}

// ============================================================================
// Audit Entry
// ============================================================================

export interface AuditEntry {
  id: string;
  type: AuditEventType;
  timestamp: string;
  payload: unknown;
  runId?: string;
  sessionId?: string;
  userId?: string;
  severity: "info" | "warning" | "critical";
  tags: string[];
}

export interface ToolAuditEntry extends AuditEntry {
  type: "tool.approved" | "tool.rejected" | "tool.denied" | "tool.executed" | "tool.failed";
  payload: ToolApprovalAuditPayload | ToolExecutedAuditPayload;
}

export interface RuleAuditEntry extends AuditEntry {
  type: "rule.added" | "rule.updated" | "rule.deleted";
  payload: RuleChangeAuditPayload;
}

// ============================================================================
// Audit Log
// ============================================================================

export interface AuditLogConfig {
  /** Maximum entries to keep in memory */
  maxEntries?: number;
  /** Minimum severity to record */
  minSeverity?: "info" | "warning" | "critical";
  /** Whether to enable real-time streaming */
  streamEnabled?: boolean;
  /** Custom sink for audit entries */
  sink?: AuditSink;
}

export interface AuditSink {
  write(entry: AuditEntry): void | Promise<void>;
  query(filter: AuditFilter): Promise<AuditEntry[]>;
  flush(): void | Promise<void>;
}

export interface AuditFilter {
  types?: AuditEventType[];
  sessionId?: string;
  runId?: string;
  userId?: string;
  severity?: "info" | "warning" | "critical";
  startTime?: string;
  endTime?: string;
  limit?: number;
}

// ============================================================================
// Audit Logger
// ============================================================================

export class AuditLog {
  private entries: AuditEntry[] = [];
  private sink?: AuditSink;
  private readonly maxEntries: number;
  private readonly minSeverity: "info" | "warning" | "critical";
  private readonly streamEnabled: boolean;

  constructor(config: AuditLogConfig = {}) {
    this.maxEntries = config.maxEntries ?? 50000;
    this.minSeverity = config.minSeverity ?? "info";
    this.streamEnabled = config.streamEnabled ?? true;
    this.sink = config.sink;
  }

  // ==========================================================================
  // Event Recording
  // ==========================================================================

  /**
   * Log a tool approval/rejection.
   */
  logToolDecision(payload: ToolApprovalAuditPayload): void {
    const entry: ToolAuditEntry = {
      id: createId("audit"),
      type: payload.decision === "approved" ? "tool.approved" :
        payload.decision === "rejected" ? "tool.rejected" : "tool.denied",
      timestamp: nowIso(),
      payload,
      runId: payload.runId,
      sessionId: payload.sessionId,
      severity: payload.decision === "denied" ? "critical" : "info",
      tags: [payload.toolName, payload.decisionSource],
    };

    this.addEntry(entry);
  }

  /**
   * Log a tool execution.
   */
  logToolExecuted(payload: ToolExecutedAuditPayload): void {
    const entry: ToolAuditEntry = {
      id: createId("audit"),
      type: payload.success ? "tool.executed" : "tool.failed",
      timestamp: nowIso(),
      payload,
      runId: payload.runId,
      sessionId: payload.sessionId,
      severity: payload.success ? "info" : "warning",
      tags: [payload.toolName],
    };

    this.addEntry(entry);
  }

  /**
   * Log a permission check.
   */
  logPermissionCheck(payload: PermissionCheckAuditPayload): void {
    if (payload.decision === "allow") {
      // Only log non-allow decisions by default for performance
      return;
    }

    const entry: AuditEntry = {
      id: createId("audit"),
      type: "permission.check",
      timestamp: nowIso(),
      payload,
      sessionId: payload.sessionId,
      severity: payload.decision === "deny" ? "critical" : "warning",
      tags: [payload.toolName, payload.decision],
    };

    this.addEntry(entry);
  }

  /**
   * Log a rule change.
   */
  logRuleChange(payload: RuleChangeAuditPayload): void {
    const entry: RuleAuditEntry = {
      id: createId("audit"),
      type: `rule.${payload.action}` as AuditEventType,
      timestamp: nowIso(),
      payload,
      sessionId: payload.sessionId,
      severity: "warning",
      tags: [payload.ruleName, payload.actor],
    };

    this.addEntry(entry);
  }

  /**
   * Log a mode transition.
   */
  logModeTransition(payload: ModeTransitionAuditPayload): void {
    const entry: AuditEntry = {
      id: createId("audit"),
      type: payload.toMode === "none" ? "mode.exited" : "mode.entered",
      timestamp: nowIso(),
      payload,
      sessionId: payload.sessionId,
      severity: "info",
      tags: [payload.fromMode, payload.toMode],
    };

    this.addEntry(entry);
  }

  /**
   * Log a session operation.
   */
  logSession(payload: SessionAuditPayload): void {
    const entry: AuditEntry = {
      id: createId("audit"),
      type: `session.${payload.action}` as AuditEventType,
      timestamp: nowIso(),
      payload,
      sessionId: payload.sessionId,
      severity: "info",
      tags: [],
    };

    this.addEntry(entry);
  }

  /**
   * Log a subagent operation.
   */
  logSubagent(payload: SubagentAuditPayload): void {
    const entry: AuditEntry = {
      id: createId("audit"),
      type: `subagent.${payload.action}` as AuditEventType,
      timestamp: nowIso(),
      payload,
      runId: payload.taskId,
      sessionId: payload.ownerId,
      severity: "info",
      tags: [payload.writeScope],
    };

    this.addEntry(entry);
  }

  /**
   * Log a worktree operation.
   */
  logWorktree(payload: WorktreeAuditPayload): void {
    const entry: AuditEntry = {
      id: createId("audit"),
      type: `worktree.${payload.action}` as AuditEventType,
      timestamp: nowIso(),
      payload,
      severity: payload.action === "cleaned" && payload.force ? "warning" : "info",
      tags: [],
    };

    this.addEntry(entry);
  }

  // ==========================================================================
  // Entry Management
  // ==========================================================================

  private addEntry(entry: AuditEntry): void {
    // Check severity threshold
    if (!this.passesSeverityFilter(entry.severity)) {
      return;
    }

    this.entries.push(entry);

    // Trim old entries
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }

    // Write to sink
    if (this.streamEnabled) {
      this.sink?.write(entry);
    }
  }

  private passesSeverityFilter(severity: "info" | "warning" | "critical"): boolean {
    const levels = { info: 0, warning: 1, critical: 2 };
    return levels[severity] >= levels[this.minSeverity];
  }

  // ==========================================================================
  // Queries
  // ==========================================================================

  /**
   * Query audit entries.
   */
  async query(filter: AuditFilter = {}): Promise<AuditEntry[]> {
    // If we have a sink, query it
    if (this.sink) {
      return this.sink.query(filter);
    }

    // Otherwise, query in-memory entries
    let results = this.entries;

    if (filter.types && filter.types.length > 0) {
      results = results.filter((e) => filter.types!.includes(e.type));
    }

    if (filter.sessionId) {
      results = results.filter((e) => e.sessionId === filter.sessionId);
    }

    if (filter.runId) {
      results = results.filter((e) => e.runId === filter.runId);
    }

    if (filter.severity) {
      results = results.filter((e) => e.severity === filter.severity);
    }

    if (filter.startTime) {
      results = results.filter((e) => e.timestamp >= filter.startTime!);
    }

    if (filter.endTime) {
      results = results.filter((e) => e.timestamp <= filter.endTime!);
    }

    if (filter.limit) {
      results = results.slice(-filter.limit);
    }

    return results;
  }

  /**
   * Get tool decisions for a run.
   */
  async getToolDecisions(runId: string): Promise<ToolAuditEntry[]> {
    const entries = await this.query({ runId });
    return entries.filter((e): e is ToolAuditEntry =>
      e.type === "tool.approved" || e.type === "tool.rejected" || e.type === "tool.denied"
    );
  }

  /**
   * Get audit trail for error analysis.
   */
  async getErrorTrail(runId: string): Promise<AuditEntry[]> {
    return this.query({
      runId,
      severity: "warning",
      limit: 100,
    });
  }

  /**
   * Get rule changes for a session.
   */
  async getRuleChanges(sessionId: string): Promise<RuleAuditEntry[]> {
    const entries = await this.query({
      sessionId,
      types: ["rule.added", "rule.updated", "rule.deleted"],
    });
    return entries.filter((e): e is RuleAuditEntry =>
      e.type === "rule.added" || e.type === "rule.updated" || e.type === "rule.deleted"
    );
  }

  // ==========================================================================
  // Maintenance
  // ==========================================================================

  /**
   * Flush pending entries to sink.
   */
  async flush(): Promise<void> {
    await this.sink?.flush();
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.entries = [];
  }

  /**
   * Get entry count.
   */
  getCount(): number {
    return this.entries.length;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a tool audit entry from a tool call result.
 */
export function createToolAuditEntry(
  toolCallId: string,
  runId: string,
  sessionId: string,
  toolName: string,
  decision: "approved" | "rejected" | "denied",
  options?: {
    input?: Record<string, unknown>;
    reason?: string;
    ruleId?: string;
    ruleName?: string;
    decisionSource?: "user" | "rule" | "policy" | "system";
    latencyMs?: number;
  }
): ToolApprovalAuditPayload {
  return {
    toolCallId,
    runId,
    sessionId,
    toolName,
    input: options?.input ?? {},
    decision,
    reason: options?.reason,
    ruleId: options?.ruleId,
    ruleName: options?.ruleName,
    decisionSource: options?.decisionSource ?? "system",
    latencyMs: options?.latencyMs,
  };
}

// ============================================================================
// Singleton Instance
// ============================================================================

let globalAuditLog: AuditLog | undefined;

export function getAuditLog(): AuditLog {
  if (!globalAuditLog) {
    globalAuditLog = new AuditLog();
  }
  return globalAuditLog;
}

export function setAuditLog(log: AuditLog): void {
  globalAuditLog = log;
}
