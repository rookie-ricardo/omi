/**
 * Tool & Permission 基线回归测试
 *
 * 覆盖 P0 能力：
 * - 工具调用完整生命周期（requested -> started -> finished）
 * - 工具审批流程（approve/reject）
 * - 工具审批状态持久化
 * - 审批阻塞与恢复
 */

import { describe, it, expect } from "vitest";
import type { ProviderRunInput, ProviderRunResult } from "@omi/provider";
import { AgentSession, SessionManager } from "../../src/index";
import type { ResourceLoader } from "../../src/index";
import type { AppStore } from "@omi/store";
import type {
  EventRecord, MemoryRecord, ProviderConfig, ReviewRequest, RunCheckpoint,
  Run, Session, SessionBranch, SessionHistoryEntry, SessionMessage, Task, ToolCall,
} from "@omi/core";
import { createId, nowIso } from "@omi/core";
import { requiresApproval, isBuiltInTool, createAllTools } from "@omi/tools";

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

function makeProviderConfig(): ProviderConfig {
  const now = nowIso();
  return {
    id: createId("provider"), name: "anthropic", url: "", protocol: "anthropic-messages",
    baseUrl: "https://api.anthropic.com", apiKey: "test-key",
    model: "claude-sonnet-4-20250514", createdAt: now, updatedAt: now,
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
  const checkpoints: RunCheckpoint[] = [];
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
      return branch;
    },
    getBranch() { return null; },
    listBranches() { return []; },
    updateBranch() { throw new Error("Not implemented"); },
    createCheckpoint(input) {
      const cp: RunCheckpoint = { ...input, createdAt: nowIso() };
      checkpoints.push(cp);
      return cp;
    },
    listCheckpoints(runId) {
      return checkpoints.filter((checkpoint) => checkpoint.runId === runId);
    },
    getLatestCheckpoint(runId) {
      return checkpoints.filter((checkpoint) => checkpoint.runId === runId).at(-1) ?? null;
    },
    getHistoryEntry() { return null; },
    getBranchHistory() { return []; },
    getActiveBranchId() { return null; },
    setActiveBranchId() {},
  };
}

