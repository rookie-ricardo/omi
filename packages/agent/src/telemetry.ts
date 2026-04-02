/**
 * Telemetry Module
 *
 * Provides observability for the agent system:
 * - Run lifecycle events
 * - Tool call metrics
 * - Compaction metrics
 * - Subagent metrics
 * - MCP connection metrics
 */

import { createId, nowIso } from "@omi/core";

// ============================================================================
// Event Types
// ============================================================================

export type TelemetryEventType =
  | "run.started"
  | "run.state_changed"
  | "run.completed"
  | "run.failed"
  | "run.recovered"
  | "tool.called"
  | "tool.approved"
  | "tool.rejected"
  | "compaction.triggered"
  | "compaction.completed"
  | "compaction.failed"
  | "subagent.spawned"
  | "subagent.completed"
  | "subagent.failed"
  | "mcp.connected"
  | "mcp.disconnected"
  | "mcp.error"
  | "mcp.reconnected";

// ============================================================================
// Event Payloads
// ============================================================================

export interface RunStartedPayload {
  runId: string;
  sessionId: string;
  taskId?: string;
  trigger: "user" | "retry" | "resume" | "continue";
}

export interface RunStateChangedPayload {
  runId: string;
  sessionId: string;
  previousState: string;
  currentState: string;
  reason?: string;
}

export interface RunCompletedPayload {
  runId: string;
  sessionId: string;
  durationMs: number;
  toolCallCount: number;
  tokensUsed?: number;
  success: boolean;
}

export interface RunFailedPayload {
  runId: string;
  sessionId: string;
  error: string;
  errorCode?: string;
  recoverable: boolean;
}

export interface ToolCalledPayload {
  runId: string;
  sessionId: string;
  toolCallId: string;
  toolName: string;
  durationMs?: number;
  inputSize?: number;
}

export interface ToolDecidedPayload {
  runId: string;
  sessionId: string;
  toolCallId: string;
  toolName: string;
  decision: "approved" | "rejected";
  reason?: string;
  ruleId?: string;
  ruleSource?: "explicit" | "policy" | "default";
}

export interface CompactionTriggeredPayload {
  sessionId: string;
  reason: "budget_exceeded" | "user_requested" | "scheduled" | "error_recovery";
  tokensBefore: number;
  historyEntryCount: number;
}

export interface CompactionCompletedPayload {
  sessionId: string;
  tokensBefore: number;
  tokensAfter: number;
  tokensSaved: number;
  durationMs: number;
  entriesRemoved: number;
  success: boolean;
  error?: string;
}

export interface CompactionFailedPayload {
  sessionId: string;
  error: string;
  tokensBefore: number;
  attempts: number;
}

export interface SubagentSpawnedPayload {
  taskId: string;
  ownerId: string;
  writeScope: "shared" | "isolated" | "worktree";
  background: boolean;
  deadline?: number;
}

export interface SubagentCompletedPayload {
  taskId: string;
  ownerId: string;
  durationMs: number;
  success: boolean;
  outputSize?: number;
}

export interface SubagentFailedPayload {
  taskId: string;
  ownerId: string;
  error: string;
  recoverable: boolean;
}

export interface McpConnectedPayload {
  serverId: string;
  serverName: string;
  transport: "stdio" | "http" | "sse" | "websocket";
  durationMs?: number;
}

export interface McpDisconnectedPayload {
  serverId: string;
  serverName: string;
  reason: "user_requested" | "error" | "timeout" | "protocol_error";
  durationMs: number;
}

export interface McpErrorPayload {
  serverId: string;
  serverName: string;
  error: string;
  errorCode?: string;
  recoverable: boolean;
}

export interface McpReconnectedPayload {
  serverId: string;
  serverName: string;
  attemptNumber: number;
  durationMs: number;
  success: boolean;
}

// ============================================================================
// Telemetry Event
// ============================================================================

