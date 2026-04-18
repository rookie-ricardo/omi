import type {
  ProviderConfig,
  ResolvedSkill,
  Run,
  Session,
  Task,
  ToolCall,
  RunnerEventEnvelope,
} from "@omi/core";
import type { AppStore } from "@omi/store";
import type { ImageContent } from "@mariozechner/pi-ai";

import { createId, nowIso } from "@omi/core";
import {
  buildSessionRuntimeMessages,
  convertRuntimeMessagesToLlm,
  type SessionCompactionSnapshot,
  type CompactionSummaryDocument,
  listRetainedSessionMessages,
  listRetainedToolCalls,
} from "@omi/memory";
import {
  createProviderAdapter,
  type ProviderAdapter,
  type ProviderToolLifecycleControl,
  type ProviderToolLifecycleEvent,
} from "@omi/provider";
import {
  createAllTools,
  createDiscoverSkillsTool,
  createSkillTool,
  listBuiltInToolNames,
  SAFE_TOOL_NAMES,
  runWithToolRuntimeContext,
  setSkillExecutorRuntime,
  type ToolRuntimeContext,
} from "@omi/tools";

import { searchSkills } from "./skills/discovery";

import type { ResourceLoader } from "./resource-loader";
import type { SessionRuntime } from "./session-manager";
import type { SettingsManager } from "@omi/settings";
import {
  type PermissionEvaluator,
  type PermissionContext,
  MemoryDenialTracker,
  createPermissionEvaluator,
} from "./permissions";

export type SessionPermissionMode = "default" | "yolo";

export interface AgentSessionOptions {
  database: AppStore;
  sessionId: string;
  workspaceRoot: string;
  emit: (event: RunnerEventEnvelope) => void;
  resources: ResourceLoader;
  runtime: SessionRuntime;
  provider?: ProviderAdapter;
  settingsManager?: SettingsManager;
  evaluator?: PermissionEvaluator;
  permissionMode?: SessionPermissionMode;
  toolRuntimeContext?: ToolRuntimeContext;
}

interface ExecuteRunInput {
  session: Session;
  task: Task | null;
  run: Run;
  prompt: string;
  contextFiles: string[];
  providerConfig: ProviderConfig;
  rootMessageId: string;
}

type FailedRunInput = Pick<ExecuteRunInput, "session" | "task" | "run" | "prompt" | "rootMessageId">;

interface RunMessageContext {
  rootMessageId: string;
  taskId: string | null;
}

export class AgentSession {
  private readonly provider: ProviderAdapter;
  private processingQueue = false;
  private readonly evaluatorOverride: PermissionEvaluator | null;
  private readonly denialTracker = new MemoryDenialTracker();
  private permissionMode: SessionPermissionMode;
  private workspaceRoot: string;

  private activeAbortController: AbortController | null = null;
  private readonly pendingApprovals = new Map<string, (decision: "approved" | "rejected") => void>();
  private readonly preDecisions = new Map<string, "approved" | "rejected">();
  private readonly runContexts = new Map<string, RunMessageContext>();
  private readonly assistantBuffers = new Map<string, string>();

  constructor(private readonly options: AgentSessionOptions) {
    this.provider = options.provider ?? createProviderAdapter();
    this.evaluatorOverride = options.evaluator ?? null;
    this.permissionMode = options.permissionMode ?? "default";
    this.workspaceRoot = options.workspaceRoot;
  }

  setPermissionMode(mode: SessionPermissionMode): void {
    this.permissionMode = mode;
  }

  setWorkspaceRoot(workspaceRoot: string): void {
    this.workspaceRoot = workspaceRoot;
  }

