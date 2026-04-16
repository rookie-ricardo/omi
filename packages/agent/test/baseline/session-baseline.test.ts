/**
 * Session 基线回归测试
 *
 * 覆盖 P0 能力：
 * - 会话创建与生命周期（idle -> running -> completed）
 * - Run 队列串行执行
 * - 会话消息持久化
 * - 从历史节点分支继续
 * - 会话运行时快照持久化与恢复
 */

import { describe, it, expect } from "vitest";
import type { ProviderRunInput, ProviderRunResult } from "@omi/provider";
import type { RunnerEventEnvelope, ResourceLoader } from "../../src/index";
import { AgentSession, SessionManager, SessionRuntime } from "../../src/index";
import type { AppStore } from "@omi/store";
import type {
  EventRecord,
  MemoryRecord,
  ProviderConfig,
  ReviewRequest,
  Run,
  RunCheckpoint,
  Session,
  SessionBranch,
  SessionHistoryEntry,
  SessionMessage,
  Task,
  ToolCall,
} from "@omi/core";
import { createId, nowIso } from "@omi/core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function waitFor(predicate: () => boolean, timeoutMs = 2500): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const interval = 10;
    (function check() {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error("Condition not met in time"));
      setTimeout(check, interval);
    })();
  });
}

function makeProviderConfig(overrides?: Partial<ProviderConfig>): ProviderConfig {
  const now = nowIso();
  const type = overrides?.type ?? "anthropic";
  return {
    id: overrides?.id ?? createId("provider"),
    name: overrides?.name ?? "Test Provider",
    type,
    protocol: overrides?.protocol ?? (type === "anthropic" ? "anthropic-messages" : "openai-chat"),
    baseUrl: overrides?.baseUrl ?? "https://api.anthropic.com",
    apiKey: overrides?.apiKey ?? "test-key",
    model: overrides?.model ?? "claude-sonnet-4-20250514",
    createdAt: overrides?.createdAt ?? now,
    updatedAt: overrides?.updatedAt ?? now,
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
    buildSystemPrompt: () => "",
    getPrompts: () => ({ items: [], diagnostics: [] }),
    getThemes: () => ({ items: [], diagnostics: [] }),
    getExtensions: () => ({ items: [], diagnostics: [] }),
  };
}

function makeProvider(calls: ProviderRunInput[]) {
  return {
    async run(input: ProviderRunInput): Promise<ProviderRunResult> {
      calls.push(input);
      return { assistantText: `done-${calls.length}`, assistantMessage: null, stopReason: "end_turn" as const, usage: { inputTokens: 0, outputTokens: 0 }, error: null };
    },
    cancel() {},
    approveTool() {},
    rejectTool() {},
  };
}

