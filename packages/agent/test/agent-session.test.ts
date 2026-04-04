import { describe, expect, it } from "vitest";
import type { ImageContent, TextContent } from "@mariozechner/pi-ai";

import type {
  EventRecord,
  MemoryRecord,
  ProviderConfig,
  ResolvedSkill,
  ReviewRequest,
  Run,
  RunCheckpoint,
  Session,
  SessionBranch,
  SessionHistoryEntry,
  SessionMessage,
  SkillDescriptor,
  Task,
  ToolCall,
} from "@omi/core";
import type { AppStore } from "@omi/store";
import { createId, nowIso } from "@omi/core";
import { createRuntimeCustomMessage, type CompactionSummaryDocument } from "@omi/memory";
import type { ExtensionDefinition } from "@omi/extensions";
import type { ProviderRunInput, ProviderRunResult } from "@omi/provider";

import {
  AgentSession,
  createDatabaseSessionRuntimeStore,
  SessionManager,
  SessionRuntime,
  type ResourceLoader,
  type RunnerEventEnvelope,
} from "../src/index";

describe("agent session", () => {
  it("runs a prompt independent of orchestrator and persists lifecycle state", async () => {
    const database = createMemoryDatabase();
    const session = database.createSession("Session");
    const runtime = new SessionManager().getOrCreate(session.id);
    const events: RunnerEventEnvelope[] = [];
    const providerCalls: ProviderRunInput[] = [];
    const extensionEvents: string[] = [];
    let resourcesReloaded = 0;
    const extension: ExtensionDefinition = {
      name: "session-extension",
      beforeRun(input, context) {
        context.appendSystemPrompt(`Extension prompt for ${input.sessionId}`);
        context.appendRuntimeMessage(
          createRuntimeCustomMessage("extension-note", "Extension runtime note", true, undefined, 1),
        );
      },
      onEvent(event) {
        extensionEvents.push(event.type);
      },
    };
    const provider = {
      async run(input: ProviderRunInput): Promise<ProviderRunResult> {
        providerCalls.push(input);
        input.onTextDelta?.("hello");
        const toolCallId =
          (await input.onToolRequested?.({
            runId: input.runId,
            sessionId: input.sessionId,
            toolCallId: "tool-call-1",
            toolName: "read",
            input: { path: "README.md" },
            requiresApproval: false,
          })) ?? "tool-call-1";
        input.onToolStarted?.(toolCallId, "read");
        input.onToolFinished?.(toolCallId, "read", { ok: true }, false);
        return { assistantText: "done" };
      },
      cancel() {},
      approveTool() {},
      rejectTool() {},
    };
    const resources: ResourceLoader = {
      workspaceRoot: process.cwd(),
      agentDir: "/tmp/.omi",
      async reload() {
        resourcesReloaded += 1;
      },
      getProjectContextFiles: () => [],
      listSkills: async () => [],
      searchSkills: async () => [
        {
          ...makeSkill("Git Inspector"),
          score: 9,
          diagnostics: [],
        },
      ],
      resolveSkillForPrompt: async () =>
        ({
          skill: makeSkill("Git Inspector"),
          score: 9,
          injectedPrompt: "Activated skill: Git Inspector",
          enabledToolNames: ["bash"],
          referencedFiles: [],
          diagnostics: [],
        }) satisfies ResolvedSkill,
      buildSystemPrompt: (resolvedSkill) =>
        resolvedSkill ? `System prompt\n\n${resolvedSkill.injectedPrompt}` : "",
      getPrompts: () => ({ items: [], diagnostics: [] }),
      getThemes: () => ({ items: [], diagnostics: [] }),
      getExtensions: () => ({ items: [extension], diagnostics: [] }),
    };
    const providerConfig: ProviderConfig = {
      id: createId("provider"),
      name: "Default anthropic",
      type: "anthropic",
      protocol: "anthropic-messages",
      baseUrl: "https://api.anthropic.com",
      apiKey: "test-anthropic-key",
      model: "claude-sonnet-4-20250514",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    const storedProviderConfig = database.upsertProviderConfig(providerConfig);
    runtime.setSelectedProviderConfig(storedProviderConfig.id);

    const agentSession = new AgentSession({
      database,
      sessionId: session.id,
      workspaceRoot: process.cwd(),
      emit: (event) => events.push(event),
      resources,
      runtime,
      provider,
    });

    const run = agentSession.startRun({
      prompt: "show me git diff",
      providerConfig,
      taskId: null,
    });

    await waitFor(() => database.getRun(run.id)?.status === "completed");

    expect(resourcesReloaded).toBe(1);
    expect(providerCalls).toHaveLength(1);
    expect(providerCalls[0]?.systemPrompt).toContain("Activated skill: Git Inspector");
    expect(providerCalls[0]?.systemPrompt).toContain(`Extension prompt for ${session.id}`);
    expect(providerCalls[0]?.prompt).toContain("extension-note: Extension runtime note");
    expect(providerCalls[0]?.prompt).toContain("show me git diff");
    expect(providerCalls[0]?.enabledTools).toEqual(["bash"]);
    expect(database.getSession(session.id)?.latestUserMessage).toBe("show me git diff");
    expect(database.getSession(session.id)?.latestAssistantMessage).toBe("done");
    expect(database.listMessages(session.id).map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(events.some((event) => event.type === "run.extensions_loaded")).toBe(true);
    expect(events.some((event) => event.type === "run.skills_resolved")).toBe(true);
    expect(events.some((event) => event.type === "run.delta")).toBe(true);
    expect(events.some((event) => event.type === "run.tool_requested")).toBe(true);
    expect(events.some((event) => event.type === "run.tool_started")).toBe(true);
    expect(events.some((event) => event.type === "run.tool_finished")).toBe(true);
    const queryLoopEvents = database.listEvents(run.id).filter((event) =>
      event.type.startsWith("query_loop."),
    );
    expect(queryLoopEvents.length).toBeGreaterThan(0);
    expect(queryLoopEvents[0]?.payload).toMatchObject({
      type: "query_loop.transition",
      runId: run.id,
      sessionId: session.id,
    });
    expect(queryLoopEvents.some((event) => event.type === "query_loop.terminal")).toBe(true);
    expect(database.listToolCalls(run.id).map((toolCall) => toolCall.toolName)).toEqual(["read"]);
    expect(extensionEvents).toEqual(
      expect.arrayContaining(["run.started", "run.tool_requested", "run.tool_started", "run.tool_finished", "run.completed"]),
    );
    expect(database.listMemories("session", session.id)).toHaveLength(0);
    expect(database.loadSessionRuntimeSnapshot(session.id)).not.toBeNull();
    expect(runtime.snapshot()).toMatchObject({
      sessionId: session.id,
      activeRunId: null,
      blockedToolCallId: null,
      pendingRunIds: [],
      lastUserPrompt: "show me git diff",
      lastAssistantResponse: "done",
      compaction: {
        status: "idle",
      },
    });
  });

  it("continueFromHistoryEntry writes branch-aware history nodes onto the new branch", async () => {
    const database = createMemoryDatabase();
    const session = database.createSession("Branch-aware continuation");
    const mainBranch = database.createBranch({
      id: createId("branch"),
      sessionId: session.id,
      headEntryId: null,
      title: "main",
    });
    const baseEntry = database.addSessionHistoryEntry!({
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
    const storedProviderConfig = database.upsertProviderConfig(makeProviderConfig());
    const runtime = new SessionManager(createDatabaseSessionRuntimeStore(database), database).getOrCreate(
      session.id,
    );
    runtime.setSelectedProviderConfig(storedProviderConfig.id);
    const provider = {
      async run(): Promise<ProviderRunResult> {
        return { assistantText: "branch done" };
      },
      cancel() {},
      approveTool() {},
      rejectTool() {},
    };

    const agentSession = new AgentSession({
      database,
      sessionId: session.id,
      workspaceRoot: process.cwd(),
      emit: () => {},
      resources: makeStaticResources(),
      runtime,
      provider,
    });

    const run = agentSession.continueFromHistoryEntry({
      prompt: "follow up",
      providerConfig: storedProviderConfig,
      historyEntryId: baseEntry.id,
      checkpointSummary: "checkpoint summary",
      checkpointDetails: { stage: "before_follow_up" },
    });

    await waitFor(() => database.getRun(run.id)?.status === "completed");

    const branches = database.listBranches(session.id);
    expect(branches).toHaveLength(2);
    const continueBranch = branches[1];
    expect(runtime.snapshot().activeBranchId).toBe(continueBranch.id);
    const historyEntries = database.listSessionHistoryEntries!(session.id);
    const checkpointEntry = historyEntries.find(
      (entry) => entry.kind === "branch_summary" && entry.summary === "checkpoint summary",
    );

    expect(checkpointEntry).toMatchObject({
      parentId: baseEntry.id,
      branchId: continueBranch.id,
      originRunId: run.id,
      lineageDepth: 1,
    });
    expect(
      historyEntries.some(
        (entry) =>
          entry.kind === "message" &&
          entry.branchId === continueBranch.id &&
          entry.originRunId === run.id,
      ),
    ).toBe(true);
  });

  it("serializes queued runs within a session", async () => {
    const database = createMemoryDatabase();
    const session = database.createSession("Queued");
    const runtime = new SessionManager().getOrCreate(session.id);
    const providerConfig = database.upsertProviderConfig(makeProviderConfig());
    runtime.setSelectedProviderConfig(providerConfig.id);
    const events: RunnerEventEnvelope[] = [];
    const startedRuns: string[] = [];
    const finishedRuns: string[] = [];
    let releaseFirstRun!: () => void;
    const firstRunGate = new Promise<void>((resolve) => {
      releaseFirstRun = resolve;
    });
    let callCount = 0;
    const provider = {
      async run(input: ProviderRunInput): Promise<ProviderRunResult> {
        startedRuns.push(input.runId);
        callCount += 1;
        if (callCount === 1) {
          await firstRunGate;
        }
        finishedRuns.push(input.runId);
        return { assistantText: `done-${input.runId}` };
      },
      cancel() {},
      approveTool() {},
      rejectTool() {},
    };

    const agentSession = new AgentSession({
      database,
      sessionId: session.id,
      workspaceRoot: process.cwd(),
      emit: (event) => events.push(event),
      resources: makeStaticResources(),
      runtime,
      provider,
    });

    const firstRun = agentSession.startRun({
      prompt: "first prompt",
      providerConfig,
      taskId: null,
    });
    const secondRun = agentSession.startRun({
      prompt: "second prompt",
      providerConfig,
      taskId: null,
    });

    await waitFor(() => startedRuns.length === 1);
    expect(startedRuns).toEqual([firstRun.id]);
    expect(runtime.snapshot().pendingRunIds).toEqual([secondRun.id]);

    releaseFirstRun();
    await waitFor(() => database.getRun(firstRun.id)?.status === "completed");
    await waitFor(() => database.getRun(secondRun.id)?.status === "completed");

    expect(startedRuns).toEqual([firstRun.id, secondRun.id]);
    expect(finishedRuns).toEqual([firstRun.id, secondRun.id]);
    expect(runtime.snapshot().pendingRunIds).toEqual([]);
    expect(runtime.snapshot().queuedRuns).toEqual([]);
    expect(events.filter((event) => event.type === "run.started")).toHaveLength(2);
  });

  it("passes previous session history into the next run context", async () => {
    const database = createMemoryDatabase();
    const session = database.createSession("History");
    const runtime = new SessionManager().getOrCreate(session.id);
    const providerConfig = database.upsertProviderConfig(makeProviderConfig());
    runtime.setSelectedProviderConfig(providerConfig.id);
    const providerCalls: ProviderRunInput[] = [];
    const provider = {
      async run(input: ProviderRunInput): Promise<ProviderRunResult> {
        providerCalls.push(input);
        return { assistantText: `done-${providerCalls.length}` };
      },
      cancel() {},
      approveTool() {},
      rejectTool() {},
    };

    const agentSession = new AgentSession({
      database,
      sessionId: session.id,
      workspaceRoot: process.cwd(),
      emit: () => {},
      resources: makeStaticResources(),
      runtime,
      provider,
    });

    const firstRun = agentSession.startRun({
      prompt: "first prompt",
      providerConfig,
      taskId: null,
    });
    await waitFor(() => database.getRun(firstRun.id)?.status === "completed");

    const secondRun = agentSession.startRun({
      prompt: "second prompt",
      providerConfig,
      taskId: null,
    });
    await waitFor(() => database.getRun(secondRun.id)?.status === "completed");

    expect(providerCalls[0]?.historyMessages).toEqual([]);
    expect(
      providerCalls[1]?.historyMessages.some(
        (message) =>
          message.role === "user" &&
          messageContentContains(message.content, "first prompt"),
      ),
    ).toBe(true);
    expect(
      providerCalls[1]?.historyMessages.some(
        (message) =>
          message.role === "user" &&
          messageContentContains(message.content, "assistant: done-1"),
      ),
    ).toBe(true);
  });

  it("compacts old history into a summary and preserves later messages", async () => {
    const database = createMemoryDatabase();
    const session = database.createSession("Compaction");
    const runtime = new SessionManager().getOrCreate(session.id);
    const providerConfig = database.upsertProviderConfig(makeProviderConfig());
    runtime.setSelectedProviderConfig(providerConfig.id);
    const providerCalls: ProviderRunInput[] = [];
    const provider = {
      async run(input: ProviderRunInput): Promise<ProviderRunResult> {
        providerCalls.push(input);
        return { assistantText: `done-${providerCalls.length}` };
      },
      cancel() {},
      approveTool() {},
      rejectTool() {},
    };

    const agentSession = new AgentSession({
      database,
      sessionId: session.id,
      workspaceRoot: process.cwd(),
      emit: () => {},
      resources: makeStaticResources(),
      runtime,
      provider,
      compactionSummarizer: makeTestCompactionSummarizer(),
    });

    const firstRun = agentSession.startRun({
      prompt: "first prompt",
      providerConfig,
      taskId: null,
    });
    await waitFor(() => database.getRun(firstRun.id)?.status === "completed");

    const compaction = await agentSession.compactSession();
    expect(compaction.summary.goal).toContain("Compacted");
    expect(runtime.snapshot().compaction.status).toBe("completed");
    expect(runtime.snapshot().compaction.lastSummary).toEqual(compaction.summary);

    const secondRun = agentSession.startRun({
      prompt: "second prompt",
      providerConfig,
      taskId: null,
    });
    await waitFor(() => database.getRun(secondRun.id)?.status === "completed");

    const thirdRun = agentSession.startRun({
      prompt: "third prompt",
      providerConfig,
      taskId: null,
    });
    await waitFor(() => database.getRun(thirdRun.id)?.status === "completed");

    expect(
      providerCalls[1]?.historyMessages.some(
        (message) =>
          message.role === "user" &&
          messageContentContains(message.content, "The conversation history before this point was compacted"),
      ),
    ).toBe(true);
    expect(
      providerCalls[1]?.historyMessages.some(
        (message) =>
          message.role === "user" &&
          messageContentContains(message.content, "first prompt"),
      ),
    ).toBe(false);
    expect(
      providerCalls[2]?.historyMessages.some(
        (message) =>
          message.role === "user" &&
          messageContentContains(message.content, "second prompt"),
      ),
    ).toBe(true);
    expect(
      providerCalls[2]?.historyMessages.some(
        (message) =>
          message.role === "user" &&
          messageContentContains(message.content, "first prompt"),
      ),
    ).toBe(false);
    expect(
      providerCalls[2]?.historyMessages.some(
        (message) =>
          message.role === "user" &&
          messageContentContains(message.content, "The conversation history before this point was compacted"),
      ),
    ).toBe(true);
  });

  it("auto compacts long histories before the next run when approaching budget", async () => {
    const database = createMemoryDatabase();
    const session = database.createSession("Threshold");
    const runtime = new SessionManager().getOrCreate(session.id);
    const providerConfig = database.upsertProviderConfig(
      makeProviderConfig({
        name: "OpenAI test",
        type: "openai",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "test-openai-key",
        model: "gpt-4",
      }),
    );
    runtime.setSelectedProviderConfig(providerConfig.id);
    const providerCalls: ProviderRunInput[] = [];
    const provider = {
      async run(input: ProviderRunInput): Promise<ProviderRunResult> {
        providerCalls.push(input);
        return { assistantText: `done-${providerCalls.length}` };
      },
      cancel() {},
      approveTool() {},
      rejectTool() {},
    };

    const agentSession = new AgentSession({
      database,
      sessionId: session.id,
      workspaceRoot: process.cwd(),
      emit: () => {},
      resources: makeStaticResources(),
      runtime,
      provider,
      compactionSummarizer: makeTestCompactionSummarizer(),
    });

    const firstRun = agentSession.startRun({
      prompt: makeLargePrompt("first", 20_000),
      providerConfig,
      taskId: null,
    });
    await waitFor(() => database.getRun(firstRun.id)?.status === "completed");

    const secondRun = agentSession.startRun({
      prompt: makeLargePrompt("second", 20_000),
      providerConfig,
      taskId: null,
    });
    await waitFor(() => database.getRun(secondRun.id)?.status === "completed");

    expect(
      providerCalls[1]?.historyMessages.some(
        (message) =>
          message.role === "user" &&
          messageContentContains(message.content, "The conversation history before this point was compacted"),
      ),
    ).toBe(true);
    expect(
      providerCalls[1]?.historyMessages.some(
        (message) =>
          message.role === "user" &&
          messageContentContains(message.content, "first"),
      ),
    ).toBe(false);
    expect(runtime.snapshot().compaction.status).toBe("completed");
  });

  it("compacts and continues when the provider reports context overflow", async () => {
    const database = createMemoryDatabase();
    const session = database.createSession("Overflow");
    const runtime = new SessionManager().getOrCreate(session.id);
    const providerConfig = database.upsertProviderConfig(
      makeProviderConfig({
        name: "OpenAI test",
        type: "openai",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "test-openai-key",
        model: "gpt-4",
      }),
    );
    runtime.setSelectedProviderConfig(providerConfig.id);
    const providerCalls: ProviderRunInput[] = [];
    let shouldOverflow = true;
    const provider = {
      async run(input: ProviderRunInput): Promise<ProviderRunResult> {
        providerCalls.push(input);
        if (shouldOverflow) {
          shouldOverflow = false;
          throw new Error("prompt is too long: 99999 tokens > 8192 maximum");
        }
        return { assistantText: "recovered" };
      },
      cancel() {},
      approveTool() {},
      rejectTool() {},
    };

    const agentSession = new AgentSession({
      database,
      sessionId: session.id,
      workspaceRoot: process.cwd(),
      emit: () => {},
      resources: makeStaticResources(),
      runtime,
      provider,
      compactionSummarizer: makeTestCompactionSummarizer(),
    });

    const run = agentSession.startRun({
      prompt: "overflow me",
      providerConfig,
      taskId: null,
    });
    await waitFor(() => database.getRun(run.id)?.status === "completed");

    expect(providerCalls).toHaveLength(2);
    expect(providerCalls[1]?.runId).toBe(run.id);
    expect(
      providerCalls[1]?.historyMessages.some(
        (message) =>
          message.role === "user" &&
          messageContentContains(message.content, "The conversation history before this point was compacted"),
      ),
    ).toBe(true);
    expect(runtime.snapshot().compaction.status).toBe("completed");
  });

  it("continues from a historical entry and records a branch checkpoint", async () => {
    const database = createMemoryDatabase();
    const session = database.createSession("Branching");
    const runtime = new SessionManager().getOrCreate(session.id);
    const providerConfig = database.upsertProviderConfig(makeProviderConfig());
    runtime.setSelectedProviderConfig(providerConfig.id);
    const providerCalls: ProviderRunInput[] = [];
    const provider = {
      async run(input: ProviderRunInput): Promise<ProviderRunResult> {
        providerCalls.push(input);
        return { assistantText: `done-${providerCalls.length}` };
      },
      cancel() {},
      approveTool() {},
      rejectTool() {},
    };

    const agentSession = new AgentSession({
      database,
      sessionId: session.id,
      workspaceRoot: process.cwd(),
      emit: () => {},
      resources: makeStaticResources(),
      runtime,
      provider,
    });

    const firstRun = agentSession.startRun({
      prompt: "root prompt",
      providerConfig,
      taskId: null,
    });
    await waitFor(() => database.getRun(firstRun.id)?.status === "completed");

    const secondRun = agentSession.startRun({
      prompt: "latest prompt",
      providerConfig,
      taskId: null,
    });
    await waitFor(() => database.getRun(secondRun.id)?.status === "completed");

    const historyEntries = database.listSessionHistoryEntries?.(session.id) ?? [];
    const branchTarget = historyEntries.find((entry) => entry.messageId === database.listMessages(session.id)[1]?.id);
    expect(branchTarget).toBeTruthy();

    const branchRun = agentSession.continueFromHistoryEntry({
      prompt: "branch prompt",
      providerConfig,
      taskId: null,
      historyEntryId: branchTarget?.id ?? null,
      checkpointSummary: "Branch checkpoint",
      checkpointDetails: { source: "test" },
    });
    await waitFor(() => database.getRun(branchRun.id)?.status === "completed");

    const branchSummary = (database.listSessionHistoryEntries?.(session.id) ?? []).find(
      (entry) => entry.kind === "branch_summary" && entry.summary === "Branch checkpoint",
    );
    expect(branchSummary).toBeTruthy();
    expect(branchSummary?.parentId).toBe(branchTarget?.id ?? null);
    expect(
      providerCalls[2]?.historyMessages.some(
        (message) =>
          message.role === "user" &&
          messageContentContains(message.content, "The branch history before this point was summarized as"),
      ),
    ).toBe(true);
    expect(
      providerCalls[2]?.historyMessages.some(
        (message) =>
          message.role === "user" &&
          messageContentContains(message.content, "latest prompt"),
      ),
    ).toBe(false);
    expect(
      providerCalls[2]?.historyMessages.some(
        (message) =>
          message.role === "user" &&
          messageContentContains(message.content, "root prompt"),
      ),
    ).toBe(true);
    expect(
      providerCalls[2]?.historyMessages.some(
        (message) =>
          message.role === "user" &&
          messageContentContains(message.content, "branch prompt"),
      ),
    ).toBe(false);
  });

  it("creates a new run when retrying a failed run", async () => {
    const database = createMemoryDatabase();
    const session = database.createSession("Retry");
    const runtime = new SessionManager().getOrCreate(session.id);
    const providerConfig = database.upsertProviderConfig(makeProviderConfig());
    runtime.setSelectedProviderConfig(providerConfig.id);
    const callRecords: Array<{ runId: string; prompt: string }> = [];
    const provider = {
      async run(input: ProviderRunInput): Promise<ProviderRunResult> {
        callRecords.push({ runId: input.runId, prompt: input.prompt });
        if (callRecords.length === 1) {
          throw new Error("boom");
        }
        return { assistantText: "retried" };
      },
      cancel() {},
      approveTool() {},
      rejectTool() {},
    };

    const agentSession = new AgentSession({
      database,
      sessionId: session.id,
      workspaceRoot: process.cwd(),
      emit: () => {},
      resources: makeStaticResources(),
      runtime,
      provider,
    });

    const firstRun = agentSession.startRun({
      prompt: "retry me",
      providerConfig: makeProviderConfig(),
      taskId: null,
    });
    await waitFor(() => database.getRun(firstRun.id)?.status === "failed");

    const laterRun = agentSession.startRun({
      prompt: "new latest prompt",
      providerConfig,
      taskId: null,
    });
    await waitFor(() => database.getRun(laterRun.id)?.status === "completed");

    const retryRun = agentSession.retryRun(firstRun.id);
    expect(retryRun.id).not.toBe(firstRun.id);
    await waitFor(() => database.getRun(retryRun.id)?.status === "completed");

    expect(callRecords.map((record) => record.runId)).toEqual([firstRun.id, laterRun.id, retryRun.id]);
    expect(database.getRun(retryRun.id)?.prompt).toBe("retry me");
    expect(database.getRun(retryRun.id)?.sourceRunId).toBe(firstRun.id);
    expect(database.getRun(retryRun.id)?.recoveryMode).toBe("retry");
    expect(database.getRun(retryRun.id)?.originRunId).toBe(firstRun.id);
    expect(database.getRun(retryRun.id)?.resumeFromCheckpoint).toBe(
      database.getLatestCheckpoint(firstRun.id)?.id ?? null,
    );
    expect(database.getRun(firstRun.id)?.status).toBe("failed");
    expect(database.getRun(retryRun.id)?.status).toBe("completed");
    expect(runtime.snapshot().pendingRunIds).toEqual([]);
  });

  it("creates a new run when resuming an interrupted run", async () => {
    const database = createMemoryDatabase();
    const session = database.createSession("Resume");
    const providerConfig = database.upsertProviderConfig(makeProviderConfig());
    const originalRun = database.createRun({
      sessionId: session.id,
      taskId: null,
      status: "running",
      provider: "anthropic",
      prompt: "resume source prompt",
      sourceRunId: null,
      recoveryMode: "start",
    });
    database.updateSession(session.id, {
      status: "running",
      latestUserMessage: "session level prompt should not win",
    });
    const runtime = new SessionRuntime(session.id, {
      interruptedRunIds: [originalRun.id],
      selectedProviderConfigId: providerConfig.id,
    });
    const executedRuns: string[] = [];
    const provider = {
      async run(input: ProviderRunInput): Promise<ProviderRunResult> {
        executedRuns.push(input.runId);
        return { assistantText: "resumed" };
      },
      cancel() {},
      approveTool() {},
      rejectTool() {},
    };

    const agentSession = new AgentSession({
      database,
      sessionId: session.id,
      workspaceRoot: process.cwd(),
      emit: () => {},
      resources: makeStaticResources(),
      runtime,
      provider,
    });

    const resumedRun = agentSession.resumeRun(originalRun.id);
    expect(resumedRun.id).not.toBe(originalRun.id);
    await waitFor(() => database.getRun(resumedRun.id)?.status === "completed");

    expect(executedRuns).toEqual([resumedRun.id]);
    expect(database.getRun(resumedRun.id)?.prompt).toBe("resume source prompt");
    expect(database.getRun(resumedRun.id)?.sourceRunId).toBe(originalRun.id);
    expect(database.getRun(resumedRun.id)?.recoveryMode).toBe("resume");
    expect(database.getRun(resumedRun.id)?.originRunId).toBe(originalRun.id);
    expect(database.getRun(resumedRun.id)?.resumeFromCheckpoint).toBeNull();
    expect(runtime.snapshot().interruptedRunIds).toEqual([originalRun.id]);
    expect(database.getRun(originalRun.id)?.status).toBe("running");
    expect(database.getRun(resumedRun.id)?.status).toBe("completed");
  });

  it("resumes a blocked run after approval", async () => {
    const database = createMemoryDatabase();
    const session = database.createSession("Approved");
    const runtime = new SessionManager().getOrCreate(session.id);
    const providerConfig = database.upsertProviderConfig(makeProviderConfig());
    runtime.setSelectedProviderConfig(providerConfig.id);
    const events: RunnerEventEnvelope[] = [];
    let latestToolCallId: string | null = null;
    let approvalGateResolve!: () => void;
    const approvalGate = new Promise<void>((resolve) => {
      approvalGateResolve = resolve;
    });
    let onToolDecision:
      | ((toolCallId: string, decision: "approved" | "rejected") => void)
      | null = null;
    const provider = {
      async run(input: ProviderRunInput): Promise<ProviderRunResult> {
        onToolDecision = input.onToolDecision ?? null;
        const toolCallId =
          (await input.onToolRequested?.({
            runId: input.runId,
            sessionId: input.sessionId,
            toolCallId: "tool-call-approve",
            toolName: "bash",
            input: { command: "echo", args: ["approve"] },
            requiresApproval: true,
          })) ?? "tool-call-approve";
        latestToolCallId = toolCallId;
        await approvalGate;
        input.onToolStarted?.(toolCallId, "bash");
        input.onToolFinished?.(toolCallId, "bash", { ok: true }, false);
        return { assistantText: "approved" };
      },
      cancel() {},
      approveTool(toolCallId: string) {
        onToolDecision?.(toolCallId, "approved");
        approvalGateResolve();
      },
      rejectTool() {},
    };

    const agentSession = new AgentSession({
      database,
      sessionId: session.id,
      workspaceRoot: process.cwd(),
      emit: (event) => events.push(event),
      resources: makeStaticResources(),
      runtime,
      provider,
    });

    const run = agentSession.startRun({
      prompt: "approve the tool",
      providerConfig,
      taskId: null,
    });

    await waitFor(() => runtime.snapshot().blockedToolCallId !== null);
    expect(latestToolCallId).not.toBeNull();
    agentSession.approveTool(latestToolCallId ?? "");
    await waitFor(() => database.getRun(run.id)?.status === "completed");

    expect(runtime.snapshot()).toMatchObject({
      activeRunId: null,
      blockedToolCallId: null,
      blockedRunId: null,
      interruptedRunIds: [],
      pendingApprovalToolCallIds: [],
    });
    expect(events.some((event) => event.type === "run.blocked")).toBe(true);
    expect(events.some((event) => event.type === "run.tool_decided")).toBe(true);
    expect(database.getRun(run.id)?.status).toBe("completed");
  });

  it("cancels a blocked run after rejection", async () => {
    const database = createMemoryDatabase();
    const session = database.createSession("Rejected");
    const runtime = new SessionManager().getOrCreate(session.id);
    const providerConfig = database.upsertProviderConfig(makeProviderConfig());
    runtime.setSelectedProviderConfig(providerConfig.id);
    const events: RunnerEventEnvelope[] = [];
    let latestToolCallId: string | null = null;
    let rejectGateResolve!: () => void;
    const rejectGate = new Promise<void>((resolve) => {
      rejectGateResolve = resolve;
    });
    let onToolDecision:
      | ((toolCallId: string, decision: "approved" | "rejected") => void)
      | null = null;
    const provider = {
      async run(input: ProviderRunInput): Promise<ProviderRunResult> {
        onToolDecision = input.onToolDecision ?? null;
        const toolCallId =
          (await input.onToolRequested?.({
            runId: input.runId,
            sessionId: input.sessionId,
            toolCallId: "tool-call-reject",
            toolName: "bash",
            input: { command: "echo", args: ["reject"] },
            requiresApproval: true,
          })) ?? "tool-call-reject";
        latestToolCallId = toolCallId;
        await rejectGate;
        throw new Error("Tool rejected");
      },
      cancel() {},
      approveTool() {},
      rejectTool(toolCallId: string) {
        onToolDecision?.(toolCallId, "rejected");
        rejectGateResolve();
      },
    };

    const agentSession = new AgentSession({
      database,
      sessionId: session.id,
      workspaceRoot: process.cwd(),
      emit: (event) => events.push(event),
      resources: makeStaticResources(),
      runtime,
      provider,
    });

    const run = agentSession.startRun({
      prompt: "reject the tool",
      providerConfig,
      taskId: null,
    });

    await waitFor(() => runtime.snapshot().blockedToolCallId !== null);
    expect(latestToolCallId).not.toBeNull();
    agentSession.rejectTool(latestToolCallId ?? "");
    await waitFor(() => database.getRun(run.id)?.status === "canceled");

    expect(runtime.snapshot()).toMatchObject({
      activeRunId: null,
      blockedToolCallId: null,
      blockedRunId: null,
      interruptedRunIds: [],
      pendingApprovalToolCallIds: [],
    });
    expect(events.some((event) => event.type === "run.blocked")).toBe(true);
    expect(database.getRun(run.id)?.status).toBe("canceled");
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 250; index += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Condition not met in time");
}

function makeSkill(name: string): SkillDescriptor {
  return {
    id: `skill:${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    description: "Inspect git changes.",
    license: null,
    compatibility: null,
    metadata: {},
    allowedTools: ["bash"],
    body: "Inspect the git diff.",
    source: {
      scope: "workspace",
      client: "agent",
      basePath: "/workspace/.agent/skills",
      skillPath: `/workspace/.agent/skills/${name.toLowerCase().replace(/\s+/g, "-")}/SKILL.md`,
    },
    references: [],
    assets: [],
    scripts: [],
    disableModelInvocation: false,
  };
}

function makeProviderConfig(overrides?: Partial<ProviderConfig>): ProviderConfig {
  const now = nowIso();
  const type = overrides?.type ?? "anthropic";
  return {
    id: overrides?.id ?? createId("provider"),
    name: overrides?.name ?? "Default anthropic",
    type,
    protocol: overrides?.protocol ?? (type === "anthropic" ? "anthropic-messages" : "openai-chat"),
    baseUrl: overrides?.baseUrl ?? "https://api.anthropic.com",
    apiKey: overrides?.apiKey ?? "test-api-key",
    model: overrides?.model ?? "claude-sonnet-4-20250514",
    createdAt: overrides?.createdAt ?? now,
    updatedAt: overrides?.updatedAt ?? now,
  };
}

function makeTestCompactionSummarizer() {
  return {
    async summarize(input: {
      sessionId: string;
      providerConfig: ProviderConfig;
      mode: "manual" | "threshold" | "overflow";
      tokensBefore: number;
      tokensKept: number;
      keepRecentTokens: number;
      summaryMessages: Array<{ role: string }>;
      keptMessages: Array<{ role: string }>;
    }): Promise<CompactionSummaryDocument> {
      return {
        version: 1,
        goal: `Compacted ${input.mode} context for ${input.sessionId}`,
        constraints: [`keepRecentTokens:${input.keepRecentTokens}`],
        progress: {
          done: [`summarized:${input.summaryMessages.length}`],
          inProgress: [`kept:${input.keptMessages.length}`],
          blocked: [],
        },
        keyDecisions: [`tokensBefore:${input.tokensBefore}`],
        nextSteps: [`resume:${input.mode}`],
        criticalContext: [
          `provider:${input.providerConfig.type}`,
          `tokensKept:${input.tokensKept}`,
        ],
      };
    },
  };
}

function makeLargePrompt(label: string, size: number): string {
  return `${label}:${"x".repeat(size)}`;
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

function messageContentContains(
  content: string | (TextContent | ImageContent)[],
  expected: string,
): boolean {
  if (typeof content === "string") {
    return content.includes(expected);
  }

  return content.some((part) => part.type === "text" && part.text.includes(expected));
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
  const branches = new Map<string, SessionBranch>();
  const checkpoints: RunCheckpoint[] = [];
  const activeBranchIds = new Map<string, string | null>();

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
      const { parentHistoryEntryId, branchId, originRunId, ...messageInput } = input as typeof input & {
        parentHistoryEntryId?: string | null;
        branchId?: string | null;
        originRunId?: string | null;
      };
      const message: SessionMessage = {
        id: createId("msg"),
        createdAt: nowIso(),
        ...messageInput,
      };
      messages.push(message);
      const parentId =
        parentHistoryEntryId ?? historyEntries.filter((entry) => entry.sessionId === message.sessionId).at(-1)?.id ?? null;
      const parentEntry = parentId ? historyEntries.find((entry) => entry.id === parentId) : null;
      historyEntries.push({
        id: createId("hist"),
        sessionId: message.sessionId,
        parentId,
        kind: "message",
        messageId: message.id,
        summary: null,
        details: null,
        branchId: branchId ?? null,
        lineageDepth: parentEntry ? parentEntry.lineageDepth + 1 : 0,
        originRunId: originRunId ?? null,
        createdAt: message.createdAt,
        updatedAt: message.createdAt,
      });
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
    listSessionHistoryEntries(sessionId) {
      return historyEntries.filter((entry) => entry.sessionId === sessionId);
    },
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
    searchMemories: (_query, scope, scopeId) =>
      [...memories.values()].filter(
        (memory) => (!scope || memory.scope === scope) && (!scopeId || memory.scopeId === scopeId),
      ),
    listMemories: (scope, scopeId) =>
      [...memories.values()].filter(
        (memory) => (!scope || memory.scope === scope) && (!scopeId || memory.scopeId === scopeId),
      ),
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
      const branch: SessionBranch = {
        ...input,
        createdAt: now,
        updatedAt: now,
      };
      branches.set(branch.id, branch);
      return branch;
    },
    getBranch(branchId) {
      return branches.get(branchId) ?? null;
    },
    listBranches(sessionId) {
      return [...branches.values()].filter((b) => b.sessionId === sessionId);
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
    getHistoryEntry(entryId) {
      return historyEntries.find((entry) => entry.id === entryId) ?? null;
    },
    getBranchHistory(sessionId, branchId) {
      return historyEntries.filter(
        (entry) => entry.sessionId === sessionId && entry.branchId === branchId,
      );
    },
    getActiveBranchId(sessionId) {
      return activeBranchIds.get(sessionId) ?? null;
    },
    setActiveBranchId(sessionId, branchId) {
      activeBranchIds.set(sessionId, branchId);
    },
  };
}