export interface TelemetryEvent<T = unknown> {
  id: string;
  type: TelemetryEventType;
  timestamp: string;
  payload: T;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Metrics
// ============================================================================

export interface RunMetrics {
  runId: string;
  sessionId: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  toolCallCount: number;
  toolApprovalCount: number;
  toolRejectionCount: number;
  compactionCount: number;
  errorCount: number;
  finalState?: string;
}

export interface SessionMetrics {
  sessionId: string;
  startedAt: string;
  runCount: number;
  totalDurationMs: number;
  totalToolCalls: number;
  totalCompactions: number;
  currentHistoryTokens: number;
  compactionRatio: number;
}

export interface ToolMetrics {
  toolName: string;
  callCount: number;
  approvalRate: number;
  rejectionRate: number;
  averageDurationMs: number;
  totalDurationMs: number;
  lastCalledAt?: string;
}

export interface McpMetrics {
  serverId: string;
  serverName: string;
  connectCount: number;
  disconnectCount: number;
  errorCount: number;
  reconnectCount: number;
  totalDurationMs: number;
  averageLatencyMs?: number;
  lastConnectedAt?: string;
  lastErrorAt?: string;
}

// ============================================================================
// Telemetry Collector
// ============================================================================

export interface TelemetryCollectorConfig {
  /** Maximum events to keep in memory */
  maxEvents?: number;
  /** Whether to enable metrics aggregation */
  enableMetrics?: boolean;
  /** Custom event sink */
  sink?: TelemetrySink;
}

export interface TelemetrySink {
  emit(event: TelemetryEvent): void | Promise<void>;
  flush(): void | Promise<void>;
}

export class TelemetryCollector {
  private events: TelemetryEvent[] = [];
  private runMetrics: Map<string, RunMetrics> = new Map();
  private toolMetrics: Map<string, ToolMetrics> = new Map();
  private mcpMetrics: Map<string, McpMetrics> = new Map();
  private sessionMetrics: Map<string, SessionMetrics> = new Map();
  private sink?: TelemetrySink;
  private readonly maxEvents: number;
  private readonly enableMetrics: boolean;

  constructor(config: TelemetryCollectorConfig = {}) {
    this.maxEvents = config.maxEvents ?? 10000;
    this.enableMetrics = config.enableMetrics ?? true;
    this.sink = config.sink;
  }

  // ==========================================================================
  // Event Recording
  // ==========================================================================

  /**
   * Record a telemetry event.
   */
  record<T>(type: TelemetryEventType, payload: T, metadata?: Record<string, unknown>): TelemetryEvent<T> {
    const event: TelemetryEvent<T> = {
      id: createId("telemetry"),
      type,
      timestamp: nowIso(),
      payload,
      metadata,
    };

    this.events.push(event as TelemetryEvent);
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }

    this.sink?.emit(event as TelemetryEvent);

    if (this.enableMetrics) {
      this.updateMetrics(event);
    }

    return event;
  }

  /**
   * Record run started.
   */
  recordRunStarted(payload: RunStartedPayload): TelemetryEvent<RunStartedPayload> {
    return this.record("run.started", payload);
  }

  /**
   * Record run state changed.
   */
  recordRunStateChanged(payload: RunStateChangedPayload): TelemetryEvent<RunStateChangedPayload> {
    return this.record("run.state_changed", payload);
  }

  /**
   * Record run completed.
   */
  recordRunCompleted(payload: RunCompletedPayload): TelemetryEvent<RunCompletedPayload> {
    return this.record("run.completed", payload);
  }

  /**
   * Record run failed.
   */
  recordRunFailed(payload: RunFailedPayload): TelemetryEvent<RunFailedPayload> {
    return this.record("run.failed", payload);
  }

  /**
   * Record tool called.
   */
  recordToolCalled(payload: ToolCalledPayload): TelemetryEvent<ToolCalledPayload> {
    return this.record("tool.called", payload);
  }

  /**
   * Record tool approved.
   */
  recordToolApproved(payload: ToolDecidedPayload): TelemetryEvent<ToolDecidedPayload> {
    return this.record("tool.approved", payload);
  }

