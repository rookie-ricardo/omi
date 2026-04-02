import { describe, expect, it, beforeEach } from "vitest";

import type {
  MemoryRecord,
  ProviderConfig,
  ReviewRequest,
  Run,
  RunCheckpoint,
  Session,
  SessionBranch,
  SessionMessage,
  SessionHistoryEntry,
  Task,
  ToolCall,
} from "@omi/core";
import { createId, nowIso } from "@omi/core";
import type { AppStore } from "@omi/store";
import type { CompactionSummaryDocument } from "@omi/memory";

import {
  createDatabaseSessionRuntimeStore,
  SessionManager,
  getBranchPath,
  findCommonAncestor,
  type SessionTreeNode,
} from "../src/session-manager";
import type { SessionRuntimeState, LabelEntry, CompactionEntry } from "../src/session-manager";

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

describe("session manager - tree navigation", () => {
  describe("LabelEntry type", () => {
    it("should have correct structure", () => {
      const labelEntry: LabelEntry = {
        type: "label",
        id: "label_1",
        sessionId: "session_1",
        parentId: null,
        targetId: "entry_1",
        label: "important",
        createdAt: "2025-03-30T00:00:00.000Z",
        updatedAt: "2025-03-30T00:00:00.000Z",
      };
      expect(labelEntry.type).toBe("label");
      expect(labelEntry.label).toBe("important");
    });

    it("should support undefined label", () => {
      const labelEntry: LabelEntry = {
        type: "label",
        id: "label_2",
        sessionId: "session_1",
        parentId: null,
        targetId: "entry_2",
        label: undefined,
        createdAt: "2025-03-30T00:00:00.000Z",
        updatedAt: "2025-03-30T00:00:00.000Z",
      };
      expect(labelEntry.label).toBeUndefined();
    });
  });

  describe("CompactionEntry type", () => {
    it("should have correct structure", () => {
      const entry: CompactionEntry = {
        type: "compaction",
        id: "compaction_1",
        sessionId: "session_1",
        parentId: null,
        summary: "Compacted summary",
        firstKeptEntryId: "entry_5",
        tokensBefore: 1000,
        details: { reason: "token limit" },
        createdAt: "2025-03-30T00:00:00.000Z",
        updatedAt: "2025-03-30T00:00:00.000Z",
      };
      expect(entry.type).toBe("compaction");
      expect(entry.summary).toBe("Compacted summary");
      expect(entry.firstKeptEntryId).toBe("entry_5");
      expect(entry.tokensBefore).toBe(1000);
    });
  });

  describe("SessionTreeNode type", () => {
    it("should have correct structure", () => {
      const node: SessionTreeNode = {
        entry: makeHistoryEntry("entry_1", null, "message", "msg_1", null, "2025-03-30T00:00:00.000Z"),
        label: "checkpoint",
        children: [],
      };
      expect(node.entry.id).toBe("entry_1");
      expect(node.label).toBe("checkpoint");
      expect(node.children).toEqual([]);
    });

    it("should support nested children", () => {
      const childNode: SessionTreeNode = {
        entry: makeHistoryEntry("entry_2", "entry_1", "message", "msg_2", null, "2025-03-30T00:00:01.000Z"),
        children: [],
      };
      const parentNode: SessionTreeNode = {
        entry: makeHistoryEntry("entry_1", null, "message", "msg_1", null, "2025-03-30T00:00:00.000Z"),
        children: [childNode],
      };
      expect(parentNode.children).toHaveLength(1);
      expect(parentNode.children[0].entry.id).toBe("entry_2");
    });
  });

  describe("getBranchPath utility function", () => {
    it("should return path from root to target", () => {
      const entries: SessionHistoryEntry[] = [
        makeHistoryEntry("root", null, "message", "msg_root", null, "2025-03-30T00:00:00.000Z"),
        makeHistoryEntry("child1", "root", "message", "msg_child1", null, "2025-03-30T00:00:01.000Z"),
        makeHistoryEntry("child2", "child1", "message", "msg_child2", null, "2025-03-30T00:00:02.000Z"),
      ];

      const path = getBranchPath(entries, "child2");
      expect(path).toHaveLength(3);
      expect(path[0].id).toBe("root");
      expect(path[1].id).toBe("child1");
      expect(path[2].id).toBe("child2");
    });

    it("should return single entry for root", () => {
      const entries: SessionHistoryEntry[] = [
        makeHistoryEntry("root", null, "message", "msg_root", null, "2025-03-30T00:00:00.000Z"),
      ];

      const path = getBranchPath(entries, "root");
      expect(path).toHaveLength(1);
      expect(path[0].id).toBe("root");
    });

    it("should return empty array for missing entry", () => {
      const entries: SessionHistoryEntry[] = [
        makeHistoryEntry("root", null, "message", "msg_root", null, "2025-03-30T00:00:00.000Z"),
      ];

      const path = getBranchPath(entries, "nonexistent");
      expect(path).toHaveLength(0);
    });
  });

  describe("findCommonAncestor utility function", () => {
    it("should find common ancestor between two branches", () => {
      const entries: SessionHistoryEntry[] = [
        makeHistoryEntry("root", null, "message", "msg_root", null, "2025-03-30T00:00:00.000Z"),
        makeHistoryEntry("branch_a", "root", "message", "msg_a", null, "2025-03-30T00:00:01.000Z"),
        makeHistoryEntry("branch_b", "root", "message", "msg_b", null, "2025-03-30T00:00:02.000Z"),
      ];

      const ancestor = findCommonAncestor(entries, "branch_a", "branch_b");
      expect(ancestor).toBe("root");
    });

    it("should return null for entries with no common ancestor", () => {
      const entries: SessionHistoryEntry[] = [
        makeHistoryEntry("root1", null, "message", "msg_root1", null, "2025-03-30T00:00:00.000Z"),
        makeHistoryEntry("root2", null, "message", "msg_root2", null, "2025-03-30T00:00:01.000Z"),
      ];

      const ancestor = findCommonAncestor(entries, "root1", "root2");
      expect(ancestor).toBeNull();
    });

    it("should return the entry itself when same entry is provided", () => {
      const entries: SessionHistoryEntry[] = [
        makeHistoryEntry("root", null, "message", "msg_root", null, "2025-03-30T00:00:00.000Z"),
        makeHistoryEntry("child", "root", "message", "msg_child", null, "2025-03-30T00:00:01.000Z"),
      ];

      const ancestor = findCommonAncestor(entries, "child", "child");
      expect(ancestor).toBe("child");
    });
  });

  describe("SessionManager - leaf tracking", () => {
    it("should return null for unset leafId", () => {
      const manager = new SessionManager();
      expect(manager.getLeafId("session_1")).toBeNull();
    });

    it("should have branch method", () => {
      const manager = new SessionManager();
      expect(typeof manager.branch).toBe("function");
    });

    it("should have fork method", () => {
      const manager = new SessionManager();
      expect(typeof manager.fork).toBe("function");
    });
  });

  describe("SessionManager - labels", () => {
    it("should set and get labels", () => {
      const manager = new SessionManager();

      const targetId = manager.setLabel("session_1", "entry_1", "important checkpoint");
      expect(targetId).toBe("entry_1");
      expect(manager.getLabel("session_1", "entry_1")).toBe("important checkpoint");
    });

    it("should return undefined for unset labels", () => {
      const manager = new SessionManager();
      expect(manager.getLabel("session_1", "entry_1")).toBeUndefined();
    });

    it("should delete label when set to undefined", () => {
      const manager = new SessionManager();

      manager.setLabel("session_1", "entry_1", "checkpoint");
      expect(manager.getLabel("session_1", "entry_1")).toBe("checkpoint");

      manager.setLabel("session_1", "entry_1", undefined);
      expect(manager.getLabel("session_1", "entry_1")).toBeUndefined();
    });
  });

  describe("SessionManager - session metadata", () => {
    it("should return session ID", () => {
      const manager = new SessionManager();
      expect(manager.getSessionId("session_1")).toBe("session_1");
    });

    it("should return empty string for session dir", () => {
      const manager = new SessionManager();
      expect(manager.getSessionDir("session_1")).toBe("");
    });

    it("should return undefined for session file", () => {
      const manager = new SessionManager();
      expect(manager.getSessionFile("session_1")).toBeUndefined();
    });
  });

  describe("SessionManager - fork", () => {
    it("should return a new session ID", () => {
      const manager = new SessionManager();
      const newSessionId = manager.fork("session_1");
      expect(newSessionId).toBeDefined();
      expect(typeof newSessionId).toBe("string");
      expect(newSessionId.length).toBeGreaterThan(0);
    });
  });
});