function createMemoryDatabase(): AppStore {
  const sessions = new Map<string, Session>();
  const tasks = new Map<string, Task>();
  const runs = new Map<string, Run>();
  const messages: SessionMessage[] = [];
  const events: EventRecord[] = [];
  const toolCalls = new Map<string, ToolCall>();
  const reviews = new Map<string, ReviewRequest>();
  const memories = new Map<string, MemoryRecord>();
  const providerConfigs = new Map<string, ProviderConfig>();
  const historyEntries: SessionHistoryEntry[] = [];
  const runtimeRows = new Map<string, { sessionId: string; snapshot: string; updatedAt: string }>();

  return {
    listSessions: () => [...sessions.values()],
    createSession(title) {
      const now = nowIso();
      const session: Session = {
        id: createId("session"), title, status: "idle",
        createdAt: now, updatedAt: now,
        latestUserMessage: null, latestAssistantMessage: null,
      };
      sessions.set(session.id, session);
      return session;
    },
    getSession: (id) => sessions.get(id) ?? null,
    updateSession(id, partial) {
      const cur = sessions.get(id);
      if (!cur) throw new Error(`Session ${id} not found`);
      const next = { ...cur, ...partial, updatedAt: nowIso() };
      sessions.set(id, next);
      return next;
    },
    listTasks: () => [...tasks.values()],
    createTask(input) {
      const now = nowIso();
      const task: Task = { id: createId("task"), createdAt: now, updatedAt: now, ...input };
      tasks.set(task.id, task);
      return task;
    },
    getTask: (id) => tasks.get(id) ?? null,
    updateTask(id, partial) {
      const cur = tasks.get(id);
      if (!cur) throw new Error(`Task ${id} not found`);
      const next = { ...cur, ...partial, updatedAt: nowIso() };
      tasks.set(id, next);
      return next;
    },
    createRun(input) {
      const now = nowIso();
      const run: Run = { id: createId("run"), createdAt: now, updatedAt: now, ...input };
      runs.set(run.id, run);
      return run;
    },
    listRuns: (sessionId) => [...runs.values()].filter((r) => !sessionId || r.sessionId === sessionId),
    updateRun(id, partial) {
      const cur = runs.get(id);
      if (!cur) throw new Error(`Run ${id} not found`);
      const next = { ...cur, ...partial, updatedAt: nowIso() };
      runs.set(id, next);
      return next;
    },
    getRun: (id) => runs.get(id) ?? null,
    addMessage(input) {
      const { parentHistoryEntryId, ...msgInput } = input as typeof input & { parentHistoryEntryId?: string | null };
      const msg: SessionMessage = { id: createId("msg"), createdAt: nowIso(), ...msgInput };
      messages.push(msg);
      const parentId = parentHistoryEntryId ?? historyEntries.filter((e) => e.sessionId === msg.sessionId).at(-1)?.id ?? null;
      historyEntries.push({
        id: createId("hist"), sessionId: msg.sessionId, parentId,
        kind: "message", messageId: msg.id, summary: null, details: null,
        branchId: null, lineageDepth: 0, originRunId: null,
        createdAt: msg.createdAt, updatedAt: msg.createdAt,
      });
      return msg;
    },
    listMessages: (sid) => messages.filter((m) => m.sessionId === sid),
    addSessionHistoryEntry(input) {
      const now = nowIso();
      const entry: SessionHistoryEntry = {
        id: input.id ?? createId("hist"),
        sessionId: input.sessionId,
        parentId: input.parentId,
        kind: input.kind,
        messageId: input.messageId ?? null,
        summary: input.summary ?? null,
        details: input.details ?? null,
        branchId: input.branchId ?? null,
        lineageDepth: input.lineageDepth ?? 0,
        originRunId: input.originRunId ?? null,
        createdAt: now,
        updatedAt: now,
      };
      historyEntries.push(entry);
      return entry;
    },
    listSessionHistoryEntries(sid) { return historyEntries.filter((e) => e.sessionId === sid); },
    addEvent(input) {
      const event: EventRecord = { id: createId("evt"), createdAt: nowIso(), ...input };
      events.push(event);
      return event;
    },
    listEvents: (runId) => events.filter((e) => e.runId === runId),
    createToolCall(input) {
      const toolCallId = input.id ?? createId("tool");
      const createdAt = nowIso();
      const tc: ToolCall = { ...input, id: toolCallId, createdAt, updatedAt: createdAt };
      toolCalls.set(tc.id, tc);
      return tc;
    },
    updateToolCall(id, partial) {
      const cur = toolCalls.get(id);
      if (!cur) throw new Error(`ToolCall ${id} not found`);
      const next = { ...cur, ...partial, updatedAt: nowIso() };
      toolCalls.set(id, next);
      return next;
    },
    getToolCall: (id) => toolCalls.get(id) ?? null,
    listToolCalls: (runId) => [...toolCalls.values()].filter((tc) => tc.runId === runId),
    listToolCallsBySession: (sid) => [...toolCalls.values()].filter((tc) => tc.sessionId === sid),
    createReviewRequest(input) {
      const now = nowIso();
      const review: ReviewRequest = { id: createId("review"), createdAt: now, updatedAt: now, ...input };
      reviews.set(review.id, review);
      return review;
    },
    updateReviewRequest(id, partial) {
      const cur = reviews.get(id);
      if (!cur) throw new Error(`ReviewRequest ${id} not found`);
      const next = { ...cur, ...partial, updatedAt: nowIso() };
      reviews.set(id, next);
      return next;
    },
    listReviewRequests: (taskId) => [...reviews.values()].filter((r) => !taskId || r.taskId === taskId),
    writeMemory(input) {
      const now = nowIso();
      const mem: MemoryRecord = { id: createId("memory"), createdAt: now, updatedAt: now, ...input };
      memories.set(mem.id, mem);
      return mem;
    },
    searchMemories: (_q, scope, scopeId) => [...memories.values()].filter((m) => (!scope || m.scope === scope) && (!scopeId || m.scopeId === scopeId)),
    listMemories: (scope, scopeId) => [...memories.values()].filter((m) => (!scope || m.scope === scope) && (!scopeId || m.scopeId === scopeId)),
    listProviderConfigs: () => [...providerConfigs.values()],
    upsertProviderConfig(input) {
      const now = nowIso();
      const cur = input.id ? providerConfigs.get(input.id) : undefined;
      const id = cur?.id ?? input.id ?? createId("provider");
      const config: ProviderConfig = { id, createdAt: cur?.createdAt ?? now, updatedAt: now, ...cur, ...input };
      providerConfigs.set(config.id, config);
      return config;
    },
    getProviderConfig(providerId) {
      if (providerId) return providerConfigs.get(providerId) ?? null;
      return providerConfigs.values().next().value ?? null;
    },
    deleteProviderConfig(id: string) {
      providerConfigs.delete(id);
    },
    loadSessionRuntimeSnapshot(sessionId) { return runtimeRows.get(sessionId) ?? null; },
    saveSessionRuntimeSnapshot(input) { runtimeRows.set(input.sessionId, input); },
    createBranch(input) {
      const now = nowIso();
      const branch: SessionBranch = { ...input, createdAt: now, updatedAt: now };
      return branch;
    },
    getBranch() { return null; },
    listBranches() { return []; },
    updateBranch() { throw new Error("Not implemented"); },
    createCheckpoint(input) { return { ...input, createdAt: nowIso() }; },
    listCheckpoints() { return []; },
    getLatestCheckpoint() { return null; },
    getHistoryEntry() { return null; },
    getBranchHistory() { return []; },
    getActiveBranchId() { return null; },
    setActiveBranchId() {},
  };
}