  /**
   * Record tool rejected.
   */
  recordToolRejected(payload: ToolDecidedPayload): TelemetryEvent<ToolDecidedPayload> {
    return this.record("tool.rejected", payload);
  }

  /**
   * Record compaction triggered.
   */
  recordCompactionTriggered(payload: CompactionTriggeredPayload): TelemetryEvent<CompactionTriggeredPayload> {
    return this.record("compaction.triggered", payload);
  }

  /**
   * Record compaction completed.
   */
  recordCompactionCompleted(payload: CompactionCompletedPayload): TelemetryEvent<CompactionCompletedPayload> {
    return this.record("compaction.completed", payload);
  }

  /**
   * Record compaction failed.
   */
  recordCompactionFailed(payload: CompactionFailedPayload): TelemetryEvent<CompactionFailedPayload> {
    return this.record("compaction.failed", payload);
  }

  /**
   * Record subagent spawned.
   */
  recordSubagentSpawned(payload: SubagentSpawnedPayload): TelemetryEvent<SubagentSpawnedPayload> {
    return this.record("subagent.spawned", payload);
  }

  /**
   * Record subagent completed.
   */
  recordSubagentCompleted(payload: SubagentCompletedPayload): TelemetryEvent<SubagentCompletedPayload> {
    return this.record("subagent.completed", payload);
  }

  /**
   * Record subagent failed.
   */
  recordSubagentFailed(payload: SubagentFailedPayload): TelemetryEvent<SubagentFailedPayload> {
    return this.record("subagent.failed", payload);
  }

  /**
   * Record MCP connected.
   */
  recordMcpConnected(payload: McpConnectedPayload): TelemetryEvent<McpConnectedPayload> {
    return this.record("mcp.connected", payload);
  }

  /**
   * Record MCP disconnected.
   */
  recordMcpDisconnected(payload: McpDisconnectedPayload): TelemetryEvent<McpDisconnectedPayload> {
    return this.record("mcp.disconnected", payload);
  }

  /**
   * Record MCP error.
   */
  recordMcpError(payload: McpErrorPayload): TelemetryEvent<McpErrorPayload> {
    return this.record("mcp.error", payload);
  }

  /**
   * Record MCP reconnected.
   */
  recordMcpReconnected(payload: McpReconnectedPayload): TelemetryEvent<McpReconnectedPayload> {
    return this.record("mcp.reconnected", payload);
  }

  // ==========================================================================
  // Metrics
  // ==========================================================================

  private updateMetrics(event: TelemetryEvent): void {
    switch (event.type) {
      case "run.started": {
        const payload = event.payload as RunStartedPayload;
        this.runMetrics.set(payload.runId, {
          runId: payload.runId,
          sessionId: payload.sessionId,
          startedAt: event.timestamp,
          toolCallCount: 0,
          toolApprovalCount: 0,
          toolRejectionCount: 0,
          compactionCount: 0,
          errorCount: 0,
        });
        break;
      }

      case "run.completed": {
        const payload = event.payload as RunCompletedPayload;
        const metrics = this.runMetrics.get(payload.runId);
        if (metrics) {
          metrics.completedAt = event.timestamp;
          metrics.durationMs = payload.durationMs;
          metrics.finalState = "completed";
        }
        break;
      }

      case "run.failed": {
        const payload = event.payload as RunFailedPayload;
        const metrics = this.runMetrics.get(payload.runId);
        if (metrics) {
          metrics.completedAt = event.timestamp;
          metrics.finalState = "failed";
          metrics.errorCount++;
        }
        break;
      }

      case "tool.called": {
        const payload = event.payload as ToolCalledPayload;
        const runMetrics = this.runMetrics.get(payload.runId);
        if (runMetrics) {
          runMetrics.toolCallCount++;
        }
        this.updateToolMetrics(payload.toolName, "call");
        break;
      }

      case "tool.approved": {
        const payload = event.payload as ToolDecidedPayload;
        const runMetrics = this.runMetrics.get(payload.runId);
        if (runMetrics) {
          runMetrics.toolApprovalCount++;
        }
        this.updateToolMetrics(payload.toolName, "approve");
        break;
      }

      case "tool.rejected": {
        const payload = event.payload as ToolDecidedPayload;
        const runMetrics = this.runMetrics.get(payload.runId);
        if (runMetrics) {
          runMetrics.toolRejectionCount++;
        }
        this.updateToolMetrics(payload.toolName, "reject");
        break;
      }

      case "compaction.completed": {
        const payload = event.payload as CompactionCompletedPayload;
        for (const metrics of this.runMetrics.values()) {
          if (metrics.sessionId === payload.sessionId) {
            metrics.compactionCount++;
          }
        }
        break;
      }
    }
  }

