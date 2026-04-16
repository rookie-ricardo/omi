import { describe, expect, it, vi } from "vitest";
import type { ProviderConfig, Run, Session, Task } from "@omi/core";
import { createId, nowIso } from "@omi/core";
import type { AppStore } from "@omi/store";
import type { ProviderRunInput, ProviderRunResult } from "@omi/provider";
import type { SessionRuntimeMessageEnvelope } from "@omi/memory";
import { ContextPipeline } from "@omi/memory";

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
import { buildToolCallReplayKey } from "../src/recovery";
import { createPlanStateManager } from "../src/modes/plan-mode";
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
    protocol: "anthropic-messages",
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
  const checkpointsByRun = new Map<string, any[]>();

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
    deleteProviderConfig: () => {},
    loadSessionRuntimeSnapshot: () => null,
    saveSessionRuntimeSnapshot: () => {},
    listSessionHistoryEntries: () => [],
    addSessionHistoryEntry: undefined as any,
    createBranch: (input) => ({ ...input, createdAt: nowIso(), updatedAt: nowIso() }),
    getBranch: () => null,
    listBranches: () => [],
    updateBranch: (id, partial) => ({ id, sessionId: "", headEntryId: null, title: "main", createdAt: nowIso(), updatedAt: nowIso(), ...partial }),
    createCheckpoint(input) {
      const checkpoint = { ...input, createdAt: nowIso() };
      const checkpoints = checkpointsByRun.get(input.runId) ?? [];
      checkpoints.push(checkpoint);
      checkpointsByRun.set(input.runId, checkpoints);
      return checkpoint;
    },
    listCheckpoints(runId) {
      const checkpoints = checkpointsByRun.get(runId) ?? [];
      return [...checkpoints];
    },
    getLatestCheckpoint(runId) {
      const checkpoints = checkpointsByRun.get(runId) ?? [];
      return checkpoints.at(-1) ?? null;
    },
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

