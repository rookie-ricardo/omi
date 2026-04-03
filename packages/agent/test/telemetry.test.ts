/**
 * Telemetry Service Tests
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TelemetryService,
  type CompactionEvent,
  type McpConnectionEvent,
  type RunEvent,
  type SubAgentEvent,
} from "../src/telemetry";

describe("TelemetryService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits run lifecycle events and tracks counters", () => {
    const telemetry = new TelemetryService();
    const runEvents: RunEvent[] = [];
    const completedEvents: RunEvent[] = [];

    telemetry.on("run", (event) => {
      runEvents.push(event as RunEvent);
    });
    telemetry.on("run:completed", (event) => {
      completedEvents.push(event as RunEvent);
    });

    telemetry.emitRunEvent({
      type: "run:started",
      sessionId: "session-1",
      runId: "run-1",
      prompt: "Plan the next step",
      model: "claude-sonnet-4",
      provider: "anthropic",
      timestamp: new Date().toISOString(),
    });

    vi.advanceTimersByTime(250);

    telemetry.emitRunEvent({
      type: "run:completed",
      sessionId: "session-1",
      runId: "run-1",
      responseLength: 128,
      durationMs: 250,
      tokenUsage: {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        cacheReadTokens: 5,
      },
      timestamp: new Date().toISOString(),
    });

    telemetry.emitRunEvent({
      type: "run:failed",
      sessionId: "session-1",
      runId: "run-2",
      error: "provider timeout",
      errorCode: "ETIMEDOUT",
      durationMs: 900,
      timestamp: new Date().toISOString(),
    });

    telemetry.emitRunEvent({
      type: "run:cancelled",
      sessionId: "session-1",
      runId: "run-3",
      reason: "user cancelled",
      durationMs: 40,
      timestamp: new Date().toISOString(),
    });

    telemetry.emitRunEvent({
      type: "run:blocked",
      sessionId: "session-1",
      runId: "run-4",
      toolCallId: "tool-1",
      toolName: "bash",
      timestamp: new Date().toISOString(),
    });

    expect(runEvents.map((event) => event.type)).toEqual([
      "run:started",
      "run:completed",
      "run:failed",
      "run:cancelled",
      "run:blocked",
    ]);
    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0]).toMatchObject({
      type: "run:completed",
      sessionId: "session-1",
      runId: "run-1",
      responseLength: 128,
      durationMs: 250,
      tokenUsage: {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        cacheReadTokens: 5,
      },
      timestamp: "2024-01-01T00:00:00.250Z",
    });
    expect(telemetry.getCounter("run:run:started")).toBe(1);
    expect(telemetry.getCounter("run:run:completed")).toBe(1);
    expect(telemetry.getCounter("run:run:failed")).toBe(1);
    expect(telemetry.getCounter("run:run:cancelled")).toBe(1);
    expect(telemetry.getCounter("run:run:blocked")).toBe(1);
    expect(telemetry.getAllCounters()).toEqual({
      "run:run:started": 1,
      "run:run:completed": 1,
      "run:run:failed": 1,
      "run:run:cancelled": 1,
      "run:run:blocked": 1,
    });
  });

  it("emits compaction, subagent, and MCP observation events across success and failure paths", () => {
    const telemetry = new TelemetryService();
    const compactionEvents: CompactionEvent[] = [];
    const subagentEvents: SubAgentEvent[] = [];
    const mcpEvents: McpConnectionEvent[] = [];

    telemetry.on("compaction", (event) => {
      compactionEvents.push(event as CompactionEvent);
    });
    telemetry.on("subagent", (event) => {
      subagentEvents.push(event as SubAgentEvent);
    });
    telemetry.on("mcp", (event) => {
      mcpEvents.push(event as McpConnectionEvent);
    });

    telemetry.emitCompactionEvent({
      type: "compaction:requested",
      sessionId: "session-1",
      reason: "token budget exceeded",
      currentMessageCount: 40,
      currentTokenCount: 62000,
      timestamp: new Date().toISOString(),
    });
    vi.advanceTimersByTime(10);
    telemetry.emitCompactionEvent({
      type: "compaction:started",
      sessionId: "session-1",
      timestamp: new Date().toISOString(),
    });
    vi.advanceTimersByTime(20);
    telemetry.emitCompactionEvent({
      type: "compaction:completed",
      sessionId: "session-1",
      tokensFreed: 12000,
      messagesBefore: 40,
      messagesAfter: 18,
      durationMs: 20,
      timestamp: new Date().toISOString(),
    });
    telemetry.emitCompactionEvent({
      type: "compaction:failed",
      sessionId: "session-1",
      error: "summarizer unavailable",
      durationMs: 15,
      timestamp: new Date().toISOString(),
    });

    telemetry.emitSubAgentEvent({
      type: "subagent:spawned",
      sessionId: "session-1",
      subAgentId: "subagent-1",
      name: "research",
      isolated: true,
      timestamp: new Date().toISOString(),
    });
    telemetry.emitSubAgentEvent({
      type: "subagent:background",
      sessionId: "session-1",
      subAgentId: "subagent-1",
      timestamp: new Date().toISOString(),
    });
    telemetry.emitSubAgentEvent({
      type: "subagent:foreground",
      sessionId: "session-1",
      subAgentId: "subagent-1",
      timestamp: new Date().toISOString(),
    });
    telemetry.emitSubAgentEvent({
      type: "subagent:started",
      sessionId: "session-1",
      subAgentId: "subagent-1",
      timestamp: new Date().toISOString(),
    });
    vi.advanceTimersByTime(75);
    telemetry.emitSubAgentEvent({
      type: "subagent:completed",
      sessionId: "session-1",
      subAgentId: "subagent-1",
      durationMs: 75,
      resultLength: 512,
      timestamp: new Date().toISOString(),
    });
    telemetry.emitSubAgentEvent({
      type: "subagent:failed",
      sessionId: "session-1",
      subAgentId: "subagent-2",
      error: "subagent crashed",
      durationMs: 30,
      timestamp: new Date().toISOString(),
    });

    telemetry.emitMcpConnectionEvent({
      type: "mcp:connected",
      serverName: "filesystem",
      serverType: "stdio",
      transport: "stdio",
      latencyMs: 12,
      timestamp: new Date().toISOString(),
    });
    telemetry.emitMcpConnectionEvent({
      type: "mcp:disconnected",
      serverName: "filesystem",
      serverType: "stdio",
      reason: "server shutdown",
      timestamp: new Date().toISOString(),
    });
    telemetry.emitMcpConnectionEvent({
      type: "mcp:reconnecting",
      serverName: "filesystem",
      attemptNumber: 2,
      maxAttempts: 5,
      timestamp: new Date().toISOString(),
    });
    telemetry.emitMcpConnectionEvent({
      type: "mcp:auth_failed",
      serverName: "filesystem",
      authType: "oauth",
      error: "invalid token",
      timestamp: new Date().toISOString(),
    });
    telemetry.emitMcpConnectionEvent({
      type: "mcp:error",
      serverName: "filesystem",
      error: "transport closed",
      errorCode: "ECONNRESET",
      timestamp: new Date().toISOString(),
    });

    expect(compactionEvents.map((event) => event.type)).toEqual([
      "compaction:requested",
      "compaction:started",
      "compaction:completed",
      "compaction:failed",
    ]);
    expect(subagentEvents.map((event) => event.type)).toEqual([
      "subagent:spawned",
      "subagent:background",
      "subagent:foreground",
      "subagent:started",
      "subagent:completed",
      "subagent:failed",
    ]);
    expect(mcpEvents.map((event) => event.type)).toEqual([
      "mcp:connected",
      "mcp:disconnected",
      "mcp:reconnecting",
      "mcp:auth_failed",
      "mcp:error",
    ]);
    expect(telemetry.getAllCounters()).toMatchObject({
      "compaction:compaction:requested": 1,
      "compaction:compaction:started": 1,
      "compaction:compaction:completed": 1,
      "compaction:compaction:failed": 1,
      "subagent:subagent:spawned": 1,
      "subagent:subagent:background": 1,
      "subagent:subagent:foreground": 1,
      "subagent:subagent:started": 1,
      "subagent:subagent:completed": 1,
      "subagent:subagent:failed": 1,
      "mcp:mcp:connected": 1,
      "mcp:mcp:disconnected": 1,
      "mcp:mcp:reconnecting": 1,
      "mcp:mcp:auth_failed": 1,
      "mcp:mcp:error": 1,
    });
  });

  it("clears listeners and counters", () => {
    const telemetry = new TelemetryService();
    const runEvents: RunEvent[] = [];

    telemetry.on("run", (event) => {
      runEvents.push(event as RunEvent);
    });

    telemetry.emitRunEvent({
      type: "run:started",
      sessionId: "session-1",
      runId: "run-1",
      prompt: "Start",
      timestamp: new Date().toISOString(),
    });

    telemetry.clear();

    expect(telemetry.getAllCounters()).toEqual({});

    telemetry.emitRunEvent({
      type: "run:completed",
      sessionId: "session-1",
      runId: "run-1",
      responseLength: 20,
      durationMs: 10,
      timestamp: new Date().toISOString(),
    });

    expect(runEvents).toHaveLength(1);
    expect(runEvents[0]).toMatchObject({
      type: "run:started",
      sessionId: "session-1",
      runId: "run-1",
    });
    expect(telemetry.getAllCounters()).toEqual({
      "run:run:completed": 1,
    });
  });
});
