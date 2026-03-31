import { describe, expect, it } from "vitest";

import type {
  MemoryRecord,
  ProviderConfig,
  ReviewRequest,
  Run,
  Session,
  SessionMessage,
  Task,
  ToolCall,
} from "@omi/core";
import { createId, nowIso } from "@omi/core";
import type { AppStore } from "@omi/store";
import type { CompactionSummaryDocument } from "@omi/memory";

import { createDatabaseSessionRuntimeStore, SessionManager } from "../src/session-manager";
import type { SessionRuntimeState } from "../src/session-manager";

describe("session manager", () => {
  it("tracks runtime state transitions and compaction hooks separately from persistence", () => {
    const manager = new SessionManager();
    const runtime = manager.getOrCreate("session_1");

    runtime.enqueueRun({
      runId: "run_1",
      prompt: "inspect workspace",
      taskId: null,
      providerConfigId: null,
      sourceRunId: null,
      mode: "start",
    });
    expect(runtime.snapshot().pendingRunIds).toEqual(["run_1"]);
    expect(runtime.snapshot().queuedRuns).toEqual([
      expect.objectContaining({
        runId: "run_1",
        prompt: "inspect workspace",
        mode: "start",
      }),
    ]);
    expect(runtime.snapshot().lastUserPrompt).toBeNull();

    runtime.beginRun("run_1", "inspect workspace");
    expect(runtime.snapshot().activeRunId).toBe("run_1");
    expect(runtime.snapshot().pendingRunIds).toEqual([]);
    expect(runtime.snapshot().lastUserPrompt).toBe("inspect workspace");

    runtime.blockOnTool("run_1", "tool_1");
    expect(runtime.snapshot().blockedToolCallId).toBe("tool_1");

    runtime.resumeFromToolDecision("tool_1");
    expect(runtime.snapshot().blockedToolCallId).toBeNull();

    runtime.requestCompaction("Too many messages");
    expect(runtime.snapshot().compaction.status).toBe("requested");

    runtime.beginCompaction();
    expect(runtime.snapshot().compaction.status).toBe("running");

    runtime.completeCompaction({ summary: makeCompactionSummaryDocument("Summary text") });
    expect(runtime.snapshot().compaction.status).toBe("completed");
    expect(runtime.snapshot().compaction.lastSummary).toEqual(
      makeCompactionSummaryDocument("Summary text"),
    );

    runtime.completeRun("run_1", "done");
    expect(runtime.snapshot().activeRunId).toBeNull();
    expect(runtime.snapshot().lastAssistantResponse).toBe("done");

    expect(manager.getState("session_1")?.compaction.lastSummary).toEqual(
      makeCompactionSummaryDocument("Summary text"),
    );
  });

  it("deep copies mutable arrays in snapshots", () => {
    const manager = new SessionManager();
    const runtime = manager.getOrCreate("session_2");

    runtime.enqueueRun({
      runId: "run_1",
      prompt: "inspect workspace",
      taskId: null,
      providerConfigId: null,
      sourceRunId: null,
      mode: "start",
    });
    const snapshot = runtime.snapshot();
    snapshot.queuedRuns.push({
      runId: "run_2",
      prompt: "retry",
      taskId: null,
      providerConfigId: null,
      sourceRunId: null,
      mode: "retry",
    });
    snapshot.pendingApprovalToolCallIds.push("tool_2");
    snapshot.interruptedRunIds.push("run_2");
    snapshot.pendingRunIds.push("run_3");

    expect(runtime.snapshot().queuedRuns).toHaveLength(1);
    expect(runtime.snapshot().pendingApprovalToolCallIds).toEqual([]);
    expect(runtime.snapshot().interruptedRunIds).toEqual([]);
    expect(runtime.snapshot().pendingRunIds).toEqual(["run_1"]);
  });

  it("persists runtime snapshots in dedicated storage without touching memories", () => {
    const database = createMockDatabase();
    const session = database.createSession("Runtime Storage");
    const runtime = new SessionManager(createDatabaseSessionRuntimeStore(database)).getOrCreate(
      session.id,
    );

    runtime.setSelectedProviderConfig("provider_1");
    runtime.requestCompaction("manual");

    const row = database.readSessionRuntime(session.id);

    expect(row).toEqual(
      expect.objectContaining({
        sessionId: session.id,
      }),
    );
    expect(JSON.parse(row?.snapshot ?? "{}")).toMatchObject({
      sessionId: session.id,
      selectedProviderConfigId: "provider_1",
      compaction: {
        status: "requested",
      },
    });
    expect(database.listMemories("session", session.id)).toEqual([]);
  });

  it("migrates legacy runtime snapshots out of memories once", () => {
    const database = createMockDatabase();
    const session = database.createSession("Legacy Runtime");
    const legacyState: SessionRuntimeState = {
      sessionId: session.id,
      activeRunId: null,
      pendingRunIds: [],
      queuedRuns: [],
      blockedRunId: null,
      blockedToolCallId: null,
      pendingApprovalToolCallIds: [],
      interruptedRunIds: [],
      selectedProviderConfigId: "provider_1",
      lastUserPrompt: "legacy prompt",
      lastAssistantResponse: "legacy response",
      lastActivityAt: "2025-03-30T00:00:00.000Z",
      compaction: {
        status: "completed",
        reason: null,
        requestedAt: null,
        updatedAt: "2025-03-30T00:00:00.000Z",
        lastSummary: makeCompactionSummaryDocument("Legacy summary"),
        lastCompactedAt: "2025-03-30T00:00:00.000Z",
        error: null,
      },
    };

    database.writeMemory({
      scope: "session",
      scopeId: session.id,
      title: "Runtime Snapshot",
      content: JSON.stringify(legacyState),
      tags: ["runtime_state"],
    });

    const runtime = new SessionManager(createDatabaseSessionRuntimeStore(database)).getOrCreate(
      session.id,
    );

    expect(runtime.snapshot()).toMatchObject({
      sessionId: session.id,
      selectedProviderConfigId: "provider_1",
      lastUserPrompt: "legacy prompt",
      lastAssistantResponse: "legacy response",
      compaction: {
        status: "completed",
        lastSummary: makeCompactionSummaryDocument("Legacy summary"),
      },
    });

    const row = database.readSessionRuntime(session.id);

    expect(row).toEqual(
      expect.objectContaining({
        sessionId: session.id,
      }),
    );
    expect(JSON.parse(row?.snapshot ?? "{}")).toMatchObject({
      sessionId: session.id,
      selectedProviderConfigId: "provider_1",
    });
    expect(database.listMemories("session", session.id)).toHaveLength(1);
  });

  it("restores queued retry and resume runs from explicit run lineage", () => {
    const database = createMockDatabase();
    const session = database.createSession("Recovery");
    const retrySource = database.createRun({
      sessionId: session.id,
      taskId: null,
      status: "failed",
      provider: "anthropic",
      prompt: "retry source prompt",
      sourceRunId: null,
      recoveryMode: "start",
    });
    const resumeSource = database.createRun({
      sessionId: session.id,
      taskId: null,
      status: "running",
      provider: "anthropic",
      prompt: "resume source prompt",
      sourceRunId: null,
      recoveryMode: "start",
    });
    const retryQueued = database.createRun({
      sessionId: session.id,
      taskId: null,
      status: "queued",
      provider: "anthropic",
      prompt: "retry source prompt",
      sourceRunId: retrySource.id,
      recoveryMode: "retry",
    });
    const resumeQueued = database.createRun({
      sessionId: session.id,
      taskId: null,
      status: "queued",
      provider: "anthropic",
      prompt: "resume source prompt",
      sourceRunId: resumeSource.id,
      recoveryMode: "resume",
    });
    database.updateSession(session.id, {
      status: "running",
      latestUserMessage: "session level prompt should not win",
    });

    const runtime = new SessionManager(createDatabaseSessionRuntimeStore(database)).getOrCreate(
      session.id,
    );

    expect(runtime.snapshot().queuedRuns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          runId: retryQueued.id,
          prompt: "retry source prompt",
          sourceRunId: retrySource.id,
          mode: "retry",
        }),
        expect.objectContaining({
          runId: resumeQueued.id,
          prompt: "resume source prompt",
          sourceRunId: resumeSource.id,
          mode: "resume",
        }),
      ]),
    );
    expect([
      "retry source prompt",
      "resume source prompt",
    ]).toContain(runtime.snapshot().lastUserPrompt);
    expect(runtime.snapshot().lastUserPrompt).not.toBe("session level prompt should not win");
  });
});

