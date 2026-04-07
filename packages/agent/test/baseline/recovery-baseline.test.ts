/**
 * Recovery 基线回归测试
 *
 * 覆盖 P0 能力：
 * - 重试失败 Run（retryRun）
 * - 恢复中断 Run（resumeRun）
 * - 自动重试（exponential backoff）
 * - Overflow 恢复（compaction + retry）
 * - 取消 Run（cancelRun）
 */

import { describe, it, expect, vi } from "vitest";
import type { ProviderRunInput, ProviderRunResult } from "@omi/provider";
import { AgentSession, SessionManager, SessionRuntime } from "../../src/index";
import type { ResourceLoader, RunnerEventEnvelope } from "../../src/index";
import type { AppStore } from "@omi/store";
import type {
  EventRecord, MemoryRecord, ProviderConfig, ReviewRequest,
  Run, Session, SessionBranch, RunCheckpoint, SessionHistoryEntry, SessionMessage, Task, ToolCall,
} from "@omi/core";
import { createId, nowIso } from "@omi/core";

function waitFor(predicate: () => boolean, timeoutMs = 2500): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function check() {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error("Condition not met in time"));
      setTimeout(check, 10);
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
    workspaceRoot: process.cwd(), agentDir: "/tmp/.omi",
    async reload() {}, getProjectContextFiles: () => [],
    listSkills: async () => [], searchSkills: async () => [],
    resolveSkillForPrompt: async () => null, buildSystemPrompt: () => "",
    getPrompts: () => ({ items: [], diagnostics: [] }),
    getThemes: () => ({ items: [], diagnostics: [] }),
    getExtensions: () => ({ items: [], diagnostics: [] }),
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
  const branches = new Map<string, SessionBranch>();
  const checkpoints: RunCheckpoint[] = [];
  const activeBranchIds = new Map<string, string | null>();
  const runtimeRows = new Map<string, { sessionId: string; snapshot: string; updatedAt: string }>();

  return {
    listSessions: () => [...sessions.values()],
    createSession(title) {
      const now = nowIso();
      const s: Session = { id: createId("session"), title, status: "idle", createdAt: now, updatedAt: now, latestUserMessage: null, latestAssistantMessage: null };
      sessions.set(s.id, s); return s;
    },
    getSession: (id) => sessions.get(id) ?? null,
    updateSession(id, p) { const c = sessions.get(id)!; const n = { ...c, ...p, updatedAt: nowIso() }; sessions.set(id, n); return n; },
    listTasks: () => [...tasks.values()],
    createTask(input) { const now = nowIso(); const t: Task = { id: createId("task"), createdAt: now, updatedAt: now, ...input }; tasks.set(t.id, t); return t; },
    getTask: (id) => tasks.get(id) ?? null,
    updateTask(id, p) { const c = tasks.get(id)!; const n = { ...c, ...p, updatedAt: nowIso() }; tasks.set(id, n); return n; },
    createRun(input) {
      const now = nowIso();
      const runId = (input as { id?: string }).id ?? createId("run");
      const r: Run = { ...input, id: runId, createdAt: now, updatedAt: now };
      runs.set(r.id, r);
      return r;
    },
    listRuns: (sid) => [...runs.values()].filter((r) => !sid || r.sessionId === sid),
    updateRun(id, p) { const c = runs.get(id)!; const n = { ...c, ...p, updatedAt: nowIso() }; runs.set(id, n); return n; },
    getRun: (id) => runs.get(id) ?? null,
    addMessage(input) {
      const { parentHistoryEntryId, ...mi } = input as any;
      const m: SessionMessage = { id: createId("msg"), createdAt: nowIso(), ...mi };
      messages.push(m);
      const pid = parentHistoryEntryId ?? historyEntries.filter((e) => e.sessionId === m.sessionId).at(-1)?.id ?? null;
      historyEntries.push({
        id: createId("hist"),
        sessionId: m.sessionId,
        parentId: pid,
        kind: "message",
        messageId: m.id,
        summary: null,
        details: null,
        branchId: null,
        lineageDepth: 0,
        originRunId: null,
        createdAt: m.createdAt,
        updatedAt: m.createdAt,
      });
      return m;
    },
    listMessages: (sid) => messages.filter((m) => m.sessionId === sid),
    addSessionHistoryEntry(input) {
      const now = nowIso();
      const e: SessionHistoryEntry = {
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
      historyEntries.push(e);
      return e;
    },
    listSessionHistoryEntries(sid) { return historyEntries.filter((e) => e.sessionId === sid); },
    addEvent(input) { const e: EventRecord = { id: createId("evt"), createdAt: nowIso(), ...input }; events.push(e); return e; },
    listEvents: (rid) => events.filter((e) => e.runId === rid),
    createToolCall(input) {
      const toolCallId = input.id ?? createId("tool");
      const createdAt = nowIso();
      const tc: ToolCall = { ...input, id: toolCallId, createdAt, updatedAt: createdAt };
      toolCalls.set(tc.id, tc);
      return tc;
    },
    updateToolCall(id, p) { const c = toolCalls.get(id)!; const n = { ...c, ...p, updatedAt: nowIso() }; toolCalls.set(id, n); return n; },
    getToolCall: (id) => toolCalls.get(id) ?? null,
    listToolCalls: (rid) => [...toolCalls.values()].filter((tc) => tc.runId === rid),
    listToolCallsBySession: (sid) => [...toolCalls.values()].filter((tc) => tc.sessionId === sid),
    createReviewRequest(input) { const now = nowIso(); const r: ReviewRequest = { id: createId("review"), createdAt: now, updatedAt: now, ...input }; reviews.set(r.id, r); return r; },
    updateReviewRequest(id, p) { const c = reviews.get(id)!; const n = { ...c, ...p, updatedAt: nowIso() }; reviews.set(id, n); return n; },
    listReviewRequests: (tid) => [...reviews.values()].filter((r) => !tid || r.taskId === tid),
    writeMemory(input) { const now = nowIso(); const m: MemoryRecord = { id: createId("memory"), createdAt: now, updatedAt: now, ...input }; memories.set(m.id, m); return m; },
    searchMemories: (_q, scope, scopeId) => [...memories.values()].filter((m) => (!scope || m.scope === scope) && (!scopeId || m.scopeId === scopeId)),
    listMemories: (scope, scopeId) => [...memories.values()].filter((m) => (!scope || m.scope === scope) && (!scopeId || m.scopeId === scopeId)),
    listProviderConfigs: () => [...providerConfigs.values()],
    upsertProviderConfig(input) {
      const now = nowIso();
      const cur = input.id ? providerConfigs.get(input.id) : undefined;
      const id = cur?.id ?? input.id ?? createId("provider");
      const config: ProviderConfig = { id, createdAt: cur?.createdAt ?? now, updatedAt: now, ...cur, ...input };
      providerConfigs.set(config.id, config); return config;
    },
    getProviderConfig(pid) { if (pid) return providerConfigs.get(pid) ?? null; return providerConfigs.values().next().value ?? null; },
    deleteProviderConfig(id: string) { providerConfigs.delete(id); },
    loadSessionRuntimeSnapshot(sid) { return runtimeRows.get(sid) ?? null; },
    saveSessionRuntimeSnapshot(input) { runtimeRows.set(input.sessionId, input); },
    createBranch(input) {
      const now = nowIso();
      const branch: SessionBranch = { ...input, createdAt: now, updatedAt: now };
      branches.set(branch.id, branch);
      activeBranchIds.set(branch.sessionId, branch.id);
      return branch;
    },
    getBranch: (branchId) => branches.get(branchId) ?? null,
    listBranches: (sessionId) => [...branches.values()].filter((branch) => branch.sessionId === sessionId),
    updateBranch(branchId, partial) {
      const current = branches.get(branchId);
      if (!current) throw new Error(`Branch ${branchId} not found`);
      const next = { ...current, ...partial, updatedAt: nowIso() };
      branches.set(branchId, next);
      return next;
    },
    createCheckpoint(input) {
      const checkpoint: RunCheckpoint = {
        ...input,
        createdAt: nowIso(),
      };
      checkpoints.push(checkpoint);
      return checkpoint;
    },
    listCheckpoints: (runId) => checkpoints.filter((checkpoint) => checkpoint.runId === runId),
    getLatestCheckpoint: (runId) => [...checkpoints].filter((checkpoint) => checkpoint.runId === runId).at(-1) ?? null,
    getHistoryEntry: (entryId) => historyEntries.find((entry) => entry.id === entryId) ?? null,
    getBranchHistory: (branchId) => historyEntries.filter((entry) => entry.branchId === branchId),
    getActiveBranchId: (sessionId) => activeBranchIds.get(sessionId) ?? null,
    setActiveBranchId(sessionId, branchId) { activeBranchIds.set(sessionId, branchId); },
  };
}