// ---------------------------------------------------------------------------
// Session lifecycle baseline
// ---------------------------------------------------------------------------

describe("Session baseline", () => {
  it("session lifecycle: idle -> running -> completed", async () => {
    const db = createMemoryDatabase();
    const session = db.createSession("Lifecycle");
    const runtime = new SessionManager().getOrCreate(session.id);
    const providerConfig = db.upsertProviderConfig(makeProviderConfig());
    runtime.setSelectedProviderConfig(providerConfig.id);
    const calls: ProviderRunInput[] = [];

    const agentSession = new AgentSession({
      database: db, sessionId: session.id, workspaceRoot: process.cwd(),
      emit: () => {}, resources: makeStaticResources(), runtime, provider: makeProvider(calls),
    });

    const run = agentSession.startRun({ prompt: "hello", providerConfig, taskId: null });
    // Run starts as queued but may immediately transition to running via processQueue
    expect(["queued", "running"]).toContain(db.getRun(run.id)?.status);

    await waitFor(() => db.getRun(run.id)?.status === "completed");

    expect(db.getRun(run.id)?.status).toBe("completed");
    expect(db.getSession(session.id)?.status).toBe("completed");
    expect(db.getSession(session.id)?.latestUserMessage).toBe("hello");
    expect(db.getSession(session.id)?.latestAssistantMessage).toBe("done-1");
    expect(calls).toHaveLength(1);
  });

  it("run queue serializes execution", async () => {
    const db = createMemoryDatabase();
    const session = db.createSession("Queue");
    const runtime = new SessionManager().getOrCreate(session.id);
    const providerConfig = db.upsertProviderConfig(makeProviderConfig());
    runtime.setSelectedProviderConfig(providerConfig.id);
    const calls: ProviderRunInput[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let callCount = 0;

    const provider = {
      async run(input: ProviderRunInput): Promise<ProviderRunResult> {
        calls.push(input);
        callCount++;
        if (callCount === 1) await gate;
        return { assistantText: `done-${callCount}`, assistantMessage: null, stopReason: "end_turn" as const, usage: { inputTokens: 0, outputTokens: 0 }, error: null };
      },
      cancel() {}, approveTool() {}, rejectTool() {},
    };

    const agentSession = new AgentSession({
      database: db, sessionId: session.id, workspaceRoot: process.cwd(),
      emit: () => {}, resources: makeStaticResources(), runtime, provider,
    });

    const run1 = agentSession.startRun({ prompt: "first", providerConfig, taskId: null });
    const run2 = agentSession.startRun({ prompt: "second", providerConfig, taskId: null });

    await waitFor(() => calls.length === 1);
    expect(calls.length).toBe(1);
    expect(runtime.snapshot().pendingRunIds).toContain(run2.id);

    release();
    await waitFor(() => db.getRun(run1.id)?.status === "completed");
    await waitFor(() => db.getRun(run2.id)?.status === "completed");

    expect(calls.map((c) => c.prompt)).toEqual(["first", "second"]);
  });

  it("messages are persisted and retrievable across runs", async () => {
    const db = createMemoryDatabase();
    const session = db.createSession("Messages");
    const runtime = new SessionManager().getOrCreate(session.id);
    const providerConfig = db.upsertProviderConfig(makeProviderConfig());
    runtime.setSelectedProviderConfig(providerConfig.id);
    const calls: ProviderRunInput[] = [];

    const agentSession = new AgentSession({
      database: db, sessionId: session.id, workspaceRoot: process.cwd(),
      emit: () => {}, resources: makeStaticResources(), runtime, provider: makeProvider(calls),
    });

    agentSession.startRun({ prompt: "prompt-a", providerConfig, taskId: null });
    await waitFor(() => db.getSession(session.id)?.status === "completed");

    agentSession.startRun({ prompt: "prompt-b", providerConfig, taskId: null });
    await waitFor(() => db.getSession(session.id)?.status === "completed");

    const msgs = db.listMessages(session.id);
    expect(msgs.filter((m) => m.role === "user").map((m) => m.content)).toEqual(["prompt-a", "prompt-b"]);
    expect(msgs.filter((m) => m.role === "assistant").length).toBeGreaterThanOrEqual(1);
  });

  it("events are emitted and persisted for run lifecycle", async () => {
    const db = createMemoryDatabase();
    const session = db.createSession("Events");
    const runtime = new SessionManager().getOrCreate(session.id);
    const providerConfig = db.upsertProviderConfig(makeProviderConfig());
    runtime.setSelectedProviderConfig(providerConfig.id);
    const emitted: RunnerEventEnvelope[] = [];

    const agentSession = new AgentSession({
      database: db, sessionId: session.id, workspaceRoot: process.cwd(),
      emit: (e) => emitted.push(e), resources: makeStaticResources(), runtime,
      provider: makeProvider([]),
    });

    const run = agentSession.startRun({ prompt: "event test", providerConfig, taskId: null });
    await waitFor(() => db.getRun(run.id)?.status === "completed");

    const types = emitted.map((e) => e.type);
    expect(types).toContain("run.started");
    expect(types).toContain("run.completed");

    const persisted = db.listEvents(run.id);
    expect(persisted.length).toBeGreaterThan(0);
    expect(persisted.map((e) => e.type)).toContain("run.started");
  });

  it("runtime snapshot is persisted after run completion", async () => {
    const db = createMemoryDatabase();
    const session = db.createSession("Snapshot");
    const runtime = new SessionManager().getOrCreate(session.id);
    const providerConfig = db.upsertProviderConfig(makeProviderConfig());
    runtime.setSelectedProviderConfig(providerConfig.id);

    const agentSession = new AgentSession({
      database: db, sessionId: session.id, workspaceRoot: process.cwd(),
      emit: () => {}, resources: makeStaticResources(), runtime, provider: makeProvider([]),
    });

    const run = agentSession.startRun({ prompt: "snapshot test", providerConfig, taskId: null });
    await waitFor(() => db.getRun(run.id)?.status === "completed");

    const snapshot = runtime.snapshot();
    expect(snapshot.activeRunId).toBeNull();
    expect(snapshot.pendingRunIds).toEqual([]);
    expect(snapshot.lastUserPrompt).toBe("snapshot test");
    expect(snapshot.lastAssistantResponse).toBeTruthy();

    const mems = db.listMemories("session", session.id);
    // Runtime snapshot is now persisted in session_runtime table, not memories
    const storedSnapshot = db.loadSessionRuntimeSnapshot?.(session.id);
    expect(storedSnapshot).not.toBeNull();
  });

  it("continue from history entry creates branch checkpoint", async () => {
    const db = createMemoryDatabase();
    const session = db.createSession("Branch");
    const runtime = new SessionManager().getOrCreate(session.id);
    const providerConfig = db.upsertProviderConfig(makeProviderConfig());
    runtime.setSelectedProviderConfig(providerConfig.id);
    const calls: ProviderRunInput[] = [];

    const agentSession = new AgentSession({
      database: db, sessionId: session.id, workspaceRoot: process.cwd(),
      emit: () => {}, resources: makeStaticResources(), runtime, provider: makeProvider(calls),
    });

    const run1 = agentSession.startRun({ prompt: "root", providerConfig, taskId: null });
    await waitFor(() => db.getRun(run1.id)?.status === "completed");

    const run2 = agentSession.startRun({ prompt: "latest", providerConfig, taskId: null });
    await waitFor(() => db.getRun(run2.id)?.status === "completed");

    const entries = db.listSessionHistoryEntries?.(session.id) ?? [];
    const target = entries.find((e) => e.kind === "message" && e.messageId === db.listMessages(session.id)[1]?.id);
    expect(target).toBeTruthy();

    const branchRun = agentSession.continueFromHistoryEntry({
      prompt: "branch", providerConfig, taskId: null,
      historyEntryId: target!.id,
      checkpointSummary: "Branch checkpoint",
    });
    await waitFor(() => db.getRun(branchRun.id)?.status === "completed");

    const branchEntries = db.listSessionHistoryEntries?.(session.id) ?? [];
    const branchSummary = branchEntries.find((e) => e.kind === "branch_summary" && e.summary === "Branch checkpoint");
    expect(branchSummary).toBeTruthy();
    expect(branchSummary?.parentId).toBe(target!.id);
  });
});
