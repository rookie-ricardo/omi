import { describe, expect, it, vi } from "vitest";

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
import type { AppStore } from "@omi/store";
import { createId, nowIso } from "@omi/core";

import { AgentSession, AppOrchestrator, SessionManager, type RunnerEventEnvelope } from "../src/index";
import type { ResourceLoader } from "../src/resource-loader";

describe("orchestrator", () => {
  it("saves provider configs inside the application database", () => {
    const database = createMemoryDatabase();
    const orchestrator = new AppOrchestrator(database, process.cwd(), () => {});

    const config = orchestrator.saveProviderConfig({
      type: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-5.4",
      apiKey: "sk-test",
    });

    expect(config.type).toBe("openai");
    expect(config.name).toBe("OpenAI");
    expect(config.baseUrl).toBe("https://api.openai.com/v1");
    expect(config.apiKey).toBe("sk-test");
    expect(config.model).toBe("gpt-5.4");
  });

  it("delegates run execution to an AgentSession instance", async () => {
    const database = createMemoryDatabase();
    const events: RunnerEventEnvelope[] = [];
    const sessionManager = new SessionManager();
    const startRun = vi.fn(() => ({
      id: "run_1",
      sessionId: "session_1",
      taskId: null,
      status: "queued",
      provider: "anthropic",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    } satisfies Run));
    const fakeAgentSession = {
      startRun,
      cancelRun: vi.fn(),
      approveTool: vi.fn(),
      rejectTool: vi.fn(),
      compactSession: vi.fn(async () => ({
        sessionId: "session_1",
        runtime: {
          sessionId: "session_1",
          activeRunId: null,
          pendingRunIds: [],
          queuedRuns: [],
          blockedRunId: null,
          blockedToolCallId: null,
          pendingApprovalToolCallIds: [],
          interruptedRunIds: [],
          selectedProviderConfigId: null,
          lastUserPrompt: null,
          lastAssistantResponse: null,
          lastActivityAt: nowIso(),
          compaction: {
            status: "completed",
            reason: null,
            requestedAt: null,
            updatedAt: nowIso(),
            lastSummary: {
              version: 1,
              goal: "summary",
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
            lastCompactedAt: nowIso(),
            error: null,
          },
        },
        summary: {
          version: 1,
          goal: "summary",
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
      })),
    } as unknown as AgentSession;

    const orchestrator = new AppOrchestrator(
      database,
      process.cwd(),
      (event) => events.push(event),
      undefined,
      sessionManager,
      undefined,
      () => fakeAgentSession,
    );

    const session = orchestrator.createSession("Test");
    database.upsertProviderConfig({
      name: "Anthropic",
      type: "anthropic",
      baseUrl: "https://api.anthropic.com",
      apiKey: "test-anthropic-key",
      model: "claude-sonnet-4-20250514",
    });
    const run = orchestrator.startRun({
      sessionId: session.id,
      taskId: null,
      prompt: "show me git diff",
    });

    expect(run.id).toBe("run_1");
    expect(startRun).toHaveBeenCalledOnce();
    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: null,
        prompt: "show me git diff",
        providerConfig: expect.objectContaining({ type: "anthropic" }),
      }),
    );
    expect(events).toHaveLength(0);
    expect(orchestrator.getSessionRuntimeState(session.id)).toMatchObject({
      sessionId: session.id,
      activeRunId: null,
      pendingRunIds: [],
      blockedToolCallId: null,
      interruptedRunIds: [],
      compaction: {
        status: "idle",
      },
    });

    const compacted = await orchestrator.compactSession(session.id);
    expect(compacted.sessionId).toBe("session_1");
    expect(compacted.summary.goal).toBe("summary");
  });

  it("restores blocked approvals from DB records without a runtime snapshot", () => {
    const database = createMemoryDatabase();
    const session = database.createSession("Blocked");
    const run = database.createRun({
      sessionId: session.id,
      taskId: null,
      status: "blocked",
      provider: "anthropic",
    });
    database.updateSession(session.id, {
      status: "blocked",
      latestUserMessage: "inspect workspace",
    });
    const toolCall = database.createToolCall({
      id: createId("tool"),
      runId: run.id,
      sessionId: session.id,
      taskId: null,
      toolName: "extension_tool",
      approvalState: "pending",
      input: { value: "ping" },
      output: null,
      error: null,
    });
    const orchestrator = new AppOrchestrator(database, process.cwd(), () => {});

    expect(orchestrator.getSessionRuntimeState(session.id)).toMatchObject({
      sessionId: session.id,
      activeRunId: null,
      blockedRunId: run.id,
      blockedToolCallId: toolCall.id,
      pendingApprovalToolCallIds: [toolCall.id],
      interruptedRunIds: [],
      pendingRunIds: [],
    });
  });

  it("downgrades running runs to interrupted instead of auto-resuming", () => {
    const database = createMemoryDatabase();
    const session = database.createSession("Interrupted");
    const run = database.createRun({
      sessionId: session.id,
      taskId: null,
      status: "running",
      provider: "anthropic",
    });
    database.updateSession(session.id, {
      status: "running",
      latestUserMessage: "run long task",
    });
    const orchestrator = new AppOrchestrator(database, process.cwd(), () => {});

    expect(orchestrator.getSessionRuntimeState(session.id)).toMatchObject({
      sessionId: session.id,
      activeRunId: null,
      interruptedRunIds: [run.id],
      blockedToolCallId: null,
      blockedRunId: null,
      pendingApprovalToolCallIds: [],
      pendingRunIds: [],
    });
  });

  it("does not mark canceled runs as interrupted", () => {
    const database = createMemoryDatabase();
    const session = database.createSession("Canceled");
    database.createRun({
      sessionId: session.id,
      taskId: null,
      status: "canceled",
      provider: "anthropic",
    });
    database.updateSession(session.id, {
      status: "canceled",
      latestUserMessage: "cancel it",
    });
    const orchestrator = new AppOrchestrator(database, process.cwd(), () => {});

    expect(orchestrator.getSessionRuntimeState(session.id)).toMatchObject({
      sessionId: session.id,
      activeRunId: null,
      interruptedRunIds: [],
      blockedToolCallId: null,
      blockedRunId: null,
      pendingApprovalToolCallIds: [],
    });
  });

  it("lists tool calls and pending approvals through the orchestrator API", () => {
    const database = createMemoryDatabase();
    const session = database.createSession("Queries");
    const run = database.createRun({
      sessionId: session.id,
      taskId: null,
      status: "blocked",
      provider: "anthropic",
    });
    const pendingCall = database.createToolCall({
      id: createId("tool"),
      runId: run.id,
      sessionId: session.id,
      taskId: null,
      toolName: "read",
      approvalState: "pending",
      input: { path: "src/index.ts" },
      output: null,
      error: null,
    });
    const approvedCall = database.createToolCall({
      id: createId("tool"),
      runId: run.id,
      sessionId: session.id,
      taskId: null,
      toolName: "search",
      approvalState: "approved",
      input: { query: "agent" },
      output: { matches: [] },
      error: null,
    });
    const sessionManager = new SessionManager();
    sessionManager.getOrCreate(session.id).blockOnTool(run.id, pendingCall.id);
    const orchestrator = new AppOrchestrator(database, process.cwd(), () => {}, undefined, sessionManager);

    expect(orchestrator.listToolCalls(session.id)).toMatchObject({
      sessionId: session.id,
      toolCalls: [
        expect.objectContaining({ id: pendingCall.id, toolName: "read" }),
        expect.objectContaining({ id: approvedCall.id, toolName: "search" }),
      ],
    });

    expect(orchestrator.listPendingToolCalls(session.id)).toMatchObject({
      sessionId: session.id,
      runtime: expect.objectContaining({
        sessionId: session.id,
        blockedRunId: run.id,
        blockedToolCallId: pendingCall.id,
      }),
      pendingToolCalls: [expect.objectContaining({ id: pendingCall.id })],
    });
  });

  it("lists session history and continues from a selected historical entry", () => {
    const database = createMemoryDatabase();
    database.upsertProviderConfig({
      name: "Anthropic",
      type: "anthropic",
      baseUrl: "https://api.anthropic.com",
      apiKey: "test-anthropic-key",
      model: "claude-sonnet-4-20250514",
    });
    const addSessionHistoryEntry = database.addSessionHistoryEntry!;
    const session = database.createSession("History");
    const rootEntry = addSessionHistoryEntry({
      sessionId: session.id,
      parentId: null,
      kind: "message",
      messageId: "msg_root",
      summary: null,
      details: null,
      branchId: null,
      lineageDepth: 0,
      originRunId: null,
    });
    const branchEntry = addSessionHistoryEntry({
      sessionId: session.id,
      parentId: rootEntry.id,
      kind: "branch_summary",
      messageId: null,
      summary: "Branch checkpoint",
      details: { source: "test" },
      branchId: null,
      lineageDepth: 1,
      originRunId: null,
    });
    const historyEntries = [rootEntry, branchEntry];
    const startRun = vi.fn(() => ({
      id: "run_branch",
      sessionId: session.id,
      taskId: null,
      status: "queued",
      provider: "anthropic",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    } satisfies Run));
    const fakeAgentSession = {
      startRun: vi.fn(),
      continueFromHistoryEntry: startRun,
      cancelRun: vi.fn(),
      approveTool: vi.fn(),
      rejectTool: vi.fn(),
      retryRun: vi.fn(),
      resumeRun: vi.fn(),
      compactSession: vi.fn(),
    } as unknown as AgentSession;

    const orchestrator = new AppOrchestrator(
      database,
      process.cwd(),
      () => {},
      undefined,
      new SessionManager(),
      undefined,
      () => fakeAgentSession,
    );

    expect(orchestrator.listSessionHistory(session.id)).toMatchObject({
      sessionId: session.id,
      historyEntries,
    });

    const run = orchestrator.continueFromHistoryEntry({
      sessionId: session.id,
      historyEntryId: rootEntry.id,
      taskId: null,
      prompt: "continue",
      checkpointSummary: "Branch checkpoint",
      checkpointDetails: { source: "test" },
    });

    expect(run.id).toBe("run_branch");
    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        historyEntryId: rootEntry.id,
        checkpointSummary: "Branch checkpoint",
        checkpointDetails: { source: "test" },
      }),
    );
  });

  it("lists extensions and built-in models through the orchestrator API", async () => {
    const database = createMemoryDatabase();
    database.upsertProviderConfig({
      name: "Model A",
      type: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-openai-key",
      model: "gpt-4.1-mini",
    });

    const reload = vi.fn(async () => {});
    const resourceLoader = {
      workspaceRoot: process.cwd(),
      agentDir: "/tmp/.omi",
      reload,
      getProjectContextFiles: () => [],
      listSkills: async () => [],
      searchSkills: async () => [],
      resolveSkillForPrompt: async () => null,
      buildSystemPrompt: () => "",
      getPrompts: () => ({ items: [], diagnostics: [] }),
      getThemes: () => ({ items: [], diagnostics: [] }),
      getExtensions: () => ({
        items: [
          {
            name: "workspace-extension",
            setup: vi.fn(),
            beforeRun: vi.fn(),
            onEvent: vi.fn(),
          },
        ],
        diagnostics: ["missing manifest"],
      }),
    } satisfies ResourceLoader;

    const orchestrator = new AppOrchestrator(
      database,
      process.cwd(),
      () => {},
      resourceLoader,
    );

    await expect(orchestrator.listExtensions()).resolves.toMatchObject({
      workspaceRoot: process.cwd(),
      diagnostics: ["missing manifest"],
      extensions: [
        expect.objectContaining({
          name: "workspace-extension",
          hasSetup: true,
          hasBeforeRun: true,
          hasOnEvent: true,
        }),
      ],
    });
    expect(reload).toHaveBeenCalledOnce();

    expect(orchestrator.listModels()).toMatchObject({
      providerConfigs: [
        expect.objectContaining({
          type: "openai",
          model: "gpt-4.1-mini",
        }),
      ],
      builtInProviders: expect.any(Array),
    });
  });

  it("switches the runtime provider config for future runs", () => {
    const database = createMemoryDatabase();
    const session = database.createSession("Model switch");
    const primaryConfig = database.upsertProviderConfig({
      name: "Anthropic",
      type: "anthropic",
      baseUrl: "https://api.anthropic.com",
      apiKey: "test-anthropic-key",
      model: "claude-sonnet-4-20250514",
    });
    const switchedConfig = database.upsertProviderConfig({
      name: "OpenAI",
      type: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-openai-key",
      model: "gpt-4.1-mini",
    });
    const sessionManager = new SessionManager();
    const startRun = vi.fn(() => ({
      id: "run_1",
      sessionId: session.id,
      taskId: null,
      status: "queued",
      provider: "openai",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    } satisfies Run));
    const fakeAgentSession = {
      startRun,
      cancelRun: vi.fn(),
      approveTool: vi.fn(),
      rejectTool: vi.fn(),
      retryRun: vi.fn(),
      resumeRun: vi.fn(),
    } as unknown as AgentSession;

    const orchestrator = new AppOrchestrator(
      database,
      process.cwd(),
      () => {},
      undefined,
      sessionManager,
      undefined,
      () => fakeAgentSession,
    );

    const switched = orchestrator.switchModel(session.id, switchedConfig.id);
    expect(switched.runtime.selectedProviderConfigId).toBe(switchedConfig.id);

    orchestrator.startRun({
      sessionId: session.id,
      taskId: null,
      prompt: "use the switched provider",
    });

    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        providerConfig: expect.objectContaining({
          id: switchedConfig.id,
          type: "openai",
        }),
      }),
    );
    expect(sessionManager.getOrCreate(session.id).snapshot().selectedProviderConfigId).toBe(
      switchedConfig.id,
    );
    expect(primaryConfig.id).not.toBe(switchedConfig.id);
  });
});

