/**
 * Diagnostics Module
 *
 * Provides runtime diagnostics and health checks for the runner:
 * - Health check endpoints
 * - Performance metrics
 * - Error aggregation
 * - Release gate metrics
 */

import { nowIso } from "@omi/core";
import type { TelemetryCollector, RunMetrics } from "@omi/agent";

// ============================================================================
// Health Check Types
// ============================================================================

export type HealthStatus = "healthy" | "degraded" | "unhealthy";

export interface HealthCheckResult {
  status: HealthStatus;
  timestamp: string;
  checks: ComponentHealthCheck[];
  overallMessage?: string;
}

export interface ComponentHealthCheck {
  component: string;
  status: HealthStatus;
  message?: string;
  latencyMs?: number;
  details?: Record<string, unknown>;
}

// ============================================================================
// Performance Metrics
// ============================================================================

export interface PerformanceMetrics {
  timestamp: string;
  uptime: number;
  requests: {
    total: number;
    success: number;
    failed: number;
    averageLatencyMs: number;
  };
  runs: {
    active: number;
    completed: number;
    failed: number;
    averageDurationMs: number;
  };
  tools: {
    totalCalls: number;
    approvalRate: number;
    averageLatencyMs: number;
  };
  memory: {
    usedBytes: number;
    totalBytes: number;
    usagePercent: number;
  };
  cpu: {
    usagePercent: number;
  };
}

// ============================================================================
// Error Aggregation
// ============================================================================

export interface ErrorSummary {
  errorCode: string;
  count: number;
  lastOccurrence: string;
  firstOccurrence: string;
  messages: string[];
  affectedRuns: string[];
}

export interface ErrorReport {
  timestamp: string;
  period: {
    start: string;
    end: string;
  };
  totalErrors: number;
  uniqueErrorCodes: number;
  errorsByCode: ErrorSummary[];
  recentErrors: Array<{
    timestamp: string;
    runId?: string;
    errorCode: string;
    message: string;
  }>;
}

// ============================================================================
// Release Gate Metrics
// ============================================================================

export interface ReleaseGateMetrics {
  timestamp: string;
  period: {
    start: string;
    end: string;
  };
  successRate: number;
  errorRate: number;
  toolApprovalRate: number;
  toolRejectionRate: number;
  averageRunDurationMs: number;
  p95RunDurationMs: number;
  compactionSuccessRate: number;
  subagentSuccessRate: number;
  mcpConnectionSuccessRate: number;
  gateStatus: "pass" | "fail" | "warning";
  gateChecks: GateCheck[];
}

export interface GateCheck {
  name: string;
  metric: string;
  threshold: number;
  actual: number;
  status: "pass" | "fail" | "warning";
  message?: string;
}

// ============================================================================
// Diagnostics Collector
// ============================================================================

export interface DiagnosticsConfig {
  /** Telemetry collector instance */
  telemetry?: TelemetryCollector;
  /** Error reporting window in ms */
  errorWindowMs?: number;
  /** Release gate thresholds */
  gateThresholds?: GateThresholds;
}

export interface GateThresholds {
  minSuccessRate?: number;
  maxErrorRate?: number;
  maxAverageRunDurationMs?: number;
  minToolApprovalRate?: number;
  minCompactionSuccessRate?: number;
}

export class DiagnosticsCollector {
  private telemetry?: TelemetryCollector;
  private startTime: Date;
  private requestCount = 0;
  private successCount = 0;
  private failureCount = 0;
  private totalLatencyMs = 0;
  private recentErrors: Array<{
    timestamp: string;
    runId?: string;
    errorCode: string;
    message: string;
  }> = [];
  private readonly errorWindowMs: number;
  private readonly gateThresholds: Required<GateThresholds>;

  constructor(config: DiagnosticsConfig = {}) {
    this.telemetry = config.telemetry;
    this.startTime = new Date();
    this.errorWindowMs = config.errorWindowMs ?? 3600000; // 1 hour
    this.gateThresholds = {
      minSuccessRate: config.gateThresholds?.minSuccessRate ?? 0.95,
      maxErrorRate: config.gateThresholds?.maxErrorRate ?? 0.05,
      maxAverageRunDurationMs: config.gateThresholds?.maxAverageRunDurationMs ?? 300000,
      minToolApprovalRate: config.gateThresholds?.minToolApprovalRate ?? 0.80,
      minCompactionSuccessRate: config.gateThresholds?.minCompactionSuccessRate ?? 0.90,
    };
  }

  // ==========================================================================
  // Health Checks
  // ==========================================================================

  /**
   * Run all health checks.
   */
  async checkHealth(): Promise<HealthCheckResult> {
    const checks = await Promise.all([
      this.checkDatabaseHealth(),
      this.checkTelemetryHealth(),
      this.checkMemoryHealth(),
    ]);

    const overallStatus = this.getOverallStatus(checks);
    const message = this.getStatusMessage(overallStatus);

    return {
      status: overallStatus,
      timestamp: nowIso(),
      checks,
      overallMessage: message,
    };
  }

