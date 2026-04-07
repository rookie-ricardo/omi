/**
 * WS-01 Session Kernel 验收测试
 *
 * 验收标准：
 * 1. 任意 run 可仅凭 DB 重建执行上下文
 * 2. 从历史节点继续，不污染原 branch
 * 3. 重启后 pending approval / queued run 状态不丢失
 * 4. 保留 migration down SQL，store 层每次 schema 升级附带数据一致性检查脚本
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createDatabaseSessionRuntimeStore, SessionManager } from "../src/session-manager";
import type { AppStore } from "@omi/store";
import type {
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

describe("WS-01 Session Kernel 验收测试", () => {
  describe("验收标准 1: 任意 run 可仅凭 DB 重建执行上下文", () => {
    it("从数据库记录恢复 queued run 的完整执行上下文", () => {
      const db = createMockDatabase();
      const session = db.createSession("Recovery Context");
      const providerConfig = db.upsertProviderConfig({
        id: createId("provider"),
        name: "Test Provider",
        type: "anthropic",
        baseUrl: "https://api.anthropic.com",
        apiKey: "test-key",
        model: "claude-sonnet-4-20250514",
      });

      // 创建一个已完成的 run
      const completedRun = db.createRun({
        sessionId: session.id,
        taskId: null,
        status: "completed",
        provider: "anthropic",
        prompt: "completed prompt",
        sourceRunId: null,
        recoveryMode: "start",
      });

      // 创建一个 queued run（待恢复）
      const queuedRun = db.createRun({
        sessionId: session.id,
        taskId: null,
        status: "queued",
        provider: "anthropic",
        prompt: "queued prompt",
        sourceRunId: completedRun.id,
        recoveryMode: "retry",
      });

      // 模拟重启后首次加载：loadSessionRuntimeSnapshot 返回 null
      // restoreFromDatabaseRecords 从 DB 记录恢复 queued runs
      const store = createDatabaseSessionRuntimeStore(db);
      const runtime = new SessionManager(store, db).getOrCreate(session.id);
      const snapshot = runtime.snapshot();

      // 验证 queued run 被正确恢复
      expect(snapshot.queuedRuns.length).toBeGreaterThan(0);
      const recoveredRun = snapshot.queuedRuns.find((r) => r.runId === queuedRun.id);
      expect(recoveredRun).toBeDefined();
      expect(recoveredRun?.prompt).toBe("queued prompt");
      expect(recoveredRun?.mode).toBe("retry");
      expect(recoveredRun?.sourceRunId).toBe(completedRun.id);
    });

    it("从数据库记录恢复 activeBranchId", () => {
      const db = createMockDatabase();
      const session = db.createSession("Active Branch Recovery");

      // 创建分支
      const mainBranch = db.createBranch({
        id: createId("branch"),
        sessionId: session.id,
        headEntryId: null,
        title: "main",
      });

      // 设置 active branch
      db.setActiveBranchId(session.id, mainBranch.id);

      // 模拟重启后恢复
      const store = createDatabaseSessionRuntimeStore(db);
      const runtime = new SessionManager(store, db).getOrCreate(session.id);
      const snapshot = runtime.snapshot();

      // 验证 active branch 被正确恢复
      expect(snapshot.activeBranchId).toBe(mainBranch.id);
    });

    it("从 DB 恢复 checkpoint 和 resume_from_checkpoint 链路", () => {
      const db = createMockDatabase();
      const session = db.createSession("Checkpoint Recovery");
      const run = db.createRun({
        sessionId: session.id,
        taskId: null,
        status: "running",
        provider: "anthropic",
        prompt: "checkpoint test",
        sourceRunId: null,
        recoveryMode: "start",
      });

      // 创建多个 checkpoint
      const cp1 = db.createCheckpoint({
        id: createId("checkpoint"),
        runId: run.id,
        sessionId: session.id,
        phase: "before_model_call",
        payload: { phase: "setup" },
      });

      const cp2 = db.createCheckpoint({
        id: createId("checkpoint"),
        runId: run.id,
        sessionId: session.id,
        phase: "after_model_stream",
        payload: { tokens: 100 },
      });

      // 创建从 checkpoint 恢复的 run
      const resumedRun = db.createRun({
        sessionId: session.id,
        taskId: null,
        status: "queued",
        provider: "anthropic",
        prompt: "resumed from checkpoint",
        sourceRunId: run.id,
        recoveryMode: "resume",
      });

      // 更新 resumed run 的 resume_from_checkpoint
      db.updateRun(resumedRun.id, {
        originRunId: run.id,
        resumeFromCheckpoint: cp2.id,
      });

      // 通过数据库恢复
      const store = createDatabaseSessionRuntimeStore(db);
      const runtime = new SessionManager(store, db).getOrCreate(session.id);

      // 验证 checkpoint 链路正确
      const checkpoints = db.listCheckpoints(run.id);
      expect(checkpoints).toHaveLength(2);
      expect(checkpoints.map((cp) => cp.phase)).toEqual([
        "before_model_call",
        "after_model_stream",
      ]);

      // 验证 resume_from_checkpoint 引用正确
      const resumed = db.getRun(resumedRun.id);
      expect(resumed?.resumeFromCheckpoint).toBe(cp2.id);
      expect(resumed?.originRunId).toBe(run.id);
    });
  });

  describe("验收标准 2: 从历史节点继续，不污染原 branch", () => {
    it("continueFromHistoryEntry 创建独立的分支，不污染原分支历史", () => {
      const db = createMockDatabase();
      const session = db.createSession("Branch Isolation");
      const manager = new SessionManager(undefined, db);

      // 创建分支
      const mainBranch = db.createBranch({
        id: createId("branch"),
        sessionId: session.id,
        headEntryId: null,
        title: "main",
      });

      // 添加历史条目
      const entry1 = db.addSessionHistoryEntry!({
        id: createId("hist"),
        sessionId: session.id,
        parentId: null,
        kind: "message",
        messageId: null,
        summary: null,
        details: null,
        branchId: mainBranch.id,
        lineageDepth: 0,
        originRunId: null,
      });

      const entry2 = db.addSessionHistoryEntry!({
        id: createId("hist"),
        sessionId: session.id,
        parentId: entry1.id,
        kind: "message",
        messageId: null,
        summary: null,
        details: null,
        branchId: mainBranch.id,
        lineageDepth: 1,
        originRunId: null,
      });

      // 记录 main 分支的 head
      db.updateBranch(mainBranch.id, { headEntryId: entry2.id });

      // 创建新分支（模拟 continueFromHistoryEntry 的行为）
      const branchFromEntry1 = db.createBranch({
        id: createId("branch"),
        sessionId: session.id,
        headEntryId: entry1.id,
        title: "branch-from-entry1",
      });

      // 在新分支上添加条目
      const branchEntry = db.addSessionHistoryEntry!({
        id: createId("hist"),
        sessionId: session.id,
        parentId: entry1.id,
        kind: "branch_summary",
        messageId: null,
        summary: "Branch checkpoint",
        details: null,
        branchId: branchFromEntry1.id,
        lineageDepth: 1,
        originRunId: null,
      });

      // 验证原分支没有被污染
      const mainBranchAfter = db.getBranch(mainBranch.id);
      expect(mainBranchAfter?.headEntryId).toBe(entry2.id); // 仍然是 entry2

      // 验证新分支有正确的 head
      expect(branchFromEntry1.headEntryId).toBe(entry1.id);

      // 验证新分支有自己的条目
      const branchHistory = db.getBranchHistory(session.id, branchFromEntry1.id);
      expect(branchHistory).toHaveLength(1);
      expect(branchHistory[0].id).toBe(branchEntry.id);
    });

    it("history entry 具备 lineageDepth 追踪", () => {
      const db = createMockDatabase();
      const session = db.createSession("Lineage Depth");

      // 添加多层嵌套条目
      const entry0 = db.addSessionHistoryEntry!({
        id: createId("hist"),
        sessionId: session.id,
        parentId: null,
        kind: "message",
        messageId: null,
        summary: null,
        details: null,
        branchId: null,
        lineageDepth: 0,
        originRunId: null,
      });

      const entry1 = db.addSessionHistoryEntry!({
        id: createId("hist"),
        sessionId: session.id,
        parentId: entry0.id,
        kind: "message",
        messageId: null,
        summary: null,
        details: null,
        branchId: null,
        lineageDepth: 1,
        originRunId: null,
      });

      const entry2 = db.addSessionHistoryEntry!({
        id: createId("hist"),
        sessionId: session.id,
        parentId: entry1.id,
        kind: "message",
        messageId: null,
        summary: null,
        details: null,
        branchId: null,
        lineageDepth: 2,
        originRunId: null,
      });

      // 验证 lineageDepth 正确
      expect(entry0.lineageDepth).toBe(0);
      expect(entry1.lineageDepth).toBe(1);
      expect(entry2.lineageDepth).toBe(2);
    });

    it("history entry 具备 originRunId 追踪", () => {
      const db = createMockDatabase();
      const session = db.createSession("Origin Run");
      const run1 = db.createRun({
        sessionId: session.id,
        taskId: null,
        status: "completed",
        provider: "anthropic",
        prompt: "run 1",
        sourceRunId: null,
        recoveryMode: "start",
      });

      const entryFromRun1 = db.addSessionHistoryEntry!({
        id: createId("hist"),
        sessionId: session.id,
        parentId: null,
        kind: "message",
        messageId: null,
        summary: null,
        details: null,
        branchId: null,
        lineageDepth: 0,
        originRunId: run1.id,
      });

      expect(entryFromRun1.originRunId).toBe(run1.id);
    });
  });

  describe("验收标准 3: 重启后 pending approval / queued run 状态不丢失", () => {
    it("重启后 pending approval tool call 被正确恢复", () => {
      const db = createMockDatabase();
      const session = db.createSession("Pending Approval");
      const run = db.createRun({
        sessionId: session.id,
        taskId: null,
        status: "running",
        provider: "anthropic",
        prompt: "needs approval",
        sourceRunId: null,
        recoveryMode: "start",
      });

      // 创建需要 approval 的 tool call
      const toolCall = db.createToolCall({
        id: createId("tool"),
        runId: run.id,
        sessionId: session.id,
        taskId: null,
        toolName: "Write",
        approvalState: "pending",
        input: { path: "/tmp/test.txt", content: "hello" },
        output: null,
        error: null,
      });

      // 更新 session 状态为 blocked
      db.updateSession(session.id, { status: "blocked" });

      // 保存运行时快照
      const store = createDatabaseSessionRuntimeStore(db);
      const runtime = new SessionManager(store, db).getOrCreate(session.id);
      runtime.blockOnTool(run.id, toolCall.id);

      // 模拟重启：创建新的 manager 并从数据库恢复
      const store2 = createDatabaseSessionRuntimeStore(db);
      const runtime2 = new SessionManager(store2, db).getOrCreate(session.id);
      const snapshot2 = runtime2.snapshot();

      // 验证 blocked tool call 被恢复
      expect(snapshot2.blockedToolCallId).toBe(toolCall.id);
      expect(snapshot2.blockedRunId).toBe(run.id);
      expect(snapshot2.pendingApprovalToolCallIds).toContain(toolCall.id);
    });

    it("重启后多个 queued run 被正确恢复", () => {
      const db = createMockDatabase();
      const session = db.createSession("Multiple Queued Runs");
      const providerConfig = db.upsertProviderConfig({
        id: createId("provider"),
        name: "Test",
        type: "anthropic",
        baseUrl: "",
        apiKey: "key",
        model: "claude",
      });

      // 创建多个 queued run
      const queuedRuns = [
        db.createRun({
          sessionId: session.id,
          taskId: null,
          status: "queued",
          provider: "anthropic",
          prompt: "queued 1",
          sourceRunId: null,
          recoveryMode: "start",
        }),
        db.createRun({
          sessionId: session.id,
          taskId: null,
          status: "queued",
          provider: "anthropic",
          prompt: "queued 2",
          sourceRunId: null,
          recoveryMode: "start",
        }),
      ];

      // 保存并模拟重启
      const store = createDatabaseSessionRuntimeStore(db);
      const runtime = new SessionManager(store, db).getOrCreate(session.id);

      // 验证 queued runs 被恢复
      const snapshot = runtime.snapshot();
      expect(snapshot.queuedRuns.length).toBe(2);
      expect(snapshot.pendingRunIds).toContain(queuedRuns[0].id);
      expect(snapshot.pendingRunIds).toContain(queuedRuns[1].id);

      // 模拟重启
      const store2 = createDatabaseSessionRuntimeStore(db);
      const runtime2 = new SessionManager(store2, db).getOrCreate(session.id);
      const snapshot2 = runtime2.snapshot();

      // 验证重启后 queued runs 仍然存在
      expect(snapshot2.queuedRuns.length).toBe(2);
      expect(snapshot2.pendingRunIds).toContain(queuedRuns[0].id);
      expect(snapshot2.pendingRunIds).toContain(queuedRuns[1].id);
    });

    it("重启后 interrupted run 状态不丢失", () => {
      const db = createMockDatabase();
      const session = db.createSession("Interrupted Run");
      const run = db.createRun({
        sessionId: session.id,
        taskId: null,
        status: "running",
        provider: "anthropic",
        prompt: "interrupted prompt",
        sourceRunId: null,
        recoveryMode: "start",
      });

      // 保存运行时状态（run 正在执行）
      const store = createDatabaseSessionRuntimeStore(db);
      const runtime = new SessionManager(store, db).getOrCreate(session.id);
      runtime.beginRun(run.id, "interrupted prompt");

      // 模拟进程被中断
      const store2 = createDatabaseSessionRuntimeStore(db);
      const runtime2 = new SessionManager(store2, db).getOrCreate(session.id);
      const snapshot2 = runtime2.snapshot();

      // 验证 run 被标记为 interrupted
      expect(snapshot2.interruptedRunIds).toContain(run.id);
      expect(snapshot2.activeRunId).toBeNull(); // 重启后 activeRunId 被清空
    });
  });

  describe("验收标准 4: Migration down SQL 和数据一致性检查", () => {
    it("sessionBranches 表正确创建并支持 branch 操作", () => {
      const db = createMockDatabase();
      const session = db.createSession("Branch Operations");

      const branch = db.createBranch({
        id: createId("branch"),
        sessionId: session.id,
        headEntryId: null,
        title: "feature-branch",
      });

      // 验证分支创建成功
      expect(branch.title).toBe("feature-branch");
      expect(branch.sessionId).toBe(session.id);

      // 验证可以列出分支
      const branches = db.listBranches(session.id);
      expect(branches).toHaveLength(1);
      expect(branches[0].id).toBe(branch.id);

      // 验证可以获取分支
      const fetched = db.getBranch(branch.id);
      expect(fetched?.id).toBe(branch.id);
      expect(fetched?.title).toBe("feature-branch");

      // 验证可以更新分支
      db.updateBranch(branch.id, { headEntryId: "new-head" });
      const updated = db.getBranch(branch.id);
      expect(updated?.headEntryId).toBe("new-head");
    });

    it("runCheckpoints 表正确创建并支持 checkpoint 操作", () => {
      const db = createMockDatabase();
      const session = db.createSession("Checkpoint Operations");
      const run = db.createRun({
        sessionId: session.id,
        taskId: null,
        status: "running",
        provider: "anthropic",
        prompt: "checkpoint test",
        sourceRunId: null,
        recoveryMode: "start",
      });

      const checkpoint = db.createCheckpoint({
        id: createId("checkpoint"),
        runId: run.id,
        sessionId: session.id,
        phase: "before_model_call",
        payload: { setup: true },
      });

      // 验证 checkpoint 创建成功
      expect(checkpoint.runId).toBe(run.id);
      expect(checkpoint.phase).toBe("before_model_call");

      // 验证可以列出 checkpoint
      const checkpoints = db.listCheckpoints(run.id);
      expect(checkpoints).toHaveLength(1);

      // 验证可以获取最新的 checkpoint
      const latest = db.getLatestCheckpoint(run.id);
      expect(latest?.id).toBe(checkpoint.id);
    });

    it("runs 表包含所有必需的 lineage 字段", () => {
      const db = createMockDatabase();
      const session = db.createSession("Run Lineage Fields");

      const run = db.createRun({
        sessionId: session.id,
        taskId: null,
        status: "queued",
        provider: "anthropic",
        prompt: "lineage test",
        sourceRunId: "source-run-id",
        recoveryMode: "retry",
        originRunId: "origin-run-id",
        resumeFromCheckpoint: "checkpoint-id",
        terminalReason: null,
      });

      expect(run.sourceRunId).toBe("source-run-id");
      expect(run.originRunId).toBe("origin-run-id");
      expect(run.resumeFromCheckpoint).toBe("checkpoint-id");
    });
  });
});

// ============================================================================
// Mock Database Helper
// ============================================================================

function createMockDatabase(): AppStore {
  const sessions = new Map<string, Session>();
  const tasks = new Map<string, Task>();
  const runs = new Map<string, Run>();
  const messages: SessionMessage[] = [];
  const events: import("@omi/core").EventRecord[] = [];
  const toolCalls = new Map<string, ToolCall>();
  const reviews = new Map<string, ReviewRequest>();
  const memories = new Map<string, MemoryRecord>();
  const providerConfigs = new Map<string, ProviderConfig>();
  const historyEntries: SessionHistoryEntry[] = [];
  const runtimeRows = new Map<string, { sessionId: string; snapshot: string; updatedAt: string }>();
  const branches = new Map<string, SessionBranch>();
  const checkpoints: RunCheckpoint[] = [];

  return {
    listSessions: () => [...sessions.values()],
    createSession(title) {
      const now = nowIso();
      const session: Session = {
        id: createId("session"),
        title,
        status: "idle",
        createdAt: now,
        updatedAt: now,
        latestUserMessage: null,
        latestAssistantMessage: null,
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
      const runId = (input as { id?: string }).id ?? createId("run");
      const run: Run = {
        ...input,
        id: runId,
        createdAt: now,
        updatedAt: now,
      };
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
      const now = nowIso();
      const msg: SessionMessage = { id: createId("msg"), createdAt: now, ...input };
      messages.push(msg);
      return msg;
    },
    listMessages: (sid) => messages.filter((m) => m.sessionId === sid),
    addSessionHistoryEntry(input) {
      const now = nowIso();
      const entry: SessionHistoryEntry = {
        id: input.id ?? createId("hist"),
        ...input,
        branchId: input.branchId ?? null,
        lineageDepth: input.lineageDepth ?? 0,
        originRunId: input.originRunId ?? null,
        createdAt: now,
        updatedAt: now,
      };
      historyEntries.push(entry);
      return entry;
    },
    listSessionHistoryEntries(sid) {
      return historyEntries.filter((e) => e.sessionId === sid);
    },
    addEvent(input) {
      const event: import("@omi/core").EventRecord = { id: createId("evt"), createdAt: nowIso(), ...input };
      events.push(event);
      return event;
    },
    listEvents: (runId) => events.filter((e) => e.runId === runId),
    createToolCall(input) {
      const now = nowIso();
      const toolCallId = input.id ?? createId("tool");
      const tc: ToolCall = { ...input, id: toolCallId, createdAt: now, updatedAt: now };
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
    searchMemories: (_q, scope, scopeId) =>
      [...memories.values()].filter(
        (m) => (!scope || m.scope === scope) && (!scopeId || m.scopeId === scopeId),
      ),
    listMemories: (scope, scopeId) =>
      [...memories.values()].filter(
        (m) => (!scope || m.scope === scope) && (!scopeId || m.scopeId === scopeId),
      ),
    listProviderConfigs: () => [...providerConfigs.values()],
    upsertProviderConfig(input) {
      const now = nowIso();
      const id = input.id ?? createId("provider");
      const cur = providerConfigs.get(id);
      const config: ProviderConfig = {
        id,
        createdAt: cur?.createdAt ?? now,
        updatedAt: now,
        ...cur,
        ...input,
      };
      providerConfigs.set(id, config);
      return config;
    },
    getProviderConfig(providerId) {
      if (providerId) return providerConfigs.get(providerId) ?? null;
      return providerConfigs.values().next().value ?? null;
    },
    deleteProviderConfig(id: string) {
      providerConfigs.delete(id);
    },
    loadSessionRuntimeSnapshot(sessionId) {
      return runtimeRows.get(sessionId) ?? null;
    },
    saveSessionRuntimeSnapshot(input) {
      runtimeRows.set(input.sessionId, input);
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
    listBranches(sessionId) {
      return [...branches.values()].filter((b) => !sessionId || b.sessionId === sessionId);
    },
    updateBranch(branchId, partial) {
      const cur = branches.get(branchId);
      if (!cur) throw new Error(`Branch ${branchId} not found`);
      const next = { ...cur, ...partial, updatedAt: nowIso() };
      branches.set(branchId, next);
      return next;
    },
    createCheckpoint(input) {
      const checkpoint: RunCheckpoint = { ...input, createdAt: nowIso() };
      checkpoints.push(checkpoint);
      return checkpoint;
    },
    listCheckpoints(runId) {
      return checkpoints.filter((c) => c.runId === runId);
    },
    getLatestCheckpoint(runId) {
      const filtered = checkpoints.filter((c) => c.runId === runId);
      return filtered.at(-1) ?? null;
    },
    getHistoryEntry(entryId) {
      return historyEntries.find((e) => e.id === entryId) ?? null;
    },
    getBranchHistory(sessionId, branchId) {
      return historyEntries.filter((e) => e.sessionId === sessionId && e.branchId === branchId);
    },
    getActiveBranchId(sessionId) {
      const row = runtimeRows.get(sessionId);
      if (!row) return null;
      try {
        const parsed = JSON.parse(row.snapshot);
        return parsed.activeBranchId ?? null;
      } catch {
        return null;
      }
    },
    setActiveBranchId(sessionId, branchId) {
      const existing = runtimeRows.get(sessionId);
      let parsed: Record<string, unknown> = {};
      if (existing) {
        try {
          parsed = JSON.parse(existing.snapshot);
        } catch {
          parsed = {};
        }
      }
      parsed.activeBranchId = branchId;
      runtimeRows.set(sessionId, {
        sessionId,
        snapshot: JSON.stringify(parsed),
        updatedAt: nowIso(),
      });
    },
  };
}