function createMockDatabase(): AppStore & {
  readSessionRuntime(sessionId: string): { sessionId: string; snapshot: string; updatedAt: string } | null;
} {
  const sessions = new Map<string, Session>();
  const runs = new Map<string, Run>();
  const memories = new Map<string, MemoryRecord[]>();
  const runtimeRows = new Map<string, { sessionId: string; snapshot: string; updatedAt: string }>();

  const database: AppStore & {
    readSessionRuntime(sessionId: string): { sessionId: string; snapshot: string; updatedAt: string } | null;
  } = {
    listSessions: () => [...sessions.values()],
    createSession(title) {
      const now = nowIso();
      const session: Session = {
        id: createId("session"),
        title,
        status: "idle",
        latestUserMessage: null,
        latestAssistantMessage: null,
        createdAt: now,
        updatedAt: now,
      };
      sessions.set(session.id, session);
      return session;
    },
    getSession(sessionId) {
      return sessions.get(sessionId) ?? null;
    },
    updateSession(sessionId, partial) {
      const current = sessions.get(sessionId);
      if (!current) {
        throw new Error(`Session ${sessionId} not found`);
      }
      const next = { ...current, ...partial, updatedAt: nowIso() };
      sessions.set(sessionId, next);
      return next;
    },
    listTasks: () => [],
    createTask() {
      throw new Error("Not implemented");
    },
    getTask() {
      return null;
    },
    updateTask() {
      throw new Error("Not implemented");
    },
    createRun(input) {
      const now = nowIso();
      const run: Run = {
        id: createId("run"),
        createdAt: now,
        updatedAt: now,
        ...input,
      };
      runs.set(run.id, run);
      return run;
    },
    updateRun(runId, partial) {
      const current = runs.get(runId);
      if (!current) {
        throw new Error(`Run ${runId} not found`);
      }
      const next = { ...current, ...partial, updatedAt: nowIso() };
      runs.set(runId, next);
      return next;
    },
    getRun(runId) {
      return runs.get(runId) ?? null;
    },
    listRuns(sessionId?: string) {
      return [...runs.values()].filter((run) => !sessionId || run.sessionId === sessionId);
    },
    addMessage() {
      throw new Error("Not implemented");
    },
    listMessages() {
      return [];
    },
    addEvent() {
      throw new Error("Not implemented");
    },
    listEvents() {
      return [];
    },
    createToolCall() {
      throw new Error("Not implemented");
    },
    updateToolCall() {
      throw new Error("Not implemented");
    },
    getToolCall() {
      return null;
    },
    listToolCalls() {
      return [];
    },
    listToolCallsBySession() {
      return [];
    },
    createReviewRequest() {
      throw new Error("Not implemented");
    },
    updateReviewRequest() {
      throw new Error("Not implemented");
    },
    listReviewRequests() {
      return [];
    },
    writeMemory(input) {
      const now = nowIso();
      const memory: MemoryRecord = {
        id: createId("memory"),
        createdAt: now,
        updatedAt: now,
        ...input,
      };
      const current = memories.get(input.scopeId) ?? [];
      memories.set(input.scopeId, [...current, memory]);
      return memory;
    },
    searchMemories() {
      return [];
    },
    listMemories(scope?: string, scopeId?: string) {
      const current = scopeId ? memories.get(scopeId) ?? [] : [...memories.values()].flat();
      return current.filter((memory) => (scope ? memory.scope === scope : true));
    },
    listProviderConfigs: () => [],
    upsertProviderConfig() {
      throw new Error("Not implemented");
    },
    getProviderConfig() {
      return null;
    },
    loadSessionRuntimeSnapshot(sessionId) {
      return runtimeRows.get(sessionId) ?? null;
    },
    saveSessionRuntimeSnapshot(input) {
      runtimeRows.set(input.sessionId, input);
    },
    readSessionRuntime(sessionId: string) {
      return runtimeRows.get(sessionId) ?? null;
    },
  };

  return database;
}

function makeCompactionSummaryDocument(goal: string): CompactionSummaryDocument {
  return {
    version: 1,
    goal,
    constraints: [],
    progress: {
      done: [],
      inProgress: [],
      blocked: [],
    },
    keyDecisions: [],
    nextSteps: [],
    criticalContext: [],
  };
}
