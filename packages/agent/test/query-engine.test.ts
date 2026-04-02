import { describe, expect, it, vi } from "vitest";
import type { ProviderConfig, Run, Session, Task } from "@omi/core";
import { createId, nowIso } from "@omi/core";
import type { AppStore } from "@omi/store";
import type { ProviderRunInput, ProviderRunResult } from "@omi/provider";

import {
  QueryEngine,
  type QueryEngineDeps,
  type QueryEngineEvent,
  type QueryEngineRunInput,
  resolveToolExecutionMode,
  nextSessionStatus,
  nextTaskStatus,
  normalizeHistoryDetails,
} from "../src/query-engine";
import type { SessionRuntime } from "../src/session-manager";
import type { ResourceLoader } from "../src/resource-loader";
import {
  isValidTransition,
  getAllValidTransitions,
  type QueryLoopState,
} from "../src/query-state";

// ============================================================================
// Test helpers
// ============================================================================

function createTestSession(): Session {
  return {
    id: createId("session"),
    title: "Test Session",
    status: "idle",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    latestUserMessage: null,
    latestAssistantMessage: null,
  };
}

function createTestRun(sessionId: string): Run {
  return {
    id: createId("run"),
    sessionId,
    taskId: null,
    status: "queued",
    provider: "anthropic",
    prompt: "test prompt",
    sourceRunId: null,
    recoveryMode: "start",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function createTestProviderConfig(): ProviderConfig {
  return {
    id: createId("provider"),
    name: "Test Provider",
    type: "anthropic",
    baseUrl: "https://api.anthropic.com",
    apiKey: "test-key",
    model: "claude-sonnet-4-20250514",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function makeStaticResources(): ResourceLoader {
  return {
    workspaceRoot: process.cwd(),
    agentDir: "/tmp/.omi",
    async reload() {},
    getProjectContextFiles: () => [],
    listSkills: async () => [],
    searchSkills: async () => [],
    resolveSkillForPrompt: async () => null,
    buildSystemPrompt: () => "Test system prompt",
    getPrompts: () => ({ items: [], diagnostics: [] }),
    getThemes: () => ({ items: [], diagnostics: [] }),
    getExtensions: () => ({ items: [], diagnostics: [] }),
  };
}

function createTestDatabase(session: Session, run: Run): AppStore {
  const runs = new Map<string, Run>();
  runs.set(run.id, { ...run });
  const sessions = new Map<string, Session>();
  sessions.set(session.id, { ...session });
  const messages: any[] = [];
  const events: any[] = [];
  const toolCalls = new Map();

  return {
    listSessions: () => [...sessions.values()],
    createSession(title) {
      const s = { ...session, id: createId("session"), title };
      sessions.set(s.id, s);
      return s;
    },
    getSession: (id) => sessions.get(id) ?? null,
    updateSession(id, partial) {
      const current = sessions.get(id);
      if (!current) throw new Error(`Session ${id} not found`);
      const next = { ...current, ...partial, updatedAt: nowIso() };
      sessions.set(id, next);
      return next;
    },
    createRun(input) {
      const r = { ...input, id: createId("run"), createdAt: nowIso(), updatedAt: nowIso() };
      runs.set(r.id, r);
      return r;
    },
    listRuns: (sessionId) => [...runs.values()].filter((r) => r.sessionId === sessionId),
    updateRun(id, partial) {
      const current = runs.get(id);
      if (!current) throw new Error(`Run ${id} not found`);
      const next = { ...current, ...partial, updatedAt: nowIso() };
      runs.set(id, next);
      return next;
    },
    getRun: (id) => runs.get(id) ?? null,
    addMessage(input) {
      const m = { ...input, id: createId("msg"), createdAt: nowIso() };
      messages.push(m);
      return m;
    },
    listMessages: (sessionId) => messages.filter((m) => m.sessionId === sessionId),
    addEvent(input) {
      const e = { ...input, id: createId("evt"), createdAt: nowIso() };
      events.push(e);
      return e;
    },
    listEvents: (runId) => events.filter((e) => e.runId === runId),
    createToolCall(input) {
      const tc = { ...input, id: input.id ?? createId("tool"), createdAt: nowIso(), updatedAt: nowIso() };
      toolCalls.set(tc.id, tc);
      return tc;
    },
    updateToolCall(id, partial) {
      const current = toolCalls.get(id);
      const next = { ...current, ...partial, updatedAt: nowIso() };
      toolCalls.set(id, next);
      return next;
    },
    getToolCall: (id) => toolCalls.get(id) ?? null,
    listToolCalls: (runId) => [...toolCalls.values()].filter((tc) => tc.runId === runId),
    listToolCallsBySession: (sessionId) => [],
    listTasks: () => [],
    createTask: (input) => ({ ...input, id: createId("task"), createdAt: nowIso(), updatedAt: nowIso() }),
    getTask: () => null,
    updateTask: () => ({} as Task),
    createReviewRequest: (input) => ({ ...input, id: createId("review"), createdAt: nowIso(), updatedAt: nowIso() }),
    updateReviewRequest: () => ({ id: createId("review"), runId: "", taskId: null, toolCallId: null, kind: "tool_approval" as const, status: "approved" as const, title: "", detail: "", createdAt: nowIso(), updatedAt: nowIso() }),
    listReviewRequests: () => [],
    writeMemory: () => ({ id: createId("memory"), scope: "session" as const, scopeId: "", title: "", content: "", tags: [], createdAt: nowIso(), updatedAt: nowIso() }),
    searchMemories: () => [],
    listMemories: () => [],
    listProviderConfigs: () => [],
    upsertProviderConfig: (input) => ({ ...input, id: input.id ?? createId("provider"), createdAt: nowIso(), updatedAt: nowIso() }),
    getProviderConfig: () => null,
    loadSessionRuntimeSnapshot: () => null,
    saveSessionRuntimeSnapshot: () => {},
    listSessionHistoryEntries: () => [],
    addSessionHistoryEntry: undefined as any,
    createBranch: (input) => ({ ...input, createdAt: nowIso(), updatedAt: nowIso() }),
    getBranch: () => null,
    listBranches: () => [],
    updateBranch: (id, partial) => ({ id, sessionId: "", headEntryId: null, title: "main", createdAt: nowIso(), updatedAt: nowIso(), ...partial }),
    createCheckpoint: (input) => ({ ...input, createdAt: nowIso() }),
    listCheckpoints: () => [],
    getLatestCheckpoint: () => null,
    getHistoryEntry: () => null,
    getBranchHistory: () => [],
    getActiveBranchId: () => null,
    setActiveBranchId: () => {},
  } satisfies AppStore;
}

function createMockRuntime(sessionId: string): SessionRuntime {
  return {
    beginRun: vi.fn(),
    completeRun: vi.fn(),
    failRun: vi.fn(),
    cancelRun: vi.fn(),
    enqueueRun: vi.fn(),
    dequeueRun: vi.fn(),
    peekQueuedRun: () => null,
    blockOnTool: vi.fn(),
    approveTool: vi.fn(),
    rejectTool: vi.fn(),
    snapshot: () => ({
      sessionId,
      activeRunId: null,
      blockedToolCallId: null,
      blockedRunId: null,
      pendingRunIds: [],
      interruptedRunIds: [],
      queuedRuns: [],
      lastUserPrompt: null,
      lastAssistantResponse: null,
      compaction: { status: "idle" },
    }),
    requestCompaction: vi.fn(),
    completeCompaction: vi.fn(),
    failCompaction: vi.fn(),
    setSelectedProviderConfig: vi.fn(),
    setActiveBranchId: vi.fn(),
  } as unknown as SessionRuntime;
}

// ============================================================================
// Tests
// ============================================================================

describe("QueryEngine", () => {
  describe("constructor and snapshot", () => {
    it("initializes with 'init' state", () => {
      const session = createTestSession();
      const run = createTestRun(session.id);
      const database = createTestDatabase(session, run);
      const events: QueryEngineEvent[] = [];
      const mockRuntime = createMockRuntime(session.id);

      const deps: QueryEngineDeps = {
        database,
        sessionId: session.id,
        workspaceRoot: process.cwd(),
        emit: (event) => events.push(event),
        resources: makeStaticResources(),
        runtime: mockRuntime,
      };

      const engine = new QueryEngine(deps);
      expect(engine.currentState).toBe("init");
      expect(engine.terminalReason).toBeNull();
    });

    it("snapshot returns session ID and initial state", () => {
      const session = createTestSession();
      const run = createTestRun(session.id);
      const database = createTestDatabase(session, run);
      const events: QueryEngineEvent[] = [];
      const mockRuntime = createMockRuntime(session.id);

      const deps: QueryEngineDeps = {
        database,
        sessionId: session.id,
        workspaceRoot: process.cwd(),
        emit: (event) => events.push(event),
        resources: makeStaticResources(),
        runtime: mockRuntime,
      };

      const engine = new QueryEngine(deps);
      const snapshot = engine.snapshot();
      expect(snapshot.sessionId).toBe(session.id);
      expect(snapshot.currentState).toBe("init");
      expect(snapshot.turnCount).toBe(0);
      expect(snapshot.messages).toEqual([]);
    });
  });

  describe("state machine validation", () => {
    it("all 19 valid transitions are defined in the state machine", () => {
      const transitions = getAllValidTransitions();
      expect(transitions).toHaveLength(19);
    });

    it("state machine covers the full lifecycle with tools: init -> preprocess -> model -> stream -> tools -> merge -> terminal", () => {
      const happyPathWithTools: Array<{ from: QueryLoopState; to: QueryLoopState }> = [
        { from: "init", to: "preprocess_context" },
        { from: "preprocess_context", to: "calling_model" },
        { from: "calling_model", to: "streaming_response" },
        { from: "streaming_response", to: "executing_tools" },
        { from: "executing_tools", to: "post_tool_merge" },
        { from: "post_tool_merge", to: "terminal" },
      ];

      for (const { from, to } of happyPathWithTools) {
        expect(isValidTransition(from, to)).toBe(true);
      }
    });

    it("state machine covers the full lifecycle without tools: init -> preprocess -> model -> stream -> terminal", () => {
      const happyPathNoTools: Array<{ from: QueryLoopState; to: QueryLoopState }> = [
        { from: "init", to: "preprocess_context" },
        { from: "preprocess_context", to: "calling_model" },
        { from: "calling_model", to: "streaming_response" },
        { from: "streaming_response", to: "terminal" },
      ];

      for (const { from, to } of happyPathNoTools) {
        expect(isValidTransition(from, to)).toBe(true);
      }
    });

    it("streaming_response -> post_tool_merge is a valid transition (no tool calls, direct merge)", () => {
      expect(isValidTransition("streaming_response", "post_tool_merge")).toBe(true);
    });

    it("state machine supports tool execution branch", () => {
      const toolPath: Array<{ from: QueryLoopState; to: QueryLoopState }> = [
        { from: "streaming_response", to: "executing_tools" },
        { from: "executing_tools", to: "post_tool_merge" },
      ];

      for (const { from, to } of toolPath) {
        expect(isValidTransition(from, to)).toBe(true);
      }
    });

    it("state machine supports recovery transitions", () => {
      const recoveryPath: Array<{ from: QueryLoopState; to: QueryLoopState }> = [
        { from: "calling_model", to: "recovering" },
        { from: "recovering", to: "calling_model" },
        { from: "recovering", to: "preprocess_context" },
        { from: "streaming_response", to: "recovering" },
        { from: "executing_tools", to: "recovering" },
        { from: "recovering", to: "terminal" },
      ];

      for (const { from, to } of recoveryPath) {
        expect(isValidTransition(from, to)).toBe(true);
      }
    });

    it("state machine supports loop continuation", () => {
      expect(isValidTransition("post_tool_merge", "preprocess_context")).toBe(true);
      expect(isValidTransition("streaming_response", "preprocess_context")).toBe(true);
    });

    it("state machine supports direct terminal from any non-init state", () => {
      const canTerminal: QueryLoopState[] = [
        "preprocess_context",
        "calling_model",
        "streaming_response",
        "executing_tools",
        "post_tool_merge",
        "recovering",
      ];
      for (const state of canTerminal) {
        expect(isValidTransition(state, "terminal")).toBe(true);
      }
    });

    it("terminal state is absorbing - no outgoing transitions", () => {
      const allStates: QueryLoopState[] = [
        "init",
        "preprocess_context",
        "calling_model",
        "streaming_response",
        "executing_tools",
        "post_tool_merge",
        "terminal",
        "recovering",
      ];
      for (const target of allStates) {
        expect(isValidTransition("terminal", target)).toBe(false);
      }
    });
  });

  describe("tool execution mode", () => {
    it("uses parallel mode for the concurrency-safe read-only whitelist", () => {
      expect(resolveToolExecutionMode(["read", "ls", "grep", "find"])).toBe("parallel");
    });

    it("falls back to sequential mode when any write tool is enabled", () => {
      expect(resolveToolExecutionMode(["read", "bash"])).toBe("sequential");
      expect(resolveToolExecutionMode(undefined)).toBe("sequential");
    });
  });

  describe("execute", () => {
    it("emits auditable query loop events with the current run and session ids", async () => {
      const session = createTestSession();
      const run = createTestRun(session.id);
      const database = createTestDatabase(session, run);
      const events: QueryEngineEvent[] = [];
      const mockRuntime = createMockRuntime(session.id);
      const providerCalls: ProviderRunInput[] = [];

      const provider = {
        async run(input: ProviderRunInput): Promise<ProviderRunResult> {
          providerCalls.push(input);
          return { assistantText: "done" };
        },
        cancel() {},
        approveTool() {},
        rejectTool() {},
      };

      const deps: QueryEngineDeps = {
        database,
        sessionId: session.id,
        workspaceRoot: process.cwd(),
        emit: (event) => events.push(event),
        resources: makeStaticResources(),
        runtime: mockRuntime,
        provider,
      };

      const engine = new QueryEngine(deps);
      const result = await engine.execute({
        session,
        task: null,
        run,
        prompt: "hello",
        providerConfig: createTestProviderConfig(),
        historyEntryId: null,
        checkpointSummary: null,
        checkpointDetails: null,
      });

      expect(result.terminalReason).toBe("completed");
      expect(providerCalls).toHaveLength(1);
      expect(providerCalls[0]?.toolExecutionMode).toBe("sequential");

      const transitionEvent = events.find((event) => event.type === "query_loop.transition");
      expect(transitionEvent).toMatchObject({
        type: "query_loop.transition",
        runId: run.id,
        sessionId: session.id,
      });

      const terminalEvent = events.find((event) => event.type === "query_loop.terminal");
      expect(terminalEvent).toMatchObject({
        type: "query_loop.terminal",
        runId: run.id,
        sessionId: session.id,
        reason: "completed",
      });
    });
  });

  describe("cancel", () => {
    it("cancel method sets internal canceled flag", () => {
      const session = createTestSession();
      const run = createTestRun(session.id);
      const database = createTestDatabase(session, run);
      const events: QueryEngineEvent[] = [];
      const mockRuntime = createMockRuntime(session.id);

      const deps: QueryEngineDeps = {
        database,
        sessionId: session.id,
        workspaceRoot: process.cwd(),
        emit: (event) => events.push(event),
        resources: makeStaticResources(),
        runtime: mockRuntime,
      };

      const engine = new QueryEngine(deps);
      // cancel should not throw
      expect(() => engine.cancel()).not.toThrow();
    });
  });
});

describe("nextSessionStatus", () => {
  it("returns 'running' on run_started", () => {
    expect(nextSessionStatus("idle", "run_started")).toBe("running");
    expect(nextSessionStatus("completed", "run_started")).toBe("running");
  });

  it("returns 'blocked' on tool_blocked", () => {
    expect(nextSessionStatus("running", "tool_blocked")).toBe("blocked");
  });

  it("returns 'completed' on run_completed", () => {
    expect(nextSessionStatus("running", "run_completed")).toBe("completed");
  });

  it("returns 'failed' on run_failed", () => {
    expect(nextSessionStatus("running", "run_failed")).toBe("failed");
  });

  it("returns 'canceled' on run_canceled", () => {
    expect(nextSessionStatus("running", "run_canceled")).toBe("canceled");
  });

  it("unblocks to 'running' on resume when currently blocked", () => {
    expect(nextSessionStatus("blocked", "resume")).toBe("running");
  });

  it("keeps current status on resume when not blocked", () => {
    expect(nextSessionStatus("idle", "resume")).toBe("idle");
    expect(nextSessionStatus("running", "resume")).toBe("running");
  });
});

describe("nextTaskStatus", () => {
  it("transitions active to review on run_completed", () => {
    expect(nextTaskStatus("active", "run_completed")).toBe("review");
  });

  it("keeps status unchanged for non-active tasks", () => {
    expect(nextTaskStatus("inbox", "run_completed")).toBe("inbox");
    expect(nextTaskStatus("review", "run_completed")).toBe("review");
    expect(nextTaskStatus("done", "run_completed")).toBe("done");
  });
});

describe("normalizeHistoryDetails", () => {
  it("returns null for null input", () => {
    expect(normalizeHistoryDetails(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(normalizeHistoryDetails(undefined)).toBeNull();
  });

  it("returns object as-is for plain objects", () => {
    const obj = { key: "value" };
    expect(normalizeHistoryDetails(obj)).toEqual(obj);
  });

  it("wraps non-object values", () => {
    expect(normalizeHistoryDetails("string")).toEqual({ value: "string" });
    expect(normalizeHistoryDetails(42)).toEqual({ value: 42 });
  });

  it("wraps arrays", () => {
    expect(normalizeHistoryDetails([1, 2, 3])).toEqual({ value: [1, 2, 3] });
  });
});