function createMockDatabase(): AppStore & {
  readSessionRuntime(sessionId: string): { sessionId: string; snapshot: string; updatedAt: string } | null;
} {
  const sessions = new Map<string, Session>();
  const runs = new Map<string, Run>();
  const memories = new Map<string, MemoryRecord[]>();
  const runtimeRows = new Map<string, { sessionId: string; snapshot: string; updatedAt: string }>();
  const branches = new Map<string, SessionBranch>();
  const checkpoints: RunCheckpoint[] = [];

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
    createBranch(input) {
      const now = nowIso();
      const branch: SessionBranch = { ...input, createdAt: now, updatedAt: now };
      branches.set(branch.id, branch);
      return branch;
    },
    getBranch(branchId) {
      return branches.get(branchId) ?? null;
    },
    listBranches() {
      return [...branches.values()];
    },
    updateBranch(branchId, partial) {
      const current = branches.get(branchId);
      if (!current) throw new Error(`Branch ${branchId} not found`);
      const next = { ...current, ...partial, updatedAt: nowIso() };
      branches.set(branchId, next);
      return next;
    },
    createCheckpoint(input) {
      const cp: RunCheckpoint = { ...input, createdAt: nowIso() };
      checkpoints.push(cp);
      return cp;
    },
    listCheckpoints(runId) {
      return checkpoints.filter((c) => c.runId === runId);
    },
    getLatestCheckpoint(runId) {
      return checkpoints.filter((c) => c.runId === runId).at(-1) ?? null;
    },
    getHistoryEntry() {
      return null;
    },
    getBranchHistory() {
      return [];
    },
    getActiveBranchId() {
      return null;
    },
    setActiveBranchId() {},
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

function makeHistoryEntry(
  id: string,
  parentId: string | null,
  kind: SessionHistoryEntry["kind"],
  messageId: string | null,
  summary: string | null,
  createdAt: string,
): SessionHistoryEntry {
  return {
    id,
    sessionId: "session_1",
    parentId,
    kind,
    messageId,
    summary,
    details: null,
    createdAt,
    updatedAt: createdAt,
  };
}