  private updateToolMetrics(toolName: string, action: "call" | "approve" | "reject"): void {
    let metrics = this.toolMetrics.get(toolName);
    if (!metrics) {
      metrics = {
        toolName,
        callCount: 0,
        approvalRate: 0,
        rejectionRate: 0,
        averageDurationMs: 0,
        totalDurationMs: 0,
      };
      this.toolMetrics.set(toolName, metrics);
    }

    if (action === "call") {
      metrics.callCount++;
      metrics.lastCalledAt = nowIso();
    } else if (action === "approve") {
      const total = metrics.callCount;
      metrics.approvalRate = total > 0 ? (metrics.callCount - metrics.rejectionCount) / total : 0;
    } else if (action === "reject") {
      const total = metrics.callCount;
      metrics.rejectionRate = total > 0 ? metrics.rejectionCount / total : 0;
    }
  }

  // ==========================================================================
  // Queries
  // ==========================================================================

  /**
   * Get events by type.
   */
  getEvents(type?: TelemetryEventType, limit = 100): TelemetryEvent[] {
    if (type) {
      return this.events.filter((e) => e.type === type).slice(-limit);
    }
    return this.events.slice(-limit);
  }

  /**
   * Get events for a run.
   */
  getRunEvents(runId: string): TelemetryEvent[] {
    return this.events.filter((e) => {
      const payload = e.payload as Record<string, unknown>;
      return payload.runId === runId;
    });
  }

  /**
   * Get events for a session.
   */
  getSessionEvents(sessionId: string): TelemetryEvent[] {
    return this.events.filter((e) => {
      const payload = e.payload as Record<string, unknown>;
      return payload.sessionId === sessionId;
    });
  }

  /**
   * Get run metrics.
   */
  getRunMetrics(runId: string): RunMetrics | undefined {
    return this.runMetrics.get(runId);
  }

  /**
   * Get all run metrics.
   */
  getAllRunMetrics(): RunMetrics[] {
    return Array.from(this.runMetrics.values());
  }

  /**
   * Get tool metrics.
   */
  getToolMetrics(toolName?: string): ToolMetrics | ToolMetrics[] {
    if (toolName) {
      return this.toolMetrics.get(toolName)!;
    }
    return Array.from(this.toolMetrics.values());
  }

  /**
   * Get MCP metrics.
   */
  getMcpMetrics(serverId?: string): McpMetrics | McpMetrics[] {
    if (serverId) {
      return this.mcpMetrics.get(serverId)!;
    }
    return Array.from(this.mcpMetrics.values());
  }

  // ==========================================================================
  // Maintenance
  // ==========================================================================

  /**
   * Clear old events.
   */
  clearOlderThan(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    const cutoffDate = new Date(cutoff).toISOString();
    const initialLength = this.events.length;

    this.events = this.events.filter((e) => e.timestamp > cutoffDate);

    return initialLength - this.events.length;
  }

  /**
   * Flush the sink.
   */
  async flush(): Promise<void> {
    await this.sink?.flush();
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let globalCollector: TelemetryCollector | undefined;

export function getTelemetryCollector(): TelemetryCollector {
  if (!globalCollector) {
    globalCollector = new TelemetryCollector();
  }
  return globalCollector;
}

export function setTelemetryCollector(collector: TelemetryCollector): void {
  globalCollector = collector;
}