  private async checkDatabaseHealth(): Promise<ComponentHealthCheck> {
    const start = Date.now();
    try {
      // Placeholder - would actually check database connection
      const latency = Date.now() - start;
      return {
        component: "database",
        status: "healthy",
        latencyMs: latency,
      };
    } catch (error) {
      return {
        component: "database",
        status: "unhealthy",
        message: error instanceof Error ? error.message : "Unknown error",
        latencyMs: Date.now() - start,
      };
    }
  }

  private async checkTelemetryHealth(): Promise<ComponentHealthCheck> {
    const start = Date.now();
    try {
      if (!this.telemetry) {
        return {
          component: "telemetry",
          status: "degraded",
          message: "Telemetry not configured",
          latencyMs: Date.now() - start,
        };
      }

      // Test telemetry query
      this.telemetry.getEvents(undefined, 1);
      const latency = Date.now() - start;

      return {
        component: "telemetry",
        status: "healthy",
        latencyMs: latency,
      };
    } catch (error) {
      return {
        component: "telemetry",
        status: "unhealthy",
        message: error instanceof Error ? error.message : "Unknown error",
        latencyMs: Date.now() - start,
      };
    }
  }

  private checkMemoryHealth(): ComponentHealthCheck {
    const memUsage = process.memoryUsage();
    const usagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;

    let status: HealthStatus = "healthy";
    if (usagePercent > 90) {
      status = "unhealthy";
    } else if (usagePercent > 80) {
      status = "degraded";
    }

    return {
      component: "memory",
      status,
      latencyMs: 0,
      details: {
        usedBytes: memUsage.heapUsed,
        totalBytes: memUsage.heapTotal,
        usagePercent,
      },
    };
  }

  private getOverallStatus(checks: ComponentHealthCheck[]): HealthStatus {
    if (checks.some((c) => c.status === "unhealthy")) {
      return "unhealthy";
    }
    if (checks.some((c) => c.status === "degraded")) {
      return "degraded";
    }
    return "healthy";
  }

  private getStatusMessage(status: HealthStatus): string {
    switch (status) {
      case "healthy":
        return "All systems operational";
      case "degraded":
        return "Some components are experiencing issues";
      case "unhealthy":
        return "Critical issues detected - immediate attention required";
    }
  }

  // ==========================================================================
  // Performance Metrics
  // ==========================================================================

  /**
   * Get performance metrics.
   */
  getPerformanceMetrics(): PerformanceMetrics {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    const uptime = Date.now() - this.startTime.getTime();

    // Get run metrics from telemetry
    const runMetrics = this.telemetry?.getAllRunMetrics() ?? [];
    const completedRuns = runMetrics.filter((r) => r.completedAt);
    const failedRuns = completedRuns.filter((r) => r.finalState === "failed");

    const totalRunDuration = completedRuns.reduce(
      (sum, r) => sum + (r.durationMs ?? 0),
      0
    );

    return {
      timestamp: nowIso(),
      uptime,
      requests: {
        total: this.requestCount,
        success: this.successCount,
        failed: this.failureCount,
        averageLatencyMs: this.requestCount > 0 ? this.totalLatencyMs / this.requestCount : 0,
      },
      runs: {
        active: runMetrics.length - completedRuns.length,
        completed: completedRuns.length,
        failed: failedRuns.length,
        averageDurationMs: completedRuns.length > 0 ? totalRunDuration / completedRuns.length : 0,
      },
      tools: {
        totalCalls: runMetrics.reduce((sum, r) => sum + r.toolCallCount, 0),
        approvalRate: this.calculateApprovalRate(runMetrics),
        averageLatencyMs: 0, // Would need per-tool tracking
      },
      memory: {
        usedBytes: memUsage.heapUsed,
        totalBytes: memUsage.heapTotal,
        usagePercent: (memUsage.heapUsed / memUsage.heapTotal) * 100,
      },
      cpu: {
        usagePercent: 0, // Would need delta calculation
      },
    };
  }

  private calculateApprovalRate(runs: RunMetrics[]): number {
    const totalApprovals = runs.reduce((sum, r) => sum + r.toolApprovalCount, 0);
    const totalCalls = runs.reduce((sum, r) => sum + r.toolCallCount, 0);
    return totalCalls > 0 ? totalApprovals / totalCalls : 0;
  }

  // ==========================================================================
  // Error Reporting
  // ==========================================================================

  /**
   * Record an error.
   */
  recordError(runId: string | undefined, errorCode: string, message: string): void {
    const now = nowIso();

    // Add to recent errors
    this.recentErrors.push({
      timestamp: now,
      runId,
      errorCode,
      message,
    });

    // Trim old errors
    const cutoff = Date.now() - this.errorWindowMs;
    const cutoffDate = new Date(cutoff).toISOString();
    this.recentErrors = this.recentErrors.filter((e) => e.timestamp > cutoffDate);
  }

