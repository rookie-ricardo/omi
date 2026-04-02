/**
 * Audit Log Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  AuditLog,
  getAuditLog,
  setAuditLog,
  createToolAuditEntry,
  type AuditEntry,
} from "../src/audit-log";

describe("AuditLog", () => {
  let auditLog: AuditLog;

  beforeEach(() => {
    auditLog = new AuditLog({ maxEntries: 100 });
  });

  afterEach(() => {
    setAuditLog(undefined);
  });

  describe("logToolDecision", () => {
    it("should log tool approval", () => {
      auditLog.logToolDecision({
        toolCallId: "tc-1",
        runId: "run-1",
        sessionId: "session-1",
        toolName: "bash",
        input: { cmd: "echo hello" },
        decision: "approved",
        decisionSource: "user",
      });

      const entries = auditLog.query({});
      expect(entries).toHaveLength(1);
      expect(entries[0].type).toBe("tool.approved");
      expect(entries[0].severity).toBe("info");
    });

    it("should log tool rejection as warning", () => {
      auditLog.logToolDecision({
        toolCallId: "tc-1",
        runId: "run-1",
        sessionId: "session-1",
        toolName: "bash",
        input: {},
        decision: "rejected",
        decisionSource: "rule",
        reason: "Blocked by policy",
      });

      const entries = auditLog.query({});
      expect(entries).toHaveLength(1);
      expect(entries[0].type).toBe("tool.rejected");
      expect(entries[0].severity).toBe("warning");
    });

    it("should log tool denial as critical", () => {
      auditLog.logToolDecision({
        toolCallId: "tc-1",
        runId: "run-1",
        sessionId: "session-1",
        toolName: "rm",
        input: {},
        decision: "denied",
        decisionSource: "system",
      });

      const entries = auditLog.query({});
      expect(entries).toHaveLength(1);
      expect(entries[0].type).toBe("tool.denied");
      expect(entries[0].severity).toBe("critical");
    });
  });

  describe("logToolExecuted", () => {
    it("should log successful execution", () => {
      auditLog.logToolExecuted({
        toolCallId: "tc-1",
        runId: "run-1",
        sessionId: "session-1",
        toolName: "bash",
        durationMs: 100,
        success: true,
        outputSize: 1024,
      });

      const entries = auditLog.query({});
      expect(entries).toHaveLength(1);
      expect(entries[0].type).toBe("tool.executed");
      expect(entries[0].severity).toBe("info");
    });

    it("should log failed execution as warning", () => {
      auditLog.logToolExecuted({
        toolCallId: "tc-1",
        runId: "run-1",
        sessionId: "session-1",
        toolName: "bash",
        durationMs: 100,
        success: false,
        error: "Command failed",
      });

      const entries = auditLog.query({});
      expect(entries).toHaveLength(1);
      expect(entries[0].type).toBe("tool.failed");
      expect(entries[0].severity).toBe("warning");
    });
  });

  describe("logPermissionCheck", () => {
    it("should log denied permission checks", () => {
      auditLog.logPermissionCheck({
        sessionId: "session-1",
        toolName: "bash",
        decision: "deny",
        reason: "Blocked by rule",
        matchedRules: [{ ruleId: "rule-1", ruleName: "Block rm", priority: 1 }],
      });

      const entries = auditLog.query({});
      expect(entries).toHaveLength(1);
      expect(entries[0].type).toBe("permission.check");
    });

    it("should skip allow decisions by default", () => {
      auditLog.logPermissionCheck({
        sessionId: "session-1",
        toolName: "bash",
        decision: "allow",
        matchedRules: [],
      });

      const entries = auditLog.query({});
      expect(entries).toHaveLength(0);
    });
  });

  describe("logRuleChange", () => {
    it("should log rule added", () => {
      auditLog.logRuleChange({
        ruleId: "rule-1",
        ruleName: "Block dangerous",
        action: "added",
        sessionId: "session-1",
        actor: "user",
      });

      const entries = auditLog.query({});
      expect(entries).toHaveLength(1);
      expect(entries[0].type).toBe("rule.added");
    });

    it("should log rule deleted", () => {
      auditLog.logRuleChange({
        ruleId: "rule-1",
        ruleName: "Old rule",
        action: "deleted",
        actor: "system",
      });

      const entries = auditLog.query({});
      expect(entries).toHaveLength(1);
      expect(entries[0].type).toBe("rule.deleted");
    });
  });

  describe("logModeTransition", () => {
    it("should log mode entered", () => {
      auditLog.logModeTransition({
        sessionId: "session-1",
        fromMode: "none",
        toMode: "plan",
        reason: "User requested",
      });

      const entries = auditLog.query({});
      expect(entries).toHaveLength(1);
      expect(entries[0].type).toBe("mode.entered");
    });

    it("should log mode exited", () => {
      auditLog.logModeTransition({
        sessionId: "session-1",
        fromMode: "plan",
        toMode: "none",
        stepsApproved: 5,
        stepsRejected: 1,
      });

      const entries = auditLog.query({});
      expect(entries).toHaveLength(1);
      expect(entries[0].type).toBe("mode.exited");
    });
  });

  describe("logSession", () => {
    it("should log session created", () => {
      auditLog.logSession({
        sessionId: "session-1",
        action: "created",
      });

      const entries = auditLog.query({});
      expect(entries).toHaveLength(1);
      expect(entries[0].type).toBe("session.created");
    });

    it("should log branch created", () => {
      auditLog.logSession({
        sessionId: "session-2",
        action: "branch_created",
        parentSessionId: "session-1",
        branchName: "feature/test",
        branchId: "branch-1",
      });

      const entries = auditLog.query({});
      expect(entries).toHaveLength(1);
      expect(entries[0].type).toBe("session.branch_created");
    });
  });

  describe("logSubagent", () => {
    it("should log subagent spawned", () => {
      auditLog.logSubagent({
        taskId: "task-1",
        ownerId: "session-1",
        action: "spawned",
        writeScope: "shared",
        prompt: "Analyze this code",
      });

      const entries = auditLog.query({});
      expect(entries).toHaveLength(1);
      expect(entries[0].type).toBe("subagent.spawned");
    });

    it("should log subagent aborted", () => {
      auditLog.logSubagent({
        taskId: "task-1",
        ownerId: "session-1",
        action: "aborted",
        writeScope: "shared",
        reason: "User cancelled",
      });

      const entries = auditLog.query({});
      expect(entries).toHaveLength(1);
      expect(entries[0].type).toBe("subagent.aborted");
    });
  });

  describe("logWorktree", () => {
    it("should log worktree created", () => {
      auditLog.logWorktree({
        worktreeId: "wt-1",
        action: "created",
        path: "/tmp/worktree-1",
        branch: "feature/test",
      });

      const entries = auditLog.query({});
      expect(entries).toHaveLength(1);
      expect(entries[0].type).toBe("worktree.created");
    });

    it("should log forced cleanup as warning", () => {
      auditLog.logWorktree({
        worktreeId: "wt-1",
        action: "cleaned",
        path: "/tmp/worktree-1",
        branch: "feature/test",
        changesDetected: 5,
        force: true,
      });

      const entries = auditLog.query({});
      expect(entries).toHaveLength(1);
      expect(entries[0].severity).toBe("warning");
    });
  });

  describe("query", () => {
    beforeEach(() => {
      auditLog.logToolDecision({
        toolCallId: "tc-1",
        runId: "run-1",
        sessionId: "session-1",
        toolName: "bash",
        input: {},
        decision: "approved",
        decisionSource: "user",
      });
      auditLog.logToolDecision({
        toolCallId: "tc-2",
        runId: "run-1",
        sessionId: "session-1",
        toolName: "edit",
        input: {},
        decision: "rejected",
        decisionSource: "rule",
      });
      auditLog.logToolDecision({
        toolCallId: "tc-3",
        runId: "run-2",
        sessionId: "session-2",
        toolName: "bash",
        input: {},
        decision: "approved",
        decisionSource: "user",
      });
    });

    it("should query by type", () => {
      const entries = auditLog.query({ types: ["tool.approved"] });
      expect(entries).toHaveLength(2);
    });

    it("should query by session", () => {
      const entries = auditLog.query({ sessionId: "session-1" });
      expect(entries).toHaveLength(2);
    });

    it("should query by run", () => {
      const entries = auditLog.query({ runId: "run-1" });
      expect(entries).toHaveLength(2);
    });

    it("should query by severity", () => {
      const entries = auditLog.query({ severity: "warning" });
      expect(entries).toHaveLength(1);
    });

    it("should combine filters", () => {
      const entries = auditLog.query({
        types: ["tool.approved"],
        sessionId: "session-1",
      });
      expect(entries).toHaveLength(1);
    });

    it("should limit results", () => {
      const entries = auditLog.query({ limit: 2 });
      expect(entries).toHaveLength(2);
    });
  });

  describe("getToolDecisions", () => {
    beforeEach(() => {
      auditLog.logToolDecision({
        toolCallId: "tc-1",
        runId: "run-1",
        sessionId: "session-1",
        toolName: "bash",
        input: {},
        decision: "approved",
        decisionSource: "user",
      });
      auditLog.logToolExecuted({
        toolCallId: "tc-1",
        runId: "run-1",
        sessionId: "session-1",
        toolName: "bash",
        durationMs: 100,
        success: true,
      });
    });

    it("should get tool decisions for run", async () => {
      const decisions = await auditLog.getToolDecisions("run-1");
      expect(decisions).toHaveLength(1);
      expect(decisions[0].payload.decision).toBe("approved");
    });
  });

  describe("getErrorTrail", () => {
    it("should get warning entries for run", async () => {
      auditLog.logToolDecision({
        toolCallId: "tc-1",
        runId: "run-1",
        sessionId: "session-1",
        toolName: "bash",
        input: {},
        decision: "rejected",
        decisionSource: "rule",
      });

      const trail = await auditLog.getErrorTrail("run-1");
      expect(trail.length).toBeGreaterThan(0);
    });
  });

  describe("severity filter", () => {
    it("should filter by minimum severity", () => {
      const filteredLog = new AuditLog({ minSeverity: "warning" });

      filteredLog.logToolDecision({
        toolCallId: "tc-1",
        runId: "run-1",
        sessionId: "session-1",
        toolName: "bash",
        input: {},
        decision: "approved",
        decisionSource: "user",
      });
      filteredLog.logToolDecision({
        toolCallId: "tc-2",
        runId: "run-1",
        sessionId: "session-1",
        toolName: "rm",
        input: {},
        decision: "denied",
        decisionSource: "system",
      });

      // Info-level entries should be filtered
      expect(filteredLog.query({})).toHaveLength(1);
    });
  });

  describe("singleton", () => {
    it("should get global audit log", () => {
      const log1 = getAuditLog();
      expect(log1).toBeDefined();

      const log2 = getAuditLog();
      expect(log1).toBe(log2);
    });

    it("should set global audit log", () => {
      const custom = new AuditLog();
      setAuditLog(custom);

      expect(getAuditLog()).toBe(custom);
    });
  });
});

describe("createToolAuditEntry", () => {
  it("should create tool audit entry", () => {
    const entry = createToolAuditEntry(
      "tc-1",
      "run-1",
      "session-1",
      "bash",
      "approved",
      {
        input: { cmd: "echo hello" },
        reason: "Safe command",
        ruleId: "rule-1",
        ruleName: "Allow bash",
        decisionSource: "rule",
        latencyMs: 100,
      }
    );

    expect(entry.toolCallId).toBe("tc-1");
    expect(entry.runId).toBe("run-1");
    expect(entry.sessionId).toBe("session-1");
    expect(entry.toolName).toBe("bash");
    expect(entry.decision).toBe("approved");
    expect(entry.input).toEqual({ cmd: "echo hello" });
    expect(entry.reason).toBe("Safe command");
    expect(entry.ruleId).toBe("rule-1");
    expect(entry.decisionSource).toBe("rule");
    expect(entry.latencyMs).toBe(100);
  });

  it("should use defaults", () => {
    const entry = createToolAuditEntry("tc-1", "run-1", "session-1", "bash", "approved");

    expect(entry.input).toEqual({});
    expect(entry.decisionSource).toBe("system");
  });
});