function createMemoryDatabase(): AppStore {
  const sessions = new Map<string, Session>();
  const tasks = new Map<string, Task>();
  const runs = new Map<string, Run>();
  const messages: SessionMessage[] = [];
  const events: EventRecord[] = [];
  const toolCalls = new Map<string, ToolCall>();
  const reviews = new Map<string, ReviewRequest>();
  const memories = new Map<string, MemoryRecord>();
  const historyEntries: SessionHistoryEntry[] = [];
  const runtimeRows = new Map<string, { sessionId: string; snapshot: string; updatedAt: string }>();
  const providerConfigs = new Map<string, ProviderConfig>();
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
    getSession: (sessionId) => sessions.get(sessionId) ?? null,
    updateSession(sessionId, partial) {
      const current = sessions.get(sessionId);
      if (!current) {
        throw new Error(`Session ${sessionId} not found`);
      }
      const next = { ...current, ...partial, updatedAt: nowIso() };
      sessions.set(sessionId, next);
      return next;
    },
    listTasks: () => [...tasks.values()],
    createTask(input) {
      const now = nowIso();
      const task: Task = {
        id: createId("task"),
        createdAt: now,
        updatedAt: now,
        ...input,
      };
      tasks.set(task.id, task);
      return task;
    },
    getTask: (taskId) => tasks.get(taskId) ?? null,
    updateTask(taskId, partial) {
      const current = tasks.get(taskId);
      if (!current) {
        throw new Error(`Task ${taskId} not found`);
      }
      const next = { ...current, ...partial, updatedAt: nowIso() };
      tasks.set(taskId, next);
      return next;
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
    listRuns: (sessionId?: string) =>
      [...runs.values()].filter((run) => (!sessionId || run.sessionId === sessionId)),
    updateRun(runId, partial) {
      const current = runs.get(runId);
      if (!current) {
        throw new Error(`Run ${runId} not found`);
      }
      const next = { ...current, ...partial, updatedAt: nowIso() };
      runs.set(runId, next);
      return next;
    },
    getRun: (runId) => runs.get(runId) ?? null,
    addMessage(input) {
      const message: SessionMessage = {
        id: createId("msg"),
        createdAt: nowIso(),
        ...input,
      };
      messages.push(message);
      return message;
    },
    listMessages: (sessionId) => messages.filter((message) => message.sessionId === sessionId),
    addSessionHistoryEntry(input) {
      const now = nowIso();
      const entry: SessionHistoryEntry = {
        id: input.id ?? createId("hist"),
        sessionId: input.sessionId,
        parentId: input.parentId,
        kind: input.kind,
        messageId: input.messageId,
        summary: input.summary,
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
    listSessionHistoryEntries: (sessionId) =>
      historyEntries.filter((entry) => entry.sessionId === sessionId),
    addEvent(input) {
      const event: EventRecord = {
        id: createId("evt"),
        createdAt: nowIso(),
        ...input,
      };
      events.push(event);
      return event;
    },
    listEvents: (runId) => events.filter((event) => event.runId === runId),
    createToolCall(input) {
      const toolCall: ToolCall = {
        id: input.id ?? createId("tool"),
        createdAt: nowIso(),
        updatedAt: nowIso(),
        runId: input.runId,
        sessionId: input.sessionId,
        taskId: input.taskId,
        toolName: input.toolName,
        approvalState: input.approvalState,
        input: input.input,
        output: input.output,
        error: input.error,
      };
      toolCalls.set(toolCall.id, toolCall);
      return toolCall;
    },
    updateToolCall(toolCallId, partial) {
      const current = toolCalls.get(toolCallId);
      if (!current) {
        throw new Error(`Tool call ${toolCallId} not found`);
      }
      const next = { ...current, ...partial, updatedAt: nowIso() };
      toolCalls.set(toolCallId, next);
      return next;
    },
    getToolCall: (toolCallId) => toolCalls.get(toolCallId) ?? null,
    listToolCalls: (runId) => [...toolCalls.values()].filter((toolCall) => toolCall.runId === runId),
    listToolCallsBySession: (sessionId) =>
      [...toolCalls.values()]
        .filter((toolCall) => toolCall.sessionId === sessionId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    createReviewRequest(input) {
      const now = nowIso();
      const review: ReviewRequest = {
        id: createId("review"),
        createdAt: now,
        updatedAt: now,
        ...input,
      };
      reviews.set(review.id, review);
      return review;
    },
    updateReviewRequest(reviewId, partial) {
      const current = reviews.get(reviewId);
      if (!current) {
        throw new Error(`Review request ${reviewId} not found`);
      }
      const next = { ...current, ...partial, updatedAt: nowIso() };
      reviews.set(reviewId, next);
      return next;
    },
    listReviewRequests: (taskId) =>
      [...reviews.values()].filter((review) => (taskId ? review.taskId === taskId : true)),
    writeMemory(input) {
      const now = nowIso();
      const memory: MemoryRecord = {
        id: createId("memory"),
        createdAt: now,
        updatedAt: now,
        ...input,
      };
      memories.set(memory.id, memory);
      return memory;
    },
    searchMemories: () => [...memories.values()],
    listMemories: () => [...memories.values()],
    listProviderConfigs: () => [...providerConfigs.values()],
    upsertProviderConfig(input) {
      const now = nowIso();
      const current = input.id ? providerConfigs.get(input.id) : undefined;
      const id = current?.id ?? input.id ?? createId("provider");
      const config: ProviderConfig = {
        id,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
        ...current,
        ...input,
      };
      providerConfigs.set(config.id, config);
      return config;
    },
    getProviderConfig(providerId) {
      if (providerId) {
        return providerConfigs.get(providerId) ?? null;
      }
      return providerConfigs.values().next().value ?? null;
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
}