  startRun(input: {
    prompt: string;
    contextFiles?: string[];
    providerConfig: ProviderConfig;
    taskId?: string | null;
  }): Run {
    const session = this.requireSession();
    const task = input.taskId ? this.options.database.getTask(input.taskId) : null;
    const rootMessage = this.createRootUserMessage({
      session,
      taskId: task?.id ?? null,
      prompt: input.prompt,
      parentMessageId: null,
      model: input.providerConfig.model,
    });
    const run = this.options.database.createRun({
      sessionId: session.id,
      taskId: task?.id ?? null,
      status: "queued",
      providerConfigId: input.providerConfig.id,
      model: input.providerConfig.model,
      prompt: input.prompt,
      sourceRunId: null,
      recoveryMode: "start",
      originRunId: null,
      terminalReason: null,
      provider: input.providerConfig.name,
      resumeFromCheckpoint: null,
    } as Run);
    this.runContexts.set(run.id, {
      rootMessageId: rootMessage.id,
      taskId: task?.id ?? null,
    });
    this.options.runtime.enqueueRun({
      runId: run.id,
      prompt: input.prompt,
      contextFiles: normalizeContextFiles(input.contextFiles),
      taskId: task?.id ?? null,
      providerConfigId: input.providerConfig.id,
      sourceRunId: null,
      mode: "start",
      parentMessageId: rootMessage.id,
    });
    this.persistSessionSelection(input.providerConfig);
    this.processQueue().catch((error) => {
      this.options.emit({
        type: "run.failed",
        payload: {
          runId: "",
          sessionId: this.options.sessionId,
          error: `Queue processing failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      });
    });
    return run;
  }

  retryRun(runId: string): Run {
    const originalRun = this.requireRun(runId);
    if (originalRun.status !== "failed" && originalRun.status !== "canceled") {
      throw new Error(`Run ${runId} is not retryable`);
    }

    const session = this.requireSession();
    const prompt = resolveRunPrompt(originalRun, this.options.runtime.snapshot(), session);
    if (!prompt) {
      throw new Error(`Cannot retry run ${runId} without a prompt`);
    }

    const task = originalRun.taskId ? this.options.database.getTask(originalRun.taskId) : null;
    const providerConfig = this.resolveProviderConfig();
    const rootMessage = this.createRootUserMessage({
      session,
      taskId: task?.id ?? null,
      prompt,
      parentMessageId: null,
      model: providerConfig.model,
    });
    const nextRun = this.options.database.createRun({
      sessionId: session.id,
      taskId: task?.id ?? null,
      status: "queued",
      providerConfigId: providerConfig.id,
      model: providerConfig.model,
      prompt,
      sourceRunId: originalRun.id,
      recoveryMode: "retry",
      originRunId: originalRun.originRunId ?? originalRun.id,
      terminalReason: null,
      provider: providerConfig.name,
      resumeFromCheckpoint: null,
    } as Run);
    this.runContexts.set(nextRun.id, {
      rootMessageId: rootMessage.id,
      taskId: task?.id ?? null,
    });
    this.options.runtime.enqueueRun({
      runId: nextRun.id,
      prompt,
      taskId: task?.id ?? null,
      providerConfigId: providerConfig.id,
      sourceRunId: originalRun.id,
      mode: "retry",
      parentMessageId: rootMessage.id,
    });
    this.processQueue().catch((error) => {
      this.options.emit({
        type: "run.failed",
        payload: {
          runId: "",
          sessionId: this.options.sessionId,
          error: `Queue processing failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      });
    });
    return nextRun;
  }

  resumeRun(runId: string): Run {
    const originalRun = this.requireRun(runId);
    if (originalRun.status !== "running" && originalRun.status !== "blocked") {
      throw new Error(`Run ${runId} is not resumable`);
    }

    const session = this.requireSession();
    const prompt = resolveRunPrompt(originalRun, this.options.runtime.snapshot(), session);
    if (!prompt) {
      throw new Error(`Cannot resume run ${runId} without a prompt`);
    }

    const task = originalRun.taskId ? this.options.database.getTask(originalRun.taskId) : null;
    const providerConfig = this.resolveProviderConfig();
    const rootMessage = this.createRootUserMessage({
      session,
      taskId: task?.id ?? null,
      prompt,
      parentMessageId: null,
      model: providerConfig.model,
    });
    const resumedRun = this.options.database.createRun({
      sessionId: session.id,
      taskId: task?.id ?? null,
      status: "queued",
      providerConfigId: providerConfig.id,
      model: providerConfig.model,
      prompt,
      sourceRunId: originalRun.id,
      recoveryMode: "resume",
      originRunId: originalRun.originRunId ?? originalRun.id,
      terminalReason: null,
      provider: providerConfig.name,
      resumeFromCheckpoint: null,
    } as Run);
    this.runContexts.set(resumedRun.id, {
      rootMessageId: rootMessage.id,
      taskId: task?.id ?? null,
    });
    this.options.runtime.enqueueRun({
      runId: resumedRun.id,
      prompt,
      taskId: task?.id ?? null,
      providerConfigId: providerConfig.id,
      sourceRunId: originalRun.id,
      mode: "resume",
      parentMessageId: rootMessage.id,
    });
    this.processQueue().catch((error) => {
      this.options.emit({
        type: "run.failed",
        payload: {
          runId: "",
          sessionId: this.options.sessionId,
          error: `Queue processing failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      });
    });
    return resumedRun;
  }

  async compactSession(): Promise<{
    sessionId: string;
    runtime: ReturnType<SessionRuntime["snapshot"]>;
    summary: SessionCompactionSnapshot["summary"];
    compactedAt: string;
  }> {
    const session = this.requireSession();
    const compactedAt = nowIso();
    const runtime = this.options.runtime.snapshot();
    const summary: CompactionSummaryDocument = runtime.compaction.lastSummary ?? {
      version: 1,
      goal: "Session compaction handled by runtime.",
      constraints: [],
      progress: { done: [], inProgress: [], blocked: [] },
      keyDecisions: [],
      nextSteps: [],
      criticalContext: [],
    };
    this.options.runtime.completeCompaction({ summary, compactedAt });
    const messages = this.options.database.listMessages(session.id);
    this.createSummaryMessage({
      session,
      taskId: null,
      parentMessageId: null,
      compressedFromMessageId: resolveCompactionStartMessageId(messages),
      summary: summary.goal,
      model: session.model,
    });
    return {
      sessionId: session.id,
      runtime: this.options.runtime.snapshot(),
      summary,
      compactedAt,
    };
  }

  cancelRun(runId: string): { runId: string; canceled: true } {
    const run = this.options.database.getRun(runId);
    if (!run) {
      return { runId, canceled: true };
    }

    this.provider.cancel(runId);
    this.activeAbortController?.abort();
    this.options.database.updateRun(runId, { status: "canceled", terminalReason: "canceled" });
    this.options.runtime.cancelRun(runId);
    this.persistPartialAssistantMessageFromBuffer(runId);
    this.rejectAllPendingApprovals();
    this.emitEvent({
      type: "run.canceled",
      payload: { runId, sessionId: run.sessionId },
    });
    return { runId, canceled: true };
  }

  approveTool(toolCallId: string): { toolCallId: string; decision: "approved" } {
    const resolver = this.pendingApprovals.get(toolCallId);
    if (resolver) {
      this.pendingApprovals.delete(toolCallId);
      resolver("approved");
    } else {
      this.preDecisions.set(toolCallId, "approved");
    }
    this.options.runtime.resumeFromToolDecision(toolCallId);
    return { toolCallId, decision: "approved" };
  }

  rejectTool(toolCallId: string): { toolCallId: string; decision: "rejected" } {
    const resolver = this.pendingApprovals.get(toolCallId);
    if (resolver) {
      this.pendingApprovals.delete(toolCallId);
      resolver("rejected");
    } else {
      this.preDecisions.set(toolCallId, "rejected");
    }
    this.options.runtime.resumeFromToolDecision(toolCallId);
    return { toolCallId, decision: "rejected" };
  }

  async abort(): Promise<void> {
    if (this.options.runtime.snapshot().activeRunId) {
      this.cancelRun(this.options.runtime.snapshot().activeRunId!);
    }
    while (this.options.runtime.snapshot().activeRunId) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  dispose(): void {
    const runtime = this.options.runtime.snapshot();
    if (runtime.activeRunId) {
      this.cancelRun(runtime.activeRunId);
    }
    this.processingQueue = false;
  }

  setModel(modelId: string): void {
    const session = this.requireSession();
    this.options.database.updateSession(session.id, { model: modelId });
  }

  getSessionStats(): {
    sessionId: string;
    userMessages: number;
    assistantMessages: number;
    toolCalls: number;
    totalMessages: number;
    runs: number;
  } {
    const session = this.requireSession();
    const messages = this.options.database.listMessages(session.id);
    const toolCalls = this.options.database.listToolCallsBySession(session.id);
    const runs = this.options.database.listRuns(session.id);
    return {
      sessionId: session.id,
      userMessages: messages.filter((m) => m.role === "user").length,
      assistantMessages: messages.filter((m) => m.role === "assistant").length,
      toolCalls: toolCalls.length,
      totalMessages: messages.length,
      runs: runs.length,
    };
  }

  async prompt(
    text: string,
    options?: {
      taskId?: string | null;
      images?: ImageContent[];
    },
  ): Promise<Run> {
    const providerConfig = this.resolveProviderConfig();
    return this.startRun({ prompt: text, providerConfig, taskId: options?.taskId });
  }

  async fork(messageId: string): Promise<{ newSessionId: string; selectedText: string }> {
    const session = this.requireSession();
    const selectedMessage = messageId ? this.options.database.getMessage(messageId) : null;
    if (messageId && (!selectedMessage || selectedMessage.sessionId !== session.id)) {
      throw new Error(`Message ${messageId} not found`);
    }
    const newSession = this.options.database.createSession(`Fork of ${session.title}`);
    this.options.database.updateSession(newSession.id, {
      providerConfigId: session.providerConfigId,
      model: session.model,
      permissionMode: session.permissionMode,
      thinkLevel: session.thinkLevel,
    });

    const sourceMessages = listRetainedSessionMessages(this.options.database.listMessages(session.id));
    const sourceToolCalls = listRetainedToolCalls(
      this.options.database.listToolCallsBySession(session.id),
      sourceMessages,
    );
    const messageIdMap = new Map<string, string>();

    for (const message of sourceMessages) {
      const nextMessageId = createId("msg");
      messageIdMap.set(message.id, nextMessageId);
      this.options.database.addMessage({
        id: nextMessageId,
        sessionId: newSession.id,
        taskId: null,
        parentMessageId: message.parentMessageId ? (messageIdMap.get(message.parentMessageId) ?? null) : null,
        role: message.role,
        messageType: message.messageType,
        content: message.content,
        model: message.model,
        tokens: message.tokens,
        totalTokens: message.totalTokens,
        compressedFromMessageId: message.compressedFromMessageId
          ? (messageIdMap.get(message.compressedFromMessageId) ?? nextMessageId)
          : null,
      });
    }

    for (const toolCall of sourceToolCalls) {
      const nextMessageId = messageIdMap.get(toolCall.messageId);
      if (!nextMessageId) {
        continue;
      }
      this.options.database.createToolCall({
        id: createId("tool"),
        messageId: nextMessageId,
        sessionId: newSession.id,
        toolName: toolCall.toolName,
        approvalState: toolCall.approvalState,
        input: toolCall.input,
        output: toolCall.output,
        error: toolCall.error,
      });
    }

    return { newSessionId: newSession.id, selectedText: selectedMessage?.content ?? sourceMessages.at(-1)?.content ?? "" };
  }

  private async processQueue(): Promise<void> {
    if (this.processingQueue) return;
    this.processingQueue = true;

    try {
      while (true) {
        const queuedRun = this.options.runtime.peekQueuedRun();
        if (!queuedRun) return;
        this.options.runtime.dequeueRun(queuedRun.runId);

        const run = this.options.database.getRun(queuedRun.runId);
        if (!run || run.status === "canceled") {
          continue;
        }

        const session = this.requireSession();
        const task = run.taskId ? this.options.database.getTask(run.taskId) : null;
        const context = this.runContexts.get(run.id);
        if (!context?.rootMessageId) {
          throw new Error(`Run ${run.id} is missing its root message context`);
        }

        let providerConfig: ProviderConfig;
        try {
          providerConfig = this.resolveQueuedProviderConfig(queuedRun.providerConfigId);
        } catch (error) {
          await this.handleFailedRun(
            { session, task, run, prompt: queuedRun.prompt, rootMessageId: context.rootMessageId },
            error,
          );
          continue;
        }

        await this.executeRun({
          session,
          task,
          run,
          prompt: queuedRun.prompt,
          contextFiles: queuedRun.contextFiles ?? [],
          providerConfig,
          rootMessageId: context.rootMessageId,
        });
      }
    } finally {
      this.processingQueue = false;
    }
  }

  private async executeRun(input: ExecuteRunInput): Promise<void> {
    const { session, task, run, prompt, contextFiles, providerConfig, rootMessageId } = input;
    const abortController = new AbortController();
    this.activeAbortController = abortController;
    this.assistantBuffers.set(run.id, "");

    try {
      this.options.database.updateRun(run.id, {
        status: "running",
        providerConfigId: providerConfig.id,
        model: providerConfig.model,
      });
      this.options.runtime.beginRun(run.id, prompt);
      this.emitEvent({
        type: "run.started",
        payload: { runId: run.id, sessionId: session.id, prompt },
      });

      await this.options.resources.reload();
      const resolvedSkill = await this.options.resources.resolveSkillForPrompt(prompt);
      const systemPrompt = this.options.resources.buildSystemPrompt(resolvedSkill, this.workspaceRoot);

      if (resolvedSkill) {
        this.emitEvent({
          type: "run.skill_selected",
          payload: {
            runId: run.id,
            sessionId: session.id,
            skillName: resolvedSkill.skill.name,
            score: resolvedSkill.score,
            source: resolvedSkill.skill.source.client,
            enabledToolNames: resolvedSkill.enabledToolNames,
            diagnostics: resolvedSkill.diagnostics,
          },
        });
      }

      const runtimeMessages = this.buildProviderHistoryMessages(session.id);
      const historyMessages = convertRuntimeMessagesToLlm(runtimeMessages);

      setSkillExecutorRuntime(async (skillName: string, args?: string) => {
        const matches = await searchSkills(this.workspaceRoot, skillName);
        const match = matches.find((candidate) => candidate.name.toLowerCase() === skillName.toLowerCase()) ?? matches[0];
        if (!match) {
          return { content: `No skill found matching '${skillName}'. Use discover_skills to search.` };
        }
        const body = args ? `${match.body}\n\nArguments: ${args}` : match.body;
        return { content: body, details: { skillName: match.name, score: match.score } };
      });

      const tools = Object.values(createAllTools(this.workspaceRoot));
      const workspaceRoot = this.workspaceRoot;
      tools.push(
        createDiscoverSkillsTool({
          workspaceRootFactory: () => workspaceRoot,
          searchSkills: async (root, query) => {
            const matches = await searchSkills(root, query);
            return matches.map((match) => ({
              name: match.name,
              description: match.description,
              compatibility: match.compatibility ?? null,
              allowedTools: match.allowedTools,
              body: match.body,
              score: match.score,
            }));
          },
        }),
      );
      tools.push(createSkillTool());

      const enabledTools = [...new Set([...listBuiltInToolNames(), "discover_skills", "skill"])];
      const effectivePrompt = buildEffectivePrompt(prompt, contextFiles, resolvedSkill);
      const toolExecutionMode = resolveToolExecutionMode(enabledTools);

      const doRun = async () =>
        this.provider.run({
          runId: run.id,
          sessionId: session.id,
          workspaceRoot: this.workspaceRoot,
          prompt: effectivePrompt,
          historyMessages,
          systemPrompt,
          providerConfig,
          tools,
          enabledTools,
          toolExecutionMode,
          signal: abortController.signal,
          onTextDelta: (delta) => {
            this.assistantBuffers.set(run.id, (this.assistantBuffers.get(run.id) ?? "") + delta);
            this.emitEvent({
              type: "run.delta",
              payload: { runId: run.id, sessionId: session.id, delta },
            });
          },
          onToolLifecycle: (event) =>
            this.handleToolLifecycle(event, run, session, task, rootMessageId),
          onSdkMessage: (message) => {
            this.emitEvent({
              type: `sdk.${(message as Record<string, unknown>).type ?? "message"}`,
              payload: { runId: run.id, sessionId: session.id, message: message as Record<string, unknown> },
            });
          },
        });

      const result = this.options.toolRuntimeContext
        ? await runWithToolRuntimeContext(this.options.toolRuntimeContext, doRun)
        : await doRun();

      const finalAssistantText = (this.assistantBuffers.get(run.id) ?? "").trim()
        ? this.assistantBuffers.get(run.id) ?? ""
        : (result.assistantText ?? "");

      let assistantMessageId: string | null = null;
      if (finalAssistantText.trim()) {
        const outputTokens = Number(result.usage.outputTokens ?? estimateTextTokens(finalAssistantText));
        const assistantMessage = this.options.database.addMessage({
          sessionId: session.id,
          taskId: task?.id ?? null,
          parentMessageId: rootMessageId,
          role: "assistant",
          messageType: "text",
          content: finalAssistantText,
          model: providerConfig.model,
          tokens: outputTokens,
          totalTokens: outputTokens,
          compressedFromMessageId: null,
        });
        assistantMessageId = assistantMessage.id;
        this.options.database.updateSession(session.id, {
          latestAssistantMessage: finalAssistantText,
          providerConfigId: providerConfig.id,
          model: providerConfig.model,
        });
        const totalUsage = Number(result.usage.inputTokens ?? 0) + Number(result.usage.outputTokens ?? 0);
        if (totalUsage > 0) {
          this.options.database.updateMessage(assistantMessage.id, { totalTokens: totalUsage });
          this.bumpAncestorTotals(rootMessageId, totalUsage);
        }
      }

      const isError = result.error !== null;
      this.options.database.updateRun(run.id, {
        status: isError ? "failed" : "completed",
        terminalReason: isError ? result.error : "completed",
      });
      this.options.runtime.completeRun(run.id, finalAssistantText);
      if (task && !isError) {
        this.options.database.updateTask(task.id, { status: nextTaskStatus(task.status, "run_completed") });
      }

      if (isError) {
        this.emitEvent({
          type: "run.failed",
          payload: { runId: run.id, sessionId: session.id, error: result.error! },
        });
        await this.handleFailedRun(input, new Error(result.error!));
      } else {
        this.emitEvent({
          type: "run.completed",
          payload: { runId: run.id, sessionId: session.id, usage: result.usage, stopReason: result.stopReason, messageId: assistantMessageId },
        });
      }
    } catch (error) {
      await this.handleFailedRun(input, error);
    } finally {
      this.activeAbortController = null;
      this.pendingApprovals.clear();
      this.preDecisions.clear();
      this.assistantBuffers.delete(run.id);
    }
  }

  private async handleToolLifecycle(
    event: ProviderToolLifecycleEvent,
    run: Run,
    session: Session,
    task: Task | null,
    rootMessageId: string,
  ): Promise<ProviderToolLifecycleControl> {
    if (event.stage === "requested") {
      return this.onToolRequested(event, run, session, task, rootMessageId);
    }

    if (event.stage === "approval_requested") {
      return this.onToolApprovalRequested(event, run, session);
    }

    if (event.stage === "started") {
      this.emitEvent({
        type: "run.tool_started",
        payload: { runId: run.id, sessionId: session.id, toolCallId: event.toolCallId, toolName: event.toolName },
      });
      return {};
    }

    if (event.stage === "progress") {
      this.emitEvent({
        type: "run.tool_progress",
        payload: { runId: run.id, sessionId: session.id, toolCallId: event.toolCallId, toolName: event.toolName },
      });
      return {};
    }

    if (event.stage === "finished") {
      const toolCall = this.options.database.getToolCall(event.toolCallId);
      this.options.database.updateToolCall(event.toolCallId, {
        output: event.output ?? null,
        error: null,
      });
      if (toolCall) {
        this.createToolResultMessage({
          sessionId: session.id,
          taskId: task?.id ?? null,
          parentMessageId: toolCall.messageId,
          content: event.output ? JSON.stringify(event.output, null, 2) : "",
          model: run.model ?? session.model,
          isError: false,
        });
      }
      this.emitEvent({
        type: "run.tool_finished",
        payload: {
          runId: run.id,
          sessionId: session.id,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          output: event.output,
        },
      });
      return {};
    }

    if (event.stage === "failed") {
      const toolCall = this.options.database.getToolCall(event.toolCallId);
      this.options.database.updateToolCall(event.toolCallId, {
        output: null,
        error: event.error ?? "Unknown tool error",
      });
      if (toolCall) {
        this.createToolResultMessage({
          sessionId: session.id,
          taskId: task?.id ?? null,
          parentMessageId: toolCall.messageId,
          content: event.error ?? "Unknown tool error",
          model: run.model ?? session.model,
          isError: true,
        });
      }
      this.emitEvent({
        type: "run.tool_failed",
        payload: {
          runId: run.id,
          sessionId: session.id,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          error: event.error ?? "Unknown tool error",
        },
      });
      return {};
    }

    return {};
  }

  private onToolRequested(
    event: ProviderToolLifecycleEvent,
    run: Run,
    session: Session,
    task: Task | null,
    rootMessageId: string,
  ): ProviderToolLifecycleControl {
    if (this.permissionMode === "yolo") {
      this.persistToolCall(event, run, session, task, rootMessageId, "not_required");
      this.emitEvent({
        type: "run.tool_requested",
        payload: {
          runId: run.id,
          sessionId: session.id,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          input: event.input,
          requiresApproval: false,
        },
      });
      return { allowExecution: true, requiresApproval: false };
    }

    const evaluator =
      this.evaluatorOverride ??
      createPermissionEvaluator().withDenialTracker(this.denialTracker).build();
    const context: PermissionContext = {
      toolName: event.toolName,
      input: event.input,
      planMode: false,
      sessionId: session.id,
    };
    const result = evaluator.preflightCheck(context);
    if (result.decision === "deny") {
      this.persistToolCall(event, run, session, task, rootMessageId, "rejected");
      this.createToolResultMessage({
        sessionId: session.id,
        taskId: task?.id ?? null,
        parentMessageId: this.options.database.getToolCall(event.toolCallId)?.messageId ?? rootMessageId,
        content: result.reason ?? `Tool '${event.toolName}' denied by permission policy.`,
        model: run.model ?? session.model,
        isError: true,
      });
      return {
        allowExecution: false,
        error: result.reason ?? `Tool '${event.toolName}' denied by permission policy.`,
      };
    }

    if (result.decision === "ask") {
      this.persistToolCall(event, run, session, task, rootMessageId, "pending");
      this.emitEvent({
        type: "run.tool_requested",
        payload: {
          runId: run.id,
          sessionId: session.id,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          input: event.input,
          requiresApproval: true,
        },
      });
      return { allowExecution: true, requiresApproval: true };
    }

    this.persistToolCall(event, run, session, task, rootMessageId, "not_required");
    this.emitEvent({
      type: "run.tool_requested",
      payload: {
        runId: run.id,
        sessionId: session.id,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        input: event.input,
        requiresApproval: false,
      },
    });
    return { allowExecution: true, requiresApproval: false };
  }

  private async onToolApprovalRequested(
    event: ProviderToolLifecycleEvent,
    run: Run,
    session: Session,
  ): Promise<ProviderToolLifecycleControl> {
    this.options.runtime.blockOnTool(run.id, event.toolCallId);
    this.emitEvent({
      type: "run.blocked",
      payload: {
        runId: run.id,
        sessionId: session.id,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        input: event.input,
      },
    });

    const preDecision = this.preDecisions.get(event.toolCallId);
    const decision = preDecision
      ? (this.preDecisions.delete(event.toolCallId), preDecision)
      : await new Promise<"approved" | "rejected">((resolve) => {
          this.pendingApprovals.set(event.toolCallId, resolve);
        });

    this.options.database.updateToolCall(event.toolCallId, { approvalState: decision });
    if (decision === "approved") {
      this.options.runtime.approveTool(run.id, event.toolCallId);
    } else {
      this.options.runtime.rejectTool(run.id, event.toolCallId);
    }

    this.emitEvent({
      type: "run.tool_decided",
      payload: {
        runId: run.id,
        sessionId: session.id,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        decision,
      },
    });
    return { decision };
  }

  private persistToolCall(
    event: ProviderToolLifecycleEvent,
    run: Run,
    session: Session,
    task: Task | null,
    rootMessageId: string,
    approvalState: ToolCall["approvalState"],
  ): void {
    const toolMessage = this.options.database.addMessage({
      id: event.toolCallId,
      sessionId: session.id,
      taskId: task?.id ?? null,
      parentMessageId: rootMessageId,
      role: "tool",
      messageType: "tool_call",
      content: JSON.stringify(event.input, null, 2),
      model: run.model ?? session.model,
      tokens: estimateTextTokens(JSON.stringify(event.input)),
      totalTokens: estimateTextTokens(JSON.stringify(event.input)),
      compressedFromMessageId: null,
    });
    this.bumpAncestorTotals(rootMessageId, toolMessage.tokens);
    this.options.database.createToolCall({
      id: event.toolCallId,
      messageId: toolMessage.id,
      sessionId: session.id,
      toolName: event.toolName,
      approvalState,
      input: event.input,
      output: null,
      error: null,
    });
  }

  private async handleFailedRun(input: FailedRunInput, error: unknown): Promise<void> {
    const { run, session } = input;
    const canceled = this.options.database.getRun(run.id)?.status === "canceled";
    const message = error instanceof Error ? error.message : String(error);
    this.options.database.updateRun(run.id, {
      status: canceled ? "canceled" : "failed",
      terminalReason: canceled ? "canceled" : message,
    });
    this.options.runtime.failRun(run.id);
    this.persistPartialAssistantMessageFromBuffer(run.id);
    if (!canceled && !this.hasAssistantChild(input.rootMessageId)) {
      const failureMessage = this.options.database.addMessage({
        sessionId: session.id,
        taskId: input.task?.id ?? null,
        parentMessageId: input.rootMessageId,
        role: "assistant",
        messageType: "text",
        content: message,
        model: run.model ?? session.model,
        tokens: estimateTextTokens(message),
        totalTokens: estimateTextTokens(message),
        compressedFromMessageId: null,
      });
      this.options.database.updateSession(session.id, { latestAssistantMessage: failureMessage.content });
      this.bumpAncestorTotals(input.rootMessageId, failureMessage.tokens);
    }

    if (canceled) {
      this.emitEvent({
        type: "run.canceled",
        payload: { runId: run.id, sessionId: session.id },
      });
    } else {
      this.emitEvent({
        type: "run.failed",
        payload: { runId: run.id, sessionId: session.id, error: message },
      });
    }
  }

  private requireSession(): Session {
    const session = this.options.database.getSession(this.options.sessionId);
    if (!session) {
      throw new Error(`Session ${this.options.sessionId} not found`);
    }
    return session;
  }

  private requireRun(runId: string): Run {
    const run = this.options.database.getRun(runId);
    if (!run) {
      throw new Error(`Run ${runId} not found`);
    }
    return run;
  }

  private resolveProviderConfig(): ProviderConfig {
    const session = this.requireSession();
    const config = session.providerConfigId
      ? this.options.database.getProviderConfig(session.providerConfigId)
      : this.options.database.getProviderConfig();
    if (!config) {
      throw new Error("No provider config available for this session");
    }
    return {
      ...config,
      model: session.model ?? config.model,
      enabled: config.enabled ?? true,
    };
  }

  private resolveQueuedProviderConfig(providerConfigId: string | null): ProviderConfig {
    const selected = providerConfigId ? this.options.database.getProviderConfig(providerConfigId) : null;
    if (selected) {
      const session = this.requireSession();
      return {
        ...selected,
        model: session.model ?? selected.model,
        enabled: selected.enabled ?? true,
      };
    }
    return this.resolveProviderConfig();
  }

  private buildProviderHistoryMessages(sessionId: string) {
    return buildSessionRuntimeMessages({
      messages: this.options.database.listMessages(sessionId),
      toolCalls: this.options.database.listToolCallsBySession(sessionId),
      compaction: null,
    });
  }

  private persistSessionSelection(providerConfig: ProviderConfig): void {
    const session = this.requireSession();
    this.options.database.updateSession(session.id, {
      providerConfigId: providerConfig.id,
      model: providerConfig.model,
      permissionMode: this.permissionMode,
    });
  }

  private createRootUserMessage(input: {
    session: Session;
    taskId: string | null;
    prompt: string;
    parentMessageId: string | null;
    model: string | null;
  }) {
    const message = this.options.database.addMessage({
      sessionId: input.session.id,
      taskId: input.taskId,
      parentMessageId: input.parentMessageId,
      role: "user",
      messageType: "text",
      content: input.prompt,
      model: input.model,
      tokens: estimateTextTokens(input.prompt),
      totalTokens: estimateTextTokens(input.prompt),
      compressedFromMessageId: null,
    });
    this.options.database.updateSession(input.session.id, {
      latestUserMessage: input.prompt,
      updatedAt: nowIso(),
    });
    if (input.parentMessageId) {
      this.bumpAncestorTotals(input.parentMessageId, message.tokens);
    }
    return message;
  }

  private createSummaryMessage(input: {
    session: Session;
    taskId: string | null;
    parentMessageId: string | null;
    compressedFromMessageId: string | null;
    summary: string;
    model: string | null;
  }) {
    const message = this.options.database.addMessage({
      sessionId: input.session.id,
      taskId: input.taskId,
      parentMessageId: input.parentMessageId,
      role: "assistant",
      messageType: "summary",
      content: input.summary,
      model: input.model,
      tokens: estimateTextTokens(input.summary),
      totalTokens: estimateTextTokens(input.summary),
      compressedFromMessageId: input.compressedFromMessageId,
    });
    if (input.parentMessageId) {
      this.bumpAncestorTotals(input.parentMessageId, message.tokens);
    }
    return message;
  }

  private createToolResultMessage(input: {
    sessionId: string;
    taskId: string | null;
    parentMessageId: string;
    content: string;
    model: string | null;
    isError: boolean;
  }) {
    const tokens = estimateTextTokens(input.content);
    const message = this.options.database.addMessage({
      sessionId: input.sessionId,
      taskId: input.taskId,
      parentMessageId: input.parentMessageId,
      role: "tool",
      messageType: "tool_result",
      content: input.content,
      model: input.model,
      tokens,
      totalTokens: tokens,
      compressedFromMessageId: null,
    });
    this.bumpAncestorTotals(input.parentMessageId, tokens);
    return message;
  }

  private bumpAncestorTotals(messageId: string, delta: number): void {
    if (!delta) return;
    let current = this.options.database.getMessage(messageId);
    while (current) {
      this.options.database.updateMessage(current.id, {
        totalTokens: current.totalTokens + delta,
      });
      current = current.parentMessageId ? this.options.database.getMessage(current.parentMessageId) : null;
    }
  }

  private hasAssistantChild(rootMessageId: string): boolean {
    return this.options.database
      .listChildMessages(rootMessageId)
      .some((message) => message.role === "assistant" && message.messageType === "text");
  }

  private persistPartialAssistantMessageFromBuffer(runId: string): void {
    const buffer = this.assistantBuffers.get(runId)?.trim();
    if (!buffer) return;
    const context = this.runContexts.get(runId);
    if (!context || this.hasAssistantChild(context.rootMessageId)) return;
    const run = this.options.database.getRun(runId);
    const sessionId = run?.sessionId ?? this.options.sessionId;
    const taskId = run?.taskId ?? context.taskId;
    const message = this.options.database.addMessage({
      sessionId,
      taskId,
      parentMessageId: context.rootMessageId,
      role: "assistant",
      messageType: "text",
      content: buffer,
      model: run?.model ?? this.requireSession().model,
      tokens: estimateTextTokens(buffer),
      totalTokens: estimateTextTokens(buffer),
      compressedFromMessageId: null,
    });
    this.bumpAncestorTotals(context.rootMessageId, message.tokens);
    this.options.database.updateSession(sessionId, { latestAssistantMessage: buffer });
  }

  private emitEvent(envelope: RunnerEventEnvelope): void {
    this.options.emit(envelope);
  }

  private rejectAllPendingApprovals(): void {
    for (const [, resolver] of this.pendingApprovals) {
      resolver("rejected");
    }
    this.pendingApprovals.clear();
  }
}

function resolveRunPrompt(
  run: Run,
  runtime: ReturnType<SessionRuntime["snapshot"]>,
  session: Session,
): string | null {
  const candidate = run.prompt ?? runtime.lastUserPrompt ?? session.latestUserMessage;
  if (!candidate) return null;
  const trimmed = candidate.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function nextTaskStatus(current: Task["status"], event: "run_completed"): Task["status"] {
  if (event === "run_completed") {
    return current === "active" ? "review" : current;
  }
  return current;
}

function buildEffectivePrompt(
  prompt: string,
  contextFiles: string[],
  resolvedSkill: ResolvedSkill | null,
): string {
  const parts: string[] = [];
  if (resolvedSkill?.injectedPrompt) {
    parts.push(resolvedSkill.injectedPrompt);
  }
  parts.push(prompt);
  if (contextFiles.length > 0) {
    parts.push("\n\nContext files:\n" + contextFiles.map((file) => `- ${file}`).join("\n"));
  }
  return parts.join("\n\n");
}

function resolveToolExecutionMode(enabledTools: string[]): "sequential" | "parallel" {
  const allSafe = enabledTools.every((name) => SAFE_TOOL_NAMES.has(name));
  return allSafe ? "parallel" : "sequential";
}

function normalizeContextFiles(contextFiles?: string[]): string[] {
  return Array.isArray(contextFiles)
    ? [...new Set(contextFiles.map((entry) => entry.trim()).filter((entry) => entry.length > 0))]
    : [];
}

function estimateTextTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return Math.max(1, Math.ceil(trimmed.length / 4));
}

function resolveCompactionStartMessageId(
  messages: Array<{ id: string; messageType: string; compressedFromMessageId: string | null }>,
): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.messageType === "summary") {
      return message.compressedFromMessageId ?? message.id;
    }
  }
  return messages[0]?.id ?? null;
}