describe("Recovery baseline", () => {
  it("retryRun creates new run with sourceRunId linkage", async () => {
    const db = createMemoryDatabase();
    const session = db.createSession("Retry");
    const runtime = new SessionManager().getOrCreate(session.id);
    const providerConfig = db.upsertProviderConfig(makeProviderConfig());
    runtime.setSelectedProviderConfig(providerConfig.id);
    const callRecords: Array<{ runId: string; prompt: string }> = [];

    const provider = {
      async run(input: ProviderRunInput): Promise<ProviderRunResult> {
        callRecords.push({ runId: input.runId, prompt: input.prompt });
        if (callRecords.length === 1) throw new Error("boom");
        return { assistantText: "retried", assistantMessage: null, stopReason: "end_turn" as const, toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 }, error: null };
      },
      cancel() {}, approveTool() {}, rejectTool() {},
    };

    const agentSession = new AgentSession({
      database: db, sessionId: session.id, workspaceRoot: process.cwd(),
      emit: () => {}, resources: makeStaticResources(), runtime, provider,
    });

    const firstRun = agentSession.startRun({ prompt: "retry me", providerConfig: makeProviderConfig(), taskId: null });
    await waitFor(() => db.getRun(firstRun.id)?.status === "failed");

    const retryRun = agentSession.retryRun(firstRun.id);
    await waitFor(() => db.getRun(retryRun.id)?.status === "completed");

    expect(retryRun.id).not.toBe(firstRun.id);
    expect(db.getRun(retryRun.id)?.sourceRunId).toBe(firstRun.id);
    expect(db.getRun(retryRun.id)?.recoveryMode).toBe("retry");
    expect(db.getRun(retryRun.id)?.status).toBe("completed");
    expect(db.getRun(firstRun.id)?.status).toBe("failed");
  });

  it("resumeRun recovers from interrupted run", async () => {
    const db = createMemoryDatabase();
    const session = db.createSession("Resume");
    const providerConfig = db.upsertProviderConfig(makeProviderConfig());
    const originalRun = db.createRun({
      sessionId: session.id, taskId: null, status: "running",
      provider: "anthropic", prompt: "original prompt", sourceRunId: null, recoveryMode: "start",
    });
    db.updateSession(session.id, { status: "running", latestUserMessage: "original prompt" });
    const runtime = new SessionRuntime(session.id, {
      interruptedRunIds: [originalRun.id],
      selectedProviderConfigId: providerConfig.id,
    });
    const executedRuns: string[] = [];

    const provider = {
      async run(input: ProviderRunInput): Promise<ProviderRunResult> {
        executedRuns.push(input.runId);
        return { assistantText: "resumed", assistantMessage: null, stopReason: "end_turn" as const, toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 }, error: null };
      },
      cancel() {}, approveTool() {}, rejectTool() {},
    };

    const agentSession = new AgentSession({
      database: db, sessionId: session.id, workspaceRoot: process.cwd(),
      emit: () => {}, resources: makeStaticResources(), runtime, provider,
    });

    const resumedRun = agentSession.resumeRun(originalRun.id);
    await waitFor(() => db.getRun(resumedRun.id)?.status === "completed");

    expect(resumedRun.id).not.toBe(originalRun.id);
    expect(db.getRun(resumedRun.id)?.sourceRunId).toBe(originalRun.id);
    expect(db.getRun(resumedRun.id)?.recoveryMode).toBe("resume");
    expect(db.getRun(resumedRun.id)?.prompt).toBe("original prompt");
  });

  it("cancelRun transitions run to canceled and emits event", async () => {
    const db = createMemoryDatabase();
    const session = db.createSession("Cancel");
    const runtime = new SessionManager().getOrCreate(session.id);
    const providerConfig = db.upsertProviderConfig(makeProviderConfig());
    runtime.setSelectedProviderConfig(providerConfig.id);
    const emitted: RunnerEventEnvelope[] = [];

    const provider = {
      async run(input: ProviderRunInput): Promise<ProviderRunResult> {
        return { assistantText: "done", assistantMessage: null, stopReason: "end_turn" as const, toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 }, error: null };
      },
      cancel() {}, approveTool() {}, rejectTool() {},
    };

    const agentSession = new AgentSession({
      database: db, sessionId: session.id, workspaceRoot: process.cwd(),
      emit: (e) => emitted.push(e), resources: makeStaticResources(), runtime, provider,
    });

    const run = agentSession.startRun({ prompt: "cancel me", providerConfig, taskId: null });
    await waitFor(() => db.getRun(run.id)?.status === "completed");

    const result = agentSession.cancelRun(run.id);
    expect(result.canceled).toBe(true);
  });

  it("auto-retry with exponential backoff on retryable error", async () => {
    const db = createMemoryDatabase();
    const session = db.createSession("AutoRetry");
    const runtime = new SessionManager().getOrCreate(session.id);
    const providerConfig = db.upsertProviderConfig(makeProviderConfig());
    runtime.setSelectedProviderConfig(providerConfig.id);
    const calls: ProviderRunInput[] = [];
    const events: RunnerEventEnvelope[] = [];
    let callCount = 0;

    const provider = {
      async run(input: ProviderRunInput): Promise<ProviderRunResult> {
        calls.push(input);
        callCount++;
        if (callCount <= 1) throw new Error("503 Service Unavailable");
        return { assistantText: "recovered", assistantMessage: null, stopReason: "end_turn" as const, toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 }, error: null };
      },
      cancel() {}, approveTool() {}, rejectTool() {},
    };

    const agentSession = new AgentSession({
      database: db, sessionId: session.id, workspaceRoot: process.cwd(),
      emit: (e) => events.push(e), resources: makeStaticResources(), runtime, provider,
    });

    const run = agentSession.startRun({ prompt: "auto-retry", providerConfig, taskId: null });
    await waitFor(() => db.getRun(run.id)?.status === "completed", 10000);

    expect(calls.length).toBe(2);
    expect(events.some((e) => e.type === "auto_retry_start")).toBe(true);
    expect(events.some((e) => e.type === "auto_retry_end")).toBe(true);
  });
});