  /**
   * Get error report.
   */
  getErrorReport(periodMs?: number): ErrorReport {
    const period = periodMs ?? this.errorWindowMs;
    const start = new Date(Date.now() - period).toISOString();
    const end = nowIso();

    const recentErrors = this.recentErrors.filter((e) => e.timestamp >= start);

    // Aggregate by error code
    const byCode = new Map<string, ErrorSummary>();
    for (const error of recentErrors) {
      const existing = byCode.get(error.errorCode);
      if (existing) {
        existing.count++;
        if (!existing.messages.includes(error.message)) {
          existing.messages.push(error.message);
        }
        if (error.runId && !existing.affectedRuns.includes(error.runId)) {
          existing.affectedRuns.push(error.runId);
        }
      } else {
        byCode.set(error.errorCode, {
          errorCode: error.errorCode,
          count: 1,
          lastOccurrence: error.timestamp,
          firstOccurrence: error.timestamp,
          messages: [error.message],
          affectedRuns: error.runId ? [error.runId] : [],
        });
      }
    }

    const errorsByCode = Array.from(byCode.values()).sort((a, b) => b.count - a.count);

    return {
      timestamp: nowIso(),
      period: { start, end },
      totalErrors: recentErrors.length,
      uniqueErrorCodes: errorsByCode.length,
      errorsByCode,
      recentErrors: recentErrors.slice(-10).reverse(),
    };
  }

  // ==========================================================================
  // Release Gate Metrics
  // ==========================================================================

  /**
   * Get release gate metrics.
   */
  getReleaseGateMetrics(periodMs?: number): ReleaseGateMetrics {
    const period = periodMs ?? this.errorWindowMs;
    const start = new Date(Date.now() - period).toISOString();
    const end = nowIso();

    const runMetrics = this.telemetry?.getAllRunMetrics() ?? [];
    const completedRuns = runMetrics.filter((r) => r.completedAt);
    const failedRuns = completedRuns.filter((r) => r.finalState === "failed");

    const successRate = completedRuns.length > 0
      ? (completedRuns.length - failedRuns.length) / completedRuns.length
      : 0;

    const errorRate = completedRuns.length > 0
      ? failedRuns.length / completedRuns.length
      : 0;

    const totalRunDuration = completedRuns.reduce((sum, r) => sum + (r.durationMs ?? 0), 0);
    const averageRunDurationMs = completedRuns.length > 0
      ? totalRunDuration / completedRuns.length
      : 0;

    // Sort durations for p95
    const durations = completedRuns
      .map((r) => r.durationMs ?? 0)
      .sort((a, b) => a - b);
    const p95Index = Math.floor(durations.length * 0.95);
    const p95RunDurationMs = durations[p95Index] ?? 0;

    const gateChecks: GateCheck[] = [
      {
        name: "Success Rate",
        metric: "successRate",
        threshold: this.gateThresholds.minSuccessRate,
        actual: successRate,
        status: successRate >= this.gateThresholds.minSuccessRate ? "pass" : "fail",
        message: `${(successRate * 100).toFixed(1)}% (threshold: ${(this.gateThresholds.minSuccessRate * 100).toFixed(0)}%)`,
      },
      {
        name: "Error Rate",
        metric: "errorRate",
        threshold: this.gateThresholds.maxErrorRate,
        actual: errorRate,
        status: errorRate <= this.gateThresholds.maxErrorRate ? "pass" : "fail",
        message: `${(errorRate * 100).toFixed(1)}% (max: ${(this.gateThresholds.maxErrorRate * 100).toFixed(0)}%)`,
      },
      {
        name: "Average Run Duration",
        metric: "averageRunDurationMs",
        threshold: this.gateThresholds.maxAverageRunDurationMs,
        actual: averageRunDurationMs,
        status: averageRunDurationMs <= this.gateThresholds.maxAverageRunDurationMs ? "pass" : "warning",
        message: `${(averageRunDurationMs / 1000).toFixed(1)}s (max: ${(this.gateThresholds.maxAverageRunDurationMs / 1000).toFixed(0)}s)`,
      },
    ];

    const failedChecks = gateChecks.filter((c) => c.status === "fail").length;
    const warnedChecks = gateChecks.filter((c) => c.status === "warning").length;

    let gateStatus: "pass" | "fail" | "warning" = "pass";
    if (failedChecks > 0) {
      gateStatus = "fail";
    } else if (warnedChecks > 0) {
      gateStatus = "warning";
    }

    return {
      timestamp: nowIso(),
      period: { start, end },
      successRate,
      errorRate,
      toolApprovalRate: this.calculateApprovalRate(runMetrics),
      toolRejectionRate: 1 - this.calculateApprovalRate(runMetrics),
      averageRunDurationMs,
      p95RunDurationMs,
      compactionSuccessRate: 0, // Would need compaction metrics
      subagentSuccessRate: 0, // Would need subagent metrics
      mcpConnectionSuccessRate: 0, // Would need MCP metrics
      gateStatus,
      gateChecks,
    };
  }

  // ==========================================================================
  // Request Tracking
  // ==========================================================================

  /**
   * Record a request.
   */
  recordRequest(success: boolean, latencyMs: number): void {
    this.requestCount++;
    if (success) {
      this.successCount++;
    } else {
      this.failureCount++;
    }
    this.totalLatencyMs += latencyMs;
  }
}
