/**
 * Telemetry Tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  TelemetryCollector,
  getTelemetryCollector,
  setTelemetryCollector,
} from "../src/telemetry";
import type { TelemetryEvent } from "../src/telemetry";

describe("TelemetryCollector", () => {
  let collector: TelemetryCollector;

  beforeEach(() => {
    collector = new TelemetryCollector({ maxEvents: 100 });
  });

  afterEach(() => {
    setTelemetryCollector(undefined);
  });

  describe("record", () => {
    it("should record events", () => {
      const event = collector.record("run.started", {
        runId: "run-1",
        sessionId: "session-1",
      });

      expect(event.id).toBeDefined();
      expect(event.type).toBe("run.started");
      expect(event.timestamp).toBeDefined();
      expect(event.payload.runId).toBe("run-1");
    });

    it("should include metadata", () => {
      const event = collector.record(
        "run.completed",
        { runId: "run-1", sessionId: "session-1", durationMs: 1000, toolCallCount: 5, success: true },
        { source: "test" }
      );

      expect(event.metadata?.source).toBe("test");
    });

    it("should limit event count", () => {
      const smallCollector = new TelemetryCollector({ maxEvents: 5 });

      for (let i = 0; i < 10; i++) {
        smallCollector.record("run.started", { runId: `run-${i}`, sessionId: "s1" });
      }

      const events = smallCollector.getEvents();
      expect(events.length).toBe(5);
    });
  });

  describe("convenience methods", () => {
    it("should record run started", () => {
      const event = collector.recordRunStarted({
        runId: "run-1",
        sessionId: "session-1",
        trigger: "user",
      });

      expect(event.type).toBe("run.started");
      expect(event.payload.runId).toBe("run-1");
      expect(event.payload.trigger).toBe("user");
    });

    it("should record tool called", () => {
      const event = collector.recordToolCalled({
        runId: "run-1",
        sessionId: "session-1",
        toolCallId: "tc-1",
        toolName: "bash",
        durationMs: 100,
      });

      expect(event.type).toBe("tool.called");
      expect(event.payload.toolName).toBe("bash");
    });

    it("should record tool approved", () => {
      const event = collector.recordToolApproved({
        runId: "run-1",
        sessionId: "session-1",
        toolCallId: "tc-1",
        toolName: "bash",
        decision: "approved",
        decisionSource: "user",
      });

      expect(event.type).toBe("tool.approved");
      expect(event.payload.decision).toBe("approved");
    });

    it("should record tool rejected", () => {
      const event = collector.recordToolRejected({
        runId: "run-1",
        sessionId: "session-1",
        toolCallId: "tc-1",
        toolName: "bash",
        decision: "rejected",
        reason: "Dangerous command",
      });

      expect(event.type).toBe("tool.rejected");
      expect(event.payload.decision).toBe("rejected");
    });

    it("should record compaction", () => {
      const event = collector.recordCompactionCompleted({
        sessionId: "session-1",
        tokensBefore: 100000,
        tokensAfter: 50000,
        tokensSaved: 50000,
        durationMs: 500,
        entriesRemoved: 10,
        success: true,
      });

      expect(event.type).toBe("compaction.completed");
      expect(event.payload.tokensSaved).toBe(50000);
    });

    it("should record subagent events", () => {
      const spawned = collector.recordSubagentSpawned({
        taskId: "task-1",
        ownerId: "session-1",
        writeScope: "shared",
        background: false,
      });

      expect(spawned.type).toBe("subagent.spawned");

      const completed = collector.recordSubagentCompleted({
        taskId: "task-1",
        ownerId: "session-1",
        durationMs: 5000,
        success: true,
      });

      expect(completed.type).toBe("subagent.completed");
    });

    it("should record MCP events", () => {
      const connected = collector.recordMcpConnected({
        serverId: "mcp-1",
        serverName: "Test Server",
        transport: "stdio",
        durationMs: 200,
      });

      expect(connected.type).toBe("mcp.connected");

      const error = collector.recordMcpError({
        serverId: "mcp-1",
        serverName: "Test Server",
        error: "Connection refused",
        recoverable: true,
      });

      expect(error.type).toBe("mcp.error");
    });
  });

  describe("getEvents", () => {
    beforeEach(() => {
      collector.record("run.started", { runId: "run-1", sessionId: "s1" });
      collector.record("tool.called", { runId: "run-1", sessionId: "s1", toolCallId: "tc-1", toolName: "bash" });
      collector.record("run.completed", { runId: "run-1", sessionId: "s1", durationMs: 1000, toolCallCount: 1, success: true });
    });

    it("should get all events", () => {
      const events = collector.getEvents();
      expect(events.length).toBe(3);
    });

    it("should filter by type", () => {
      const events = collector.getEvents("run.started");
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("run.started");
    });

    it("should limit results", () => {
      const events = collector.getEvents(undefined, 2);
      expect(events.length).toBe(2);
    });
  });

  describe("getRunEvents", () => {
    beforeEach(() => {
      collector.record("run.started", { runId: "run-1", sessionId: "s1" });
      collector.record("tool.called", { runId: "run-1", sessionId: "s1", toolCallId: "tc-1", toolName: "bash" });
      collector.record("run.completed", { runId: "run-2", sessionId: "s1", durationMs: 1000, toolCallCount: 0, success: true });
    });

    it("should get events for specific run", () => {
      const events = collector.getRunEvents("run-1");
      expect(events.length).toBe(2);
    });
  });

  describe("metrics", () => {
    beforeEach(() => {
      collector.recordRunStarted({ runId: "run-1", sessionId: "s1", trigger: "user" });
    });

    it("should track run metrics", () => {
      const metrics = collector.getRunMetrics("run-1");

      expect(metrics).toBeDefined();
      expect(metrics!.runId).toBe("run-1");
      expect(metrics!.sessionId).toBe("s1");
      expect(metrics!.toolCallCount).toBe(0);
    });

    it("should update metrics on tool calls", () => {
      collector.recordToolCalled({
        runId: "run-1",
        sessionId: "s1",
        toolCallId: "tc-1",
        toolName: "bash",
      });

      const metrics = collector.getRunMetrics("run-1");
      expect(metrics!.toolCallCount).toBe(1);
    });

    it("should track tool approval/rejection", () => {
      collector.recordToolCalled({ runId: "run-1", sessionId: "s1", toolCallId: "tc-1", toolName: "bash" });
      collector.recordToolApproved({ runId: "run-1", sessionId: "s1", toolCallId: "tc-1", toolName: "bash", decision: "approved", decisionSource: "user" });
      collector.recordToolCalled({ runId: "run-1", sessionId: "s1", toolCallId: "tc-2", toolName: "edit" });
      collector.recordToolRejected({ runId: "run-1", sessionId: "s1", toolCallId: "tc-2", toolName: "edit", decision: "rejected", decisionSource: "rule" });

      const metrics = collector.getRunMetrics("run-1");
      expect(metrics!.toolApprovalCount).toBe(1);
      expect(metrics!.toolRejectionCount).toBe(1);
    });

    it("should get tool metrics", () => {
      collector.recordToolCalled({ runId: "run-1", sessionId: "s1", toolCallId: "tc-1", toolName: "bash" });
      collector.recordToolCalled({ runId: "run-1", sessionId: "s1", toolCallId: "tc-2", toolName: "bash" });

      const toolMetrics = collector.getToolMetrics("bash");
      expect(toolMetrics).toBeDefined();
      expect(toolMetrics!.callCount).toBe(2);
    });

    it("should get all run metrics", () => {
      collector.recordRunStarted({ runId: "run-2", sessionId: "s1", trigger: "retry" });

      const allMetrics = collector.getAllRunMetrics();
      expect(allMetrics.length).toBe(2);
    });
  });

  describe("clearOlderThan", () => {
    it("should clear old events", () => {
      collector.record("run.started", { runId: "run-1", sessionId: "s1" });

      const cleared = collector.clearOlderThan(0);
      expect(cleared).toBe(1);
      expect(collector.getEvents()).toHaveLength(0);
    });
  });

  describe("singleton", () => {
    it("should get global collector", () => {
      const collector1 = getTelemetryCollector();
      expect(collector1).toBeDefined();

      const collector2 = getTelemetryCollector();
      expect(collector1).toBe(collector2);
    });

    it("should set global collector", () => {
      const custom = new TelemetryCollector();
      setTelemetryCollector(custom);

      expect(getTelemetryCollector()).toBe(custom);
    });
  });
});