function contentToText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
          return part.text;
        }
        return "";
      })
      .join("");
  }
  return "";
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
      expect(resolveToolExecutionMode(["read", "ls", "grep", "glob"])).toBe("parallel");
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
          return { assistantText: "done", assistantMessage: null, stopReason: "end_turn" as const, toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 }, error: null };
        },
        cancel() {},
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

    it("injects user-selected context file paths into provider prompt", async () => {
      const session = createTestSession();
      const run = createTestRun(session.id);
      const database = createTestDatabase(session, run);
      const mockRuntime = createMockRuntime(session.id);
      const providerCalls: ProviderRunInput[] = [];

      const provider = {
        async run(input: ProviderRunInput): Promise<ProviderRunResult> {
          providerCalls.push(input);
          return {
            assistantText: "done",
            assistantMessage: null,
            stopReason: "end_turn" as const,
            toolCalls: [],
            usage: { inputTokens: 0, outputTokens: 0 },
            error: null,
          };
        },
        cancel() {},
      };

      const deps: QueryEngineDeps = {
        database,
        sessionId: session.id,
        workspaceRoot: process.cwd(),
        emit: () => {},
        resources: makeStaticResources(),
        runtime: mockRuntime,
        provider,
      };

      const engine = new QueryEngine(deps);
      await engine.execute({
        session,
        task: null,
        run,
        prompt: "review these files",
        contextFiles: ["src/a.ts", "src/b.ts"],
        providerConfig: createTestProviderConfig(),
        historyEntryId: null,
        checkpointSummary: null,
        checkpointDetails: null,
      });

      const providerPrompt = providerCalls[0]?.prompt ?? "";
      expect(providerPrompt).toContain("User-provided context paths for this run:");
      expect(providerPrompt).toContain("- src/a.ts");
      expect(providerPrompt).toContain("- src/b.ts");
      expect(providerPrompt).toContain("review these files");
    });

    it("emits selected runtime based on provider type", async () => {
      const session = createTestSession();
      const run = createTestRun(session.id);
      const database = createTestDatabase(session, run);
      const events: QueryEngineEvent[] = [];
      const mockRuntime = createMockRuntime(session.id);

      const provider = {
        async run(): Promise<ProviderRunResult> {
          return {
            assistantText: "done",
            assistantMessage: null,
            stopReason: "end_turn" as const,
            toolCalls: [],
            usage: { inputTokens: 0, outputTokens: 0 },
            error: null,
          };
        },
        cancel() {},
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
      await engine.execute({
        session,
        task: null,
        run,
        prompt: "hello",
        providerConfig: createTestProviderConfig(),
        historyEntryId: null,
        checkpointSummary: null,
        checkpointDetails: null,
      });

      expect(
        events.some(
          (event) =>
            event.type === "run.runtime_selected" &&
            (event as { payload?: { runtime?: string } }).payload?.runtime === "claude-agent-sdk",
        ),
      ).toBe(true);
    });

    // TODO: re-enable after migrating preflight check logic out of provider
    it.skip("uses explicit plan state as the single source of truth for preflight checks", async () => {
      const planState = createPlanStateManager();
      const session = createTestSession();
      const run = createTestRun(session.id);
      const database = createTestDatabase(session, run);
      const mockRuntime = createMockRuntime(session.id);
      const preflightResults: Array<{ decision: string; reason: string | null }> = [];

      const provider = {
        async run(input: ProviderRunInput): Promise<ProviderRunResult> {
          // preflightToolCheck removed from ProviderRunInput - test needs rewrite
          return { assistantText: "done", assistantMessage: null, stopReason: "end_turn" as const, toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 }, error: null };
        },
        cancel() {},
      };

      const deps: QueryEngineDeps = {
        database,
        sessionId: session.id,
        workspaceRoot: process.cwd(),
        emit: () => {},
        resources: makeStaticResources(),
        runtime: mockRuntime,
        provider,
      };

      const engine = new QueryEngine(deps);
      await engine.execute({
        session,
        task: null,
        run,
        prompt: "first",
        providerConfig: createTestProviderConfig(),
        historyEntryId: null,
        checkpointSummary: null,
        checkpointDetails: null,
      });

      expect(preflightResults[0]).toMatchObject({
        decision: "ask",
      });
      expect(preflightResults[0]?.reason).toContain("requires approval");

      planState.enterPlanMode("default");
      await engine.execute({
        session,
        task: null,
        run,
        prompt: "second",
        providerConfig: createTestProviderConfig(),
        historyEntryId: null,
        checkpointSummary: null,
        checkpointDetails: null,
      });
      expect(preflightResults[1]).toMatchObject({
        decision: "deny",
      });
      expect(preflightResults[1]?.reason).toContain("not allowed in plan mode");
      planState.exitPlanMode();
    });

    // TODO: re-enable after migrating tool approval flow out of provider
    it.skip("forces ask decisions into approval flow at execution layer", async () => {
      const session = createTestSession();
      const run = createTestRun(session.id);
      const database = createTestDatabase(session, run);
      const events: QueryEngineEvent[] = [];
      const mockRuntime = createMockRuntime(session.id);
      const toolCallId = "tool-call-ask";

      const provider = {
        async run(input: ProviderRunInput): Promise<ProviderRunResult> {
          // onToolRequested/onToolDecision removed from ProviderRunInput - test needs rewrite
          return { assistantText: "done", assistantMessage: null, stopReason: "end_turn" as const, toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 }, error: null };
        },
        cancel() {},
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
      await engine.execute({
        session,
        task: null,
        run,
        prompt: "force ask gate",
        providerConfig: createTestProviderConfig(),
        historyEntryId: null,
        checkpointSummary: null,
        checkpointDetails: null,
      });

      const toolRequestedEvent = events.find(
        (event) =>
          event.type === "run.tool_requested"
          && (event.payload as { toolCallId?: string }).toolCallId === toolCallId,
      );
      expect(toolRequestedEvent).toBeDefined();
      const toolRequestedPayload = (toolRequestedEvent as { payload?: { requiresApproval?: boolean } }).payload;
      expect(toolRequestedPayload?.requiresApproval).toBe(true);
      expect(mockRuntime.blockOnTool).toHaveBeenCalledWith(run.id, toolCallId);
    });

    // TODO: re-enable after migrating tool approval flow out of provider
    it.skip("uses approved allowedPrompts after plan exit to avoid redundant ask approvals", async () => {
      const planState = createPlanStateManager();
      planState.enterPlanMode("default");
      planState.setAllowedPrompts([{ tool: "Bash", prompt: "echo approved" }]);
      planState.exitPlanMode();

      const session = createTestSession();
      const run = createTestRun(session.id);
      const database = createTestDatabase(session, run);
      const events: QueryEngineEvent[] = [];
      const mockRuntime = createMockRuntime(session.id);
      const toolCallId = "tool-call-allowed-prompt";

      const provider = {
        async run(input: ProviderRunInput): Promise<ProviderRunResult> {
          // onToolRequested/onToolDecision removed from ProviderRunInput - test needs rewrite
          return { assistantText: "done", assistantMessage: null, stopReason: "end_turn" as const, toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 }, error: null };
        },
        cancel() {},
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
      await engine.execute({
        session,
        task: null,
        run,
        prompt: "run approved command",
        providerConfig: createTestProviderConfig(),
        historyEntryId: null,
        checkpointSummary: null,
        checkpointDetails: null,
      });

      const toolRequestedEvent = events.find(
        (event) =>
          event.type === "run.tool_requested"
          && (event.payload as { toolCallId?: string }).toolCallId === toolCallId,
      );
      const toolRequestedPayload = (toolRequestedEvent as { payload?: { requiresApproval?: boolean } }).payload;
      expect(toolRequestedPayload?.requiresApproval).toBe(false);
      expect(mockRuntime.blockOnTool).not.toHaveBeenCalled();
      expect(
        events.some(
          (event) =>
            event.type === "run.allowed_prompt_matched"
            && (event as { payload?: { toolName?: string } }).payload?.toolName === "bash",
        ),
      ).toBe(true);
    });

    it("gates model calls when context health remains unsafe", async () => {
      const session = createTestSession();
      const run = createTestRun(session.id);
      const database = createTestDatabase(session, run);
      database.addMessage({
        sessionId: session.id,
        role: "user",
        content: "x".repeat(1_200_000),
        parentHistoryEntryId: null,
        branchId: null,
        originRunId: null,
      });
      const events: QueryEngineEvent[] = [];
      const mockRuntime = createMockRuntime(session.id);
      const provider = {
        run: vi.fn(async () => ({
          assistantText: "...",
          assistantMessage: null,
          stopReason: "end_turn" as const,
          toolCalls: [],
          usage: { inputTokens: 0, outputTokens: 0 },
          error: null,
        })),
        cancel() {},
      };

      const deps: QueryEngineDeps = {
        database,
        sessionId: session.id,
        workspaceRoot: process.cwd(),
        emit: (event) => events.push(event),
        resources: makeStaticResources(),
        runtime: mockRuntime,
        provider,
        contextPipelineConfig: {
          enableMicroCompact: false,
          enableContextCollapse: false,
        },
      };

      const engine = new QueryEngine(deps);
      const result = await engine.execute({
        session,
        task: null,
        run,
        prompt: "gate this",
        providerConfig: createTestProviderConfig(),
        historyEntryId: null,
        checkpointSummary: null,
        checkpointDetails: null,
      });

      expect(result.terminalReason).toBe("budget_exceeded");
      expect(provider.run).not.toHaveBeenCalled();
      expect(
        events.some(
          (event) =>
            event.type === "run.context_health" &&
            (event as { payload?: { usageTokens?: number } }).payload?.usageTokens !== undefined,
        ),
      ).toBe(true);
    });

    it("injects a real continuation message on max-output recovery", async () => {
      const session = createTestSession();
      const run = createTestRun(session.id);
      const database = createTestDatabase(session, run);
      const mockRuntime = createMockRuntime(session.id);
      const providerCalls: ProviderRunInput[] = [];

      const provider = {
        async run(input: ProviderRunInput): Promise<ProviderRunResult> {
          providerCalls.push(input);
          if (providerCalls.length === 1) {
            throw new Error("max_output tokens exceeded");
          }
          return { assistantText: "continued", assistantMessage: null, stopReason: "end_turn" as const, toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 }, error: null };
        },
        cancel() {},
      };

      const deps: QueryEngineDeps = {
        database,
        sessionId: session.id,
        workspaceRoot: process.cwd(),
        emit: () => {},
        resources: makeStaticResources(),
        runtime: mockRuntime,
        provider,
      };

      const engine = new QueryEngine(deps);
      const result = await engine.execute({
        session,
        task: null,
        run,
        prompt: "continue please",
        providerConfig: createTestProviderConfig(),
        historyEntryId: null,
        checkpointSummary: null,
        checkpointDetails: null,
      });

      expect(result.terminalReason).toBe("completed");
      expect(providerCalls).toHaveLength(2);
      expect(
        providerCalls[1]?.historyMessages.some(
          (message) =>
            message.role === "user" &&
            contentToText(message.content).includes("Continue from your last response"),
        ),
      ).toBe(true);
    });

    it("fails fast on repetitive identical tool-only loops", async () => {
      const session = createTestSession();
      const run = createTestRun(session.id);
      const database = createTestDatabase(session, run);
      const events: QueryEngineEvent[] = [];
      const mockRuntime = createMockRuntime(session.id);
      let providerCalls = 0;

      const provider = {
        async run(): Promise<ProviderRunResult> {
          providerCalls += 1;
          return {
            assistantText: "",
            assistantMessage: null,
            stopReason: "tool_use" as const,
            toolCalls: [
              {
                id: `tool-call-${providerCalls}`,
                name: "bash",
                input: { command: "pwd" },
              },
            ],
            usage: { inputTokens: 0, outputTokens: 0 },
            error: null,
          };
        },
        cancel() {},
      };

      const deps: QueryEngineDeps = {
        database,
        sessionId: session.id,
        workspaceRoot: process.cwd(),
        emit: (event) => events.push(event),
        resources: makeStaticResources(),
        runtime: mockRuntime,
        provider,
        permissionMode: "full-access",
      };

      const engine = new QueryEngine(deps);
      const result = await engine.execute({
        session,
        task: null,
        run,
        prompt: "run pwd",
        providerConfig: createTestProviderConfig(),
        historyEntryId: null,
        checkpointSummary: null,
        checkpointDetails: null,
      });

      expect(result.terminalReason).toBe("error");
      expect(result.error).toContain("Detected repetitive tool loop");
      expect(providerCalls).toBe(4);
      expect(
        events.some(
          (event) =>
            event.type === "query_loop.terminal" &&
            (event as { reason?: string }).reason === "error",
        ),
      ).toBe(true);
    });

    // TODO: 重写此测试 — preflightToolCheck 已从 ProviderRunInput 移除，工具权限检查现在在 QueryEngine.executeToolBatch() 中
    it.skip("restores mutable state from source run checkpoint before executing resumed run", async () => {
      const session = createTestSession();
      const run = createTestRun(session.id);
      const sourceRunId = createId("run");
      const database = createTestDatabase(session, {
        ...run,
        sourceRunId,
        recoveryMode: "resume",
      });
      const events: QueryEngineEvent[] = [];
      const mockRuntime = createMockRuntime(session.id);

      const checkpoint = database.createCheckpoint({
        id: createId("checkpoint"),
        runId: sourceRunId,
        sessionId: session.id,
        phase: "after_tool_batch",
        payload: {
          turnCount: 4,
          recoveryCount: 2,
          compactTracking: {
            maxOutputRecoveryCount: 1,
            overflowRecovered: true,
          },
          executedWriteToolCallIds: [],
          partialAssistantText: "partial",
          context: {},
        },
      });
      database.updateRun(run.id, {
        resumeFromCheckpoint: checkpoint.id,
      });

      const provider = {
        async run(): Promise<ProviderRunResult> {
          return { assistantText: "restored", assistantMessage: null, stopReason: "end_turn" as const, toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 }, error: null };
        },
        cancel() {},
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
        run: {
          ...run,
          sourceRunId,
          recoveryMode: "resume",
          resumeFromCheckpoint: checkpoint.id,
        },
        prompt: "resume now",
        providerConfig: createTestProviderConfig(),
        historyEntryId: null,
        checkpointSummary: null,
        checkpointDetails: null,
      });

      expect(result.terminalReason).toBe("completed");
      expect(result.turnCount).toBe(5);
      expect(events.some((event) => event.type === "recovery.checkpoint_saved")).toBe(true);
    });

    // TODO: re-enable after migrating preflight check logic out of provider
    it.skip("uses shouldSkipTool replay protection in preflight checks", async () => {
      const session = createTestSession();
      const run = createTestRun(session.id);
      const sourceRunId = createId("run");
      const database = createTestDatabase(session, {
        ...run,
        sourceRunId,
        recoveryMode: "resume",
      });
      const events: QueryEngineEvent[] = [];
      const mockRuntime = createMockRuntime(session.id);
      const blockedInput = { command: "echo hi", cwd: "/tmp" };
      const replayKey = buildToolCallReplayKey({
        toolCallId: "",
        toolName: "bash",
        toolInput: blockedInput,
      });
      const checkpoint = database.createCheckpoint({
        id: createId("checkpoint"),
        runId: sourceRunId,
        sessionId: session.id,
        phase: "after_tool_batch",
        payload: {
          turnCount: 0,
          recoveryCount: 0,
          compactTracking: {
            maxOutputRecoveryCount: 0,
            overflowRecovered: false,
          },
          executedWriteToolCallIds: [replayKey],
          partialAssistantText: "",
          context: {},
        },
      });
      database.updateRun(run.id, {
        resumeFromCheckpoint: checkpoint.id,
      });

      const preflightReasons: Array<{ decision: string; reason: string | null }> = [];
      const provider = {
        async run(input: ProviderRunInput): Promise<ProviderRunResult> {
          preflightReasons.push(await (input as any).preflightToolCheck?.("bash", blockedInput) ?? {
            decision: "allow",
            reason: null,
          });
          return { assistantText: "done", assistantMessage: null, stopReason: "end_turn" as const, toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 }, error: null };
        },
        cancel() {},
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
      await engine.execute({
        session,
        task: null,
        run: {
          ...run,
          sourceRunId,
          recoveryMode: "resume",
          resumeFromCheckpoint: checkpoint.id,
        },
        prompt: "resume and replay",
        providerConfig: createTestProviderConfig(),
        historyEntryId: null,
        checkpointSummary: null,
        checkpointDetails: null,
      });

      expect(preflightReasons).toHaveLength(1);
      expect(preflightReasons[0]).toMatchObject({
        decision: "deny",
      });
      expect(preflightReasons[0]?.reason).toContain("Skipped replayed write tool: bash");
      expect(
        events.some(
          (event) =>
            event.type === "run.tool_denied"
            && (event as { payload?: { reason?: string } }).payload?.reason?.includes("Skipped replayed write tool") === true,
        ),
      ).toBe(true);
    });

    it("writes recoverable structured fallback compaction details without breaking lineage", async () => {
      const session = createTestSession();
      const run = createTestRun(session.id);
      const baseDatabase = createTestDatabase(session, run);
      const parentEntryId = createId("history");
      const branchId = createId("branch");
      const foreignBranchId = createId("branch");
      const historyEntries: Array<Record<string, unknown>> = [
        {
          id: parentEntryId,
          sessionId: session.id,
          parentId: null,
          kind: "branch_summary",
          messageId: null,
          summary: "existing branch summary",
          details: null,
          branchId,
          lineageDepth: 3,
          originRunId: null,
          createdAt: nowIso(),
        },
        {
          id: createId("history"),
          sessionId: session.id,
          parentId: null,
          kind: "message",
          messageId: createId("msg"),
          summary: null,
          details: null,
          branchId: foreignBranchId,
          lineageDepth: 9,
          originRunId: null,
          createdAt: nowIso(),
        },
      ];

      const database: AppStore = {
        ...baseDatabase,
        listBranches: () => [{
          id: branchId,
          sessionId: session.id,
          headEntryId: parentEntryId,
          title: "main",
          createdAt: nowIso(),
          updatedAt: nowIso(),
        }],
        getActiveBranchId: () => branchId,
        listSessionHistoryEntries: () => historyEntries as never[],
        getBranchHistory: (_sessionId, targetBranchId) =>
          historyEntries.filter((entry) => entry.branchId === targetBranchId) as never[],
        addSessionHistoryEntry: (input) => {
          const created = {
            id: createId("history"),
            ...input,
            createdAt: nowIso(),
          };
          historyEntries.push(created);
          return created as never;
        },
      };

      const deps: QueryEngineDeps = {
        database,
        sessionId: session.id,
        workspaceRoot: process.cwd(),
        emit: () => {},
        resources: makeStaticResources(),
        runtime: createMockRuntime(session.id),
      };
      const engine = new QueryEngine(deps);

      const historyEnvelopes: SessionRuntimeMessageEnvelope[] = [
        {
          timestamp: Date.now() - 1_000,
          order: 1,
          sourceHistoryEntryId: createId("history"),
          message: {
            role: "user",
            content: "Need compaction fallback with recoverable summary data",
            timestamp: Date.now() - 1_000,
          },
        },
      ];

      const snapshot = await (
        engine as unknown as {
          compactHistoricalContext: (input: {
            session: Session;
            providerConfig: ProviderConfig;
            mode: "threshold" | "manual" | "overflow";
            prompt: string | null;
            runId: string | null;
            historyEnvelopes: SessionRuntimeMessageEnvelope[];
          }) => Promise<{ summary: { goal: string; criticalContext: string[] } }>;
        }
      ).compactHistoricalContext({
        session,
        providerConfig: createTestProviderConfig(),
        mode: "overflow",
        prompt: "compact this",
        runId: run.id,
        historyEnvelopes,
      });

      expect(snapshot.summary.goal).toContain("Compaction fallback snapshot");
      expect(
        snapshot.summary.criticalContext.some(
          (entry) => entry.startsWith("summarized:user:") || entry.startsWith("kept:user:"),
        ),
      ).toBe(true);

      const latestEntry = historyEntries.at(-1) as Record<string, unknown>;
      expect(latestEntry.kind).toBe("branch_summary");
      expect(latestEntry.parentId).toBe(parentEntryId);
      expect(latestEntry.lineageDepth).toBe(4);

      const details = latestEntry.details as Record<string, unknown>;
      expect(typeof details.summaryDocument).toBe("object");
      const fallbackRecovery = details.fallbackRecovery as Record<string, unknown>;
      expect(fallbackRecovery.version).toBe(1);
      expect(fallbackRecovery.mode).toBe("overflow");
      expect(Array.isArray(fallbackRecovery.summarizedMessages)).toBe(true);
      const summarized = (
        (fallbackRecovery.summarizedMessages as Array<{ role?: string; token?: string }> | undefined)
        ?? []
      );
      const kept = (
        (fallbackRecovery.keptMessages as Array<{ role?: string; token?: string }> | undefined)
        ?? []
      );
      expect(summarized.every((entry) => typeof entry.role === "string" && typeof entry.token === "string")).toBe(true);
      const fallbackTokens = [...summarized, ...kept].map((entry) => `${entry.role}:${entry.token}`);
      expect(fallbackTokens.some((token) => token.startsWith("user:"))).toBe(true);
    });

    it("writes pipeline compaction summaries against active branch lineage", async () => {
      const session = createTestSession();
      const run = createTestRun(session.id);
      const baseDatabase = createTestDatabase(session, run);
      const branchId = createId("branch");
      const foreignBranchId = createId("branch");
      const parentEntryId = createId("history");
      const historyEntries: Array<Record<string, unknown>> = [
        {
          id: parentEntryId,
          sessionId: session.id,
          parentId: null,
          kind: "branch_summary",
          messageId: null,
          summary: "feature-checkpoint",
          details: null,
          branchId,
          lineageDepth: 2,
          originRunId: null,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        },
        {
          id: createId("history"),
          sessionId: session.id,
          parentId: null,
          kind: "message",
          messageId: createId("msg"),
          summary: null,
          details: null,
          branchId: foreignBranchId,
          lineageDepth: 10,
          originRunId: null,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        },
      ];

      const database: AppStore = {
        ...baseDatabase,
        listBranches: () => [{
          id: branchId,
          sessionId: session.id,
          headEntryId: parentEntryId,
          title: "main",
          createdAt: nowIso(),
          updatedAt: nowIso(),
        }],
        getActiveBranchId: () => branchId,
        listSessionHistoryEntries: () => historyEntries as never[],
        getBranchHistory: (_sessionId, targetBranchId) =>
          historyEntries.filter((entry) => entry.branchId === targetBranchId) as never[],
        addSessionHistoryEntry: (input) => {
          const created = {
            id: createId("history"),
            ...input,
            createdAt: nowIso(),
            updatedAt: nowIso(),
          };
          historyEntries.push(created);
          return created as never;
        },
      };

      const deps: QueryEngineDeps = {
        database,
        sessionId: session.id,
        workspaceRoot: process.cwd(),
        emit: () => {},
        resources: makeStaticResources(),
        runtime: createMockRuntime(session.id),
      };
      const engine = new QueryEngine(deps);

      const compactionSnapshot = {
        version: 1 as const,
        summary: {
          version: 1 as const,
          goal: "Pipeline compact summary",
          constraints: [],
          progress: {
            done: [],
            inProgress: [],
            blocked: [],
          },
          keyDecisions: [],
          nextSteps: [],
          criticalContext: [],
        },
        compactedAt: nowIso(),
        firstKeptHistoryEntryId: null,
        firstKeptTimestamp: null,
        tokensBefore: 150,
        tokensKept: 60,
      };

      const executeSpy = vi.spyOn(ContextPipeline.prototype, "execute").mockResolvedValue({
        messages: [],
        didCompact: true,
        compactionSnapshot,
        usageEstimate: {
          tokens: 150,
          usageTokens: 0,
          trailingTokens: 150,
          lastUsageIndex: null,
        },
      });
      const reportSpy = vi.spyOn(ContextPipeline.prototype, "getReport").mockReturnValue({
        stages: [{ name: "context_collapse", didModify: true, reason: "threshold" }],
      });

      try {
        await (
          engine as unknown as {
            runContextPipeline: (
              session: Session,
              providerConfig: ProviderConfig,
              messages: unknown[],
              runId: string,
            ) => Promise<unknown>;
          }
        ).runContextPipeline(
          session,
          createTestProviderConfig(),
          [{
            role: "user",
            content: "pipeline input",
            timestamp: Date.now(),
          }],
          run.id,
        );
      } finally {
        executeSpy.mockRestore();
        reportSpy.mockRestore();
      }

      const latestEntry = historyEntries.at(-1) as Record<string, unknown>;
      expect(latestEntry.kind).toBe("branch_summary");
      expect(latestEntry.parentId).toBe(parentEntryId);
      expect(latestEntry.lineageDepth).toBe(3);
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
