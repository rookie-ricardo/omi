/**
 * Audit Log Service Tests
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuditLogService,
  type PermissionSource,
  type ToolCallStatus,
} from "../src/audit-log";

describe("AuditLogService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("records tool call lifecycle data, redacts sensitive inputs, and ignores unknown completions", () => {
    const auditLog = new AuditLogService();
    const snapshots: Array<{ status: ToolCallStatus; completedAt?: string; durationMs?: number }> = [];

    auditLog.on((event) => {
      if (event.type === "tool_call") {
        snapshots.push({
          status: event.entry.status,
          completedAt: event.entry.completedAt,
          durationMs: event.entry.durationMs,
        });
      }
    });

    const entryId = auditLog.recordToolCallStart(
      "session-1",
      "run-1",
      "tool-call-1",
      "bash",
      {
        command: "echo hello",
        password: "secret",
        nested: {
          token: "inner-secret",
          details: {
            api_key: "nested-secret",
            label: "kept",
          },
        },
      },
      true,
    );

    vi.advanceTimersByTime(1200);

    auditLog.recordToolCallComplete(
      entryId,
      "approved",
      {
        success: true,
        outputLength: 24,
      },
    );

    auditLog.recordToolCallComplete(
      "missing-entry",
      "failed",
      {
        success: false,
        errorCode: "EFAIL",
      },
      "not found",
    );

    const [entry] = auditLog.getToolCallEntries("session-1");
    expect(entry).toMatchObject({
      id: entryId,
      sessionId: "session-1",
      runId: "run-1",
      toolCallId: "tool-call-1",
      toolName: "bash",
      status: "approved",
      requiresApproval: true,
      startedAt: "2024-01-01T00:00:00.000Z",
      completedAt: "2024-01-01T00:00:01.200Z",
      durationMs: 1200,
      toolInput: {
        command: "echo hello",
        password: "[REDACTED]",
        nested: {
          token: "[REDACTED]",
          details: {
            api_key: "[REDACTED]",
            label: "kept",
          },
        },
      },
      result: {
        success: true,
        outputLength: 24,
      },
    });
    expect(auditLog.getToolCallEntries("missing-session")).toEqual([]);
    expect(auditLog.getStats()).toMatchObject({
      totalToolCalls: 1,
      toolCallsByStatus: {
        pending: 0,
        approved: 1,
        rejected: 0,
        failed: 0,
        skipped: 0,
      },
    });
    expect(snapshots).toEqual([
      {
        status: "pending",
        completedAt: undefined,
        durationMs: undefined,
      },
      {
        status: "approved",
        completedAt: "2024-01-01T00:00:01.200Z",
        durationMs: 1200,
      },
    ]);
  });

  it("records every permission source, filters by session, and suppresses tool and permission logs when disabled", () => {
    const auditLog = new AuditLogService();

    auditLog.recordPermission("session-1", "run-1", "tool-call-1", "bash", "auto", "approved");
    auditLog.recordPermission("session-1", "run-1", "tool-call-1", "bash", "plan", "approved");
    auditLog.recordPermission("session-1", "run-2", "tool-call-2", "bash", "manual", "approved", {
      userConfirmed: true,
    });
    auditLog.recordPermission("session-2", "run-3", "tool-call-3", "edit", "teammate", "rejected");
    auditLog.recordPermission("session-1", "run-4", "tool-call-4", "grep", "allowed_prompts", "approved", {
      promptMatch: "read-only",
    });
    auditLog.recordPermission("session-2", "run-5", "tool-call-5", "rm", "hook", "rejected");

    const sessionEntries = auditLog.getPermissionEntries("session-1");
    expect(sessionEntries).toHaveLength(4);
    expect(sessionEntries[2]).toMatchObject({
      runId: "run-2",
      toolCallId: "tool-call-2",
      source: "manual",
      decision: "approved",
      approved: true,
      userConfirmed: true,
    });
    expect(sessionEntries[3]).toMatchObject({
      runId: "run-4",
      toolCallId: "tool-call-4",
      source: "allowed_prompts",
      decision: "approved",
      approved: true,
      promptMatch: "read-only",
    });
    expect(auditLog.getPermissionEntries("missing-session")).toEqual([]);

    expect(auditLog.getStats()).toMatchObject({
      totalPermissions: 6,
      permissionsBySource: {
        auto: 1,
        plan: 1,
        manual: 1,
        teammate: 1,
        allowed_prompts: 1,
        hook: 1,
      },
      permissionsApproved: 4,
      permissionsRejected: 2,
    });

    const disabled = new AuditLogService({ enabled: false });
    expect(
      disabled.recordToolCallStart(
        "session-disabled",
        "run-disabled",
        "tool-call-disabled",
        "bash",
        { password: "secret" },
        true,
      ),
    ).toBe("");
    expect(
      disabled.recordPermission(
        "session-disabled",
        "run-disabled",
        "tool-call-disabled",
        "bash",
        "auto",
        "approved",
      ),
    ).toBe("");
    expect(disabled.getToolCallEntries()).toEqual([]);
    expect(disabled.getPermissionEntries()).toEqual([]);
  });

  it("records security events, trims to maxEntries, and clears stored state", () => {
    const auditLog = new AuditLogService({ maxEntries: 1 });

    auditLog.recordSecurityEvent(
      "session-1",
      "dangerous_command_blocked",
      {
        command: "rm -rf /",
      },
      true,
      {
        toolName: "bash",
      },
    );

    auditLog.recordSecurityEvent(
      "session-1",
      "sensitive_data_access",
      {
        path: "/tmp/secret.txt",
      },
      false,
      {
        toolName: "read",
      },
    );

    const securityEntries = auditLog.getSecurityEntries("session-1");
    expect(securityEntries).toHaveLength(1);
    expect(securityEntries[0]).toMatchObject({
      sessionId: "session-1",
      eventType: "sensitive_data_access",
      toolName: "read",
      details: {
        path: "/tmp/secret.txt",
      },
      blocked: false,
    });
    expect(auditLog.getStats()).toMatchObject({
      totalSecurityEvents: 1,
      securityEventsBlocked: 0,
    });

    auditLog.clear();

    expect(auditLog.getToolCallEntries()).toEqual([]);
    expect(auditLog.getPermissionEntries()).toEqual([]);
    expect(auditLog.getSecurityEntries()).toEqual([]);
    expect(auditLog.getStats()).toMatchObject({
      totalToolCalls: 0,
      totalPermissions: 0,
      totalSecurityEvents: 0,
    });
  });
});