describe("Tool & Permission baseline", () => {
  it("built-in tools have correct approval policy", () => {
    expect(requiresApproval("bash")).toBe(true);
    expect(requiresApproval("edit")).toBe(true);
    expect(requiresApproval("write")).toBe(true);
    expect(requiresApproval("read")).toBe(false);
    expect(requiresApproval("ls")).toBe(false);
    expect(requiresApproval("grep")).toBe(false);
    expect(requiresApproval("glob")).toBe(false);
  });

  it("all built-in tools are recognized", () => {
    expect(isBuiltInTool("read")).toBe(true);
    expect(isBuiltInTool("bash")).toBe(true);
    expect(isBuiltInTool("edit")).toBe(true);
    expect(isBuiltInTool("write")).toBe(true);
    expect(isBuiltInTool("ls")).toBe(true);
    expect(isBuiltInTool("grep")).toBe(true);
    expect(isBuiltInTool("glob")).toBe(true);
    expect(isBuiltInTool("unknown")).toBe(false);
  });

  // TODO: 重写此测试 — 工具执行和审批流已从 Provider 迁移到 QueryEngine
  it.skip("tool call lifecycle: requested -> started -> finished with approval", async () => {
    const db = createMemoryDatabase();
    const session = db.createSession("ToolLifecycle");
    const runtime = new SessionManager().getOrCreate(session.id);
    const providerConfig = db.upsertProviderConfig(makeProviderConfig());
    runtime.setSelectedProviderConfig(providerConfig.id);
    let latestToolCallId: string | null = null;
    let gateResolve!: () => void;
    const gate = new Promise<void>((r) => { gateResolve = r; });
    let onToolDecision: ((id: string, d: "approved" | "rejected") => void) | null = null;

    const provider = {
      async run(input: ProviderRunInput): Promise<ProviderRunResult> {
        const anyInput = input as any;
        onToolDecision = anyInput.onToolDecision ?? null;
        const tcId = (await anyInput.onToolRequested?.({
          runId: input.runId, sessionId: input.sessionId,
          toolCallId: "tc-1",
          toolName: "bash", input: { command: "echo" }, requiresApproval: true,
        })) ?? "tc-1";
        latestToolCallId = tcId;
        await gate;
        anyInput.onToolStarted?.(tcId, "bash");
        anyInput.onToolFinished?.(tcId, "bash", { ok: true }, false);
        return { assistantText: "tool done", assistantMessage: null, stopReason: "end_turn" as const, usage: { inputTokens: 0, outputTokens: 0 }, error: null };
      },
      cancel() {},
    };

    const agentSession = new AgentSession({
      database: db, sessionId: session.id, workspaceRoot: process.cwd(),
      emit: () => {}, resources: makeStaticResources(), runtime, provider,
    });

    const run = agentSession.startRun({ prompt: "run bash", providerConfig, taskId: null });
    await waitFor(() => latestToolCallId !== null);
    expect(latestToolCallId).not.toBeNull();

    agentSession.approveTool(latestToolCallId!);
    await waitFor(() => db.getRun(run.id)?.status === "completed");

    const toolCall = db.getToolCall(latestToolCallId!);
    expect(toolCall?.approvalState).toBe("approved");
    const eventTypes = db.listEvents(run.id).map((event) => event.type);
    expect(eventTypes).toEqual(expect.arrayContaining([
      "query_loop.transition",
      "run.started",
      "run.tool_requested",
      "run.blocked",
      "run.tool_started",
      "run.tool_finished",
      "run.tool_decided",
      "run.completed",
    ]));
  });

  // TODO: 重写此测试 — 工具执行和审批流已从 Provider 迁移到 QueryEngine
  it.skip("tool rejection cancels the run", async () => {
    const db = createMemoryDatabase();
    const session = db.createSession("ToolReject");
    const runtime = new SessionManager().getOrCreate(session.id);
    const providerConfig = db.upsertProviderConfig(makeProviderConfig());
    runtime.setSelectedProviderConfig(providerConfig.id);
    let latestToolCallId: string | null = null;
    let gateResolve!: () => void;
    const gate = new Promise<void>((r) => { gateResolve = r; });
    let onToolDecision: ((id: string, d: "approved" | "rejected") => void) | null = null;

    const provider = {
      async run(input: ProviderRunInput): Promise<ProviderRunResult> {
        const anyInput = input as any;
        onToolDecision = anyInput.onToolDecision ?? null;
        const tcId = (await anyInput.onToolRequested?.({
          runId: input.runId, sessionId: input.sessionId,
          toolCallId: "tc-2",
          toolName: "bash", input: { command: "rm" }, requiresApproval: true,
        })) ?? "tc-2";
        latestToolCallId = tcId;
        await gate;
        throw new Error("Should not reach here");
      },
      cancel() {},
    };

    const agentSession = new AgentSession({
      database: db, sessionId: session.id, workspaceRoot: process.cwd(),
      emit: () => {},
      resources: makeStaticResources(), runtime, provider,
    });

    const run = agentSession.startRun({ prompt: "dangerous", providerConfig, taskId: null });
    await waitFor(() => latestToolCallId !== null);
    agentSession.rejectTool(latestToolCallId!);
    await waitFor(() => db.getRun(run.id)?.status === "canceled");

    expect(db.getRun(run.id)?.status).toBe("canceled");
  });

  it("createAllTools returns the WS-06 built-in tool surface", () => {
    const tools = createAllTools(process.cwd());
    const names = Object.keys(tools).sort();
    expect(names).toEqual([
      "ask_user",
      "bash",
      "bash_background",
      "config.read",
      "config.write",
      "cron.create",
      "cron.delete",
      "cron.list",
      "discover_skills",
      "edit",
      "enter_worktree",
      "exit_worktree",
      "glob",
      "grep",
      "ls",
      "mcp.prompt.eval",
      "mcp.prompt.list",
      "mcp.resource.list",
      "mcp.resource.read",
      "monitor",
      "notebook_edit",
      "plan.enter",
      "plan.exit",
      "read",
      "remote_trigger",
      "skill",
      "subagent.close",
      "subagent.delegate",
      "subagent.get",
      "subagent.list",
      "subagent.send",
      "subagent.spawn",
      "subagent.wait",
      "task.create",
      "task.get",
      "task.list",
      "task.output",
      "task.stop",
      "task.update",
      "team.create",
      "team.delete",
      "todo.read",
      "todo.write",
      "tool.search",
      "web.browser",
      "web.fetch",
      "web.search",
      "write",
    ]);
  });
});
