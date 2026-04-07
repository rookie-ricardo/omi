/**
 * SubAgent Manager - SubAgent lifecycle and task delegation
 *
 * Manages SubAgent instances with spawn/send/wait/close tool chain.
 * SubAgents share the main workspace by default, with worktree isolation
 * only enabled when explicitly requested or multi-session is active.
 *
 * Architecture reference: open-agent-sdk/src/tools/OmiTool/
 */

import type { OmiTool } from "@omi/core";
import type { TextContent, TSchema } from "@mariozechner/pi-ai";
import { Type } from "@mariozechner/pi-ai";
import { createId, nowIso } from "@omi/core";

import { Mailbox, type MailboxMessage } from "./task-mailbox.js";
import { MailboxTopics } from "./task-mailbox.js";

// ============================================================================
// BuiltIn Agent Definition
// ============================================================================

/**
 * Built-in agent definition interface.
 * Inspired by open-agent-sdk's BuiltInAgentDefinition.
 */
export interface BuiltInAgentDefinition {
  /** Unique agent type identifier */
  agentType: string;
  /** Description of when to use this agent */
  whenToUse: string;
  /** Tool names allowed ('*' for all, or array of names) */
  tools: string[] | "*";
  /** Tools explicitly disallowed */
  disallowedTools?: string[];
  /** Maximum turns for this agent */
  maxTurns?: number;
  /** Model to use ('inherit' to use parent's model) */
  model?: string;
  /** Permission mode for this agent */
  permissionMode?: "bubble" | "plan" | "default";
  /** Source of the agent definition */
  source: "built-in" | "plugin" | "user";
  /** Base directory for agent resources */
  baseDir?: string;
  /** Whether to omit CLAUDE.md context */
  omitClaudeMd?: boolean;
  /** Hooks to register for this agent */
  hooks?: unknown[];
  /** Skills to preload for this agent */
  skills?: string[];
  /** MCP servers for this agent */
  mcpServers?: string[];
  /** Callback when agent completes */
  callback?: () => void;
  /** System prompt getter */
  getSystemPrompt?: (context?: unknown) => string;
}

// ============================================================================
// Types
// ============================================================================

export type WriteScope = "shared" | "isolated" | "worktree";

/**
 * SubAgent status
 */
export type SubAgentStatus =
  | "pending"
  | "initializing"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "canceled"
  | "closed";

/**
 * SubAgent configuration
 */
export interface SubAgentConfig {
  /** Unique identifier for the subagent */
  id: string;
  /** Human-readable name */
  name: string;
  /** Task description for the subagent */
  task: string;
  /** Owner of the task */
  ownerId: string;
  /** Workspace write scope */
  writeScope: WriteScope;
  /** Current status */
  status: SubAgentStatus;
  /** Deadline in milliseconds, if any */
  deadline?: number;
  /** Task output/result */
  output?: string;
  /** Whether the subagent is running in the background */
  background?: boolean;
  /** Agent definition if this is a built-in agent */
  agentDefinition?: BuiltInAgentDefinition;
  /** Working directory (defaults to parent workspace) */
  workspaceRoot?: string;
  /** Worktree path for isolated agents */
  worktreePath?: string;
  /** Parent agent ID */
  parentId: string;
  /** Model to use (inherits from parent if not specified) */
  model?: string;
  /** Tool restrictions for this subagent */
  allowedTools?: string[];
  /** Tools explicitly disallowed */
  disallowedTools?: string[];
  /** Permission mode */
  permissionMode?: "bubble" | "plan" | "default";
}

/**
 * SubAgent state
 */
export interface SubAgentState {
  id: string;
  name: string;
  status: SubAgentStatus;
  task: string;
  ownerId: string;
  writeScope: WriteScope;
  background: boolean;
  deadline?: number;
  output?: string;
  workspaceRoot: string;
  worktreePath?: string;
  parentId: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: string;
  error?: string;
  progress?: number;
  messages: number;
  toolCalls: number;
}

/**
 * SubAgent instance
 */
export interface SubAgent {
  config: SubAgentConfig;
  state: SubAgentState;
  mailbox: Mailbox;
  abortController: AbortController;
  tools: OmiTool[];
}

/**
 * SubAgent spawn options
 */
export interface SpawnOptions {
  /** Human-readable name */
  name?: string;
  /** Agent type for built-in agents */
  agentType?: string;
  /** Working directory */
  workspaceRoot?: string;
  /** Use git worktree isolation */
  isolated?: boolean;
  /** Model override */
  model?: string;
  /** Permission mode */
  permissionMode?: "bubble" | "plan" | "default";
  /** Allowed tools */
  allowedTools?: string[];
  /** Disallowed tools */
  disallowedTools?: string[];
  /** Maximum turns */
  maxTurns?: number;
  /** Skills to preload */
  skills?: string[];
  /** Description for display */
  description?: string;
  /** Workspace write scope */
  writeScope?: WriteScope;
  /** Whether to start in background */
  background?: boolean;
  /** Optional deadline in milliseconds */
  deadline?: number;
  /** Optional task output seed */
  output?: string;
  /** Status hint */
  status?: SubAgentStatus;
}

export interface SubAgentSpawnConfig extends SpawnOptions {
  ownerId: string;
  task: string;
  writeScope: WriteScope;
  background: boolean;
  status: SubAgentStatus;
}

export interface SubAgentSpawnRequest extends SpawnOptions {
  task: string;
  ownerId?: string;
}

/**
 * Delegated task result
 */
export interface TaskResult {
  subAgentId: string;
  status: "completed" | "failed" | "timeout" | "canceled";
  success?: boolean;
  text?: string;
  output?: string;
  result?: string;
  error?: string;
  completedAt: string;
  durationMs: number;
  terminalSource?: "live" | "tombstone";
  terminalAt?: string;
  tombstone?: boolean;
}

export function createSpawnConfig(
  ownerId: string,
  task: string,
  options: Partial<SubAgentSpawnConfig> = {},
): SubAgentSpawnConfig {
  const background = options.background ?? false;
  return {
    ...options,
    ownerId,
    task,
    writeScope: options.writeScope ?? "shared",
    background,
    status: options.status ?? "pending",
  };
}

// ============================================================================
// Tool Schemas
// ============================================================================

export const spawnSchema: TSchema = Type.Object({
  name: Type.Optional(
    Type.String({ description: "Human-readable name for the subagent" }),
  ),
  agentType: Type.Optional(
    Type.String({ description: "Type of built-in agent to use" }),
  ),
  task: Type.String({
    description: "Task description for the subagent to execute",
  }),
  ownerId: Type.Optional(
    Type.String({ description: "Owner agent ID" }),
  ),
  workspaceRoot: Type.Optional(
    Type.String({ description: "Working directory (defaults to parent workspace)" }),
  ),
  isolated: Type.Optional(
    Type.Boolean({
      description: "Whether to use git worktree for isolation (default: false)",
    }),
  ),
  model: Type.Optional(
    Type.String({ description: "Model to use for the subagent" }),
  ),
  permissionMode: Type.Optional(
    Type.Union([
      Type.Literal("bubble"),
      Type.Literal("plan"),
      Type.Literal("default"),
    ]),
  ),
  allowedTools: Type.Optional(Type.Array(Type.String())),
  disallowedTools: Type.Optional(Type.Array(Type.String())),
  maxTurns: Type.Optional(Type.Number()),
  skills: Type.Optional(Type.Array(Type.String())),
  writeScope: Type.Optional(
    Type.Union([
      Type.Literal("shared"),
      Type.Literal("isolated"),
      Type.Literal("worktree"),
    ]),
  ),
  background: Type.Optional(Type.Boolean()),
  deadline: Type.Optional(Type.Number()),
  output: Type.Optional(Type.String()),
});

export const sendSchema: TSchema = Type.Object({
  subAgentId: Type.String({
    description: "ID of the subagent to send a message to",
  }),
  message: Type.String({ description: "Message content to send" }),
  topic: Type.Optional(
    Type.String({ description: "Message topic (default: task/delegate)" }),
  ),
});

export const waitSchema: TSchema = Type.Object({
  subAgentId: Type.String({
    description: "ID of the subagent to wait for",
  }),
  timeout: Type.Optional(
    Type.Number({
      description: "Timeout in milliseconds (default: no timeout)",
    }),
  ),
});

export const closeSchema: TSchema = Type.Object({
  subAgentId: Type.String({
    description: "ID of the subagent to close",
  }),
  force: Type.Optional(
    Type.Boolean({
      description: "Force close without waiting for completion",
    }),
  ),
});

export const listSchema: TSchema = Type.Object({
  status: Type.Optional(
    Type.String({
      description: "Filter by status (pending, running, completed, failed, canceled, closed)",
    }),
  ),
  parentId: Type.Optional(Type.String({ description: "Filter by parent agent ID" })),
  ownerId: Type.Optional(Type.String({ description: "Filter by owner agent ID" })),
});

// ============================================================================
// Built-in Agents Registry
// ============================================================================

/**
 * Registry of built-in agent definitions.
 */
const builtInAgents = new Map<string, BuiltInAgentDefinition>();

/**
 * Register a built-in agent definition.
 */
export function registerBuiltInAgent(agent: BuiltInAgentDefinition): void {
  builtInAgents.set(agent.agentType, agent);
}

/**
 * Get a built-in agent definition by type.
 */
export function getBuiltInAgent(agentType: string): BuiltInAgentDefinition | undefined {
  return builtInAgents.get(agentType);
}

/**
 * List all registered built-in agents.
 */
export function listBuiltInAgents(): BuiltInAgentDefinition[] {
  return [...builtInAgents.values()];
}

// Default built-in agent: general purpose
registerBuiltInAgent({
  agentType: "general-purpose",
  whenToUse:
    "General-purpose agent for executing tasks. Use when no specific agent type fits.",
  tools: ["*"],
  maxTurns: 100,
  model: "inherit",
  permissionMode: "default",
  source: "built-in",
  getSystemPrompt: () =>
    `You are a general-purpose agent. Complete the task fully.`,
});

// ============================================================================
// SubAgent Manager
// ============================================================================

export interface SubAgentManagerConfig {
  workspaceRoot: string;
  mailbox?: Mailbox;
  parentId?: string;
  getTools?: () => OmiTool[];
  getSystemPrompt?: () => string;
  builtInAgents?: BuiltInAgentDefinition[];
  onSubAgentStart?: (subAgent: SubAgent) => void;
  onSubAgentComplete?: (subAgent: SubAgent, result: TaskResult) => void;
  onSubAgentError?: (subAgent: SubAgent, error: Error) => void;
  tombstoneRetentionMs?: number;
}

type SubAgentManagerEvent =
  | "subagent.spawned"
  | "subagent.started"
  | "subagent.completed"
  | "subagent.failed"
  | "subagent.canceled"
  | "subagent.closed";

export class SubAgentManager {
  private readonly subAgents = new Map<string, SubAgent>();
  private readonly tombstones = new Map<string, SubAgentState>();
  private readonly listeners = new Map<SubAgentManagerEvent, Set<(subAgent: SubAgent, result?: TaskResult) => void>>();
  private readonly config: SubAgentManagerConfig;

  constructor(workspaceRoot: string);
  constructor(config: SubAgentManagerConfig);
  constructor(configOrWorkspaceRoot: string | SubAgentManagerConfig) {
    if (typeof configOrWorkspaceRoot === "string") {
      this.config = {
        workspaceRoot: configOrWorkspaceRoot,
        mailbox: new Mailbox(),
        parentId: "main",
        builtInAgents: [],
      };
    } else {
      this.config = {
        parentId: "main",
        builtInAgents: [],
        mailbox: new Mailbox(),
        tombstoneRetentionMs: 300000,
        ...configOrWorkspaceRoot,
      };
    }

    // Register built-in agents
    for (const agent of this.config.builtInAgents ?? []) {
      registerBuiltInAgent(agent);
    }
  }

  on(
    event: SubAgentManagerEvent,
    listener: (subAgent: SubAgent, result?: TaskResult) => void,
  ): () => void {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return () => {
      const current = this.listeners.get(event);
      current?.delete(listener);
      if (current && current.size === 0) {
        this.listeners.delete(event);
      }
    };
  }

  /**
   * Spawn a new SubAgent with the given task.
   */
  spawn(options: SubAgentSpawnRequest): string {
    const id = createId("agent");
    const now = nowIso();
    const name = options.name ?? `subagent-${id.slice(0, 8)}`;
    const ownerId = options.ownerId ?? this.config.parentId ?? "main";

    // Get agent definition if agentType is specified
    const agentDefinition = options.agentType
      ? getBuiltInAgent(options.agentType)
      : undefined;

    // Determine effective tools
    const agentTools = agentDefinition?.tools === "*" ? undefined : agentDefinition?.tools;
    const effectiveAllowedTools = options.allowedTools ?? agentTools;
    const effectiveDisallowedTools = options.disallowedTools ?? agentDefinition?.disallowedTools;
    const effectiveModel = options.model ?? agentDefinition?.model ?? "inherit";
    const effectivePermissionMode =
      options.permissionMode ?? agentDefinition?.permissionMode ?? "default";
    const effectiveWriteScope = options.writeScope
      ?? (options.isolated ? "isolated" : "shared");
    const effectiveBackground = options.background ?? false;
    const effectiveStatus = options.status
      ?? (effectiveBackground ? "running" : "pending");
    const effectiveDeadline = options.deadline;
    const effectiveOutput = options.output;

    const subAgent: SubAgent = {
      config: {
        id,
        name,
        task: options.task,
        ownerId,
        writeScope: effectiveWriteScope,
        status: effectiveStatus,
        deadline: effectiveDeadline,
        output: effectiveOutput,
        background: effectiveBackground,
        agentDefinition,
        workspaceRoot: options.workspaceRoot ?? this.config.workspaceRoot,
        parentId: this.config.parentId ?? "main",
        model: effectiveModel,
        allowedTools: effectiveAllowedTools,
        disallowedTools: effectiveDisallowedTools,
        permissionMode: effectivePermissionMode,
      },
      state: {
        id,
        name,
        status: effectiveStatus,
        task: options.task,
        ownerId,
        writeScope: effectiveWriteScope,
        background: effectiveBackground,
        deadline: effectiveDeadline,
        output: effectiveOutput,
        workspaceRoot: options.workspaceRoot ?? this.config.workspaceRoot,
        parentId: this.config.parentId ?? "main",
        createdAt: now,
        startedAt: effectiveStatus === "running" ? now : undefined,
        messages: 0,
        toolCalls: 0,
      },
      mailbox: this.config.mailbox ?? new Mailbox(),
      abortController: new AbortController(),
      tools: this.buildToolsForSubAgent(id, {
        allowedTools: effectiveAllowedTools,
        disallowedTools: effectiveDisallowedTools,
      }),
    };

    this.subAgents.set(id, subAgent);
    this.emit("subagent.spawned", subAgent);
    this.config.onSubAgentStart?.(subAgent);

    return id;
  }

  /**
   * Send a message to a SubAgent.
   */
  send(
    subAgentId: string,
    message: string,
    topic: string = MailboxTopics.TASK_DELEGATE,
  ): MailboxMessage | null {
    const subAgent = this.subAgents.get(subAgentId);
    if (!subAgent) {
      return null;
    }

    subAgent.state.messages++;

    const mailbox = this.config.mailbox ?? subAgent.mailbox;
    return mailbox.sendTo(
      this.config.parentId ?? "main",
      subAgentId,
      topic,
      { text: message },
    );
  }

  /**
   * Start a SubAgent.
   */
  start(subAgentId: string): boolean {
    return this.updateStatus(subAgentId, "running");
  }

  /**
   * Wait for a SubAgent to complete.
   */
  async wait(subAgentId: string, timeoutMs?: number): Promise<TaskResult> {
    const subAgent = this.subAgents.get(subAgentId);
    const tombstone = this.tombstones.get(subAgentId);
    if (!subAgent) {
      if (tombstone) {
        return this.buildResultFromState(
          subAgentId,
          tombstone,
          Date.now(),
          "tombstone",
        );
      }
      return {
        subAgentId,
        status: "failed",
        success: false,
        text: `SubAgent ${subAgentId} not found`,
        error: `SubAgent ${subAgentId} not found`,
        completedAt: nowIso(),
        durationMs: 0,
      };
    }

    const startTime = Date.now();

    if (timeoutMs !== undefined && timeoutMs <= 0) {
      return this.buildResult(subAgent, startTime, "live");
    }

    if (this.isTerminalStatus(subAgent.state.status)) {
      return this.buildResult(subAgent, startTime, "live");
    }

    if (subAgent.state.status === "pending" || subAgent.state.status === "initializing") {
      this.start(subAgentId);
    }

    const timeout = timeoutMs ?? subAgent.state.deadline ?? 300000;
    const deadlineAt = Date.now() + timeout;
    while (Date.now() < deadlineAt) {
      const latest = this.subAgents.get(subAgentId);
      if (!latest) {
        const closedState = this.tombstones.get(subAgentId);
        if (closedState) {
          return this.buildResultFromState(
            subAgentId,
            closedState,
            startTime,
            "tombstone",
          );
        }
        return {
          subAgentId,
          status: "canceled",
          success: false,
          text: `Sub-agent ${subAgentId} was closed`,
          error: `Sub-agent ${subAgentId} was closed`,
          completedAt: nowIso(),
          durationMs: Date.now() - startTime,
        };
      }

      if (this.isTerminalStatus(latest.state.status)) {
        return this.buildResult(latest, startTime, "live");
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    return {
      subAgentId,
      status: "timeout",
      success: false,
      text: `Timeout waiting for sub-agent ${subAgentId}`,
      error: `Timeout waiting for sub-agent ${subAgentId}`,
      completedAt: nowIso(),
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Close a SubAgent.
   */
  close(subAgentId: string, force: boolean = false): boolean {
    const subAgent = this.subAgents.get(subAgentId);
    if (!subAgent) {
      return false;
    }

    if (!force) {
      // Send shutdown signal and wait for graceful completion
      (this.config.mailbox ?? subAgent.mailbox).broadcast(subAgentId, MailboxTopics.SHUTDOWN, {
        reason: "Parent agent requested shutdown",
      });
    }

    // Abort any ongoing operations
    if (!subAgent.abortController.signal.aborted) {
      subAgent.abortController.abort();
    }

    subAgent.state.status = "closed";
    subAgent.state.completedAt = nowIso();
    this.tombstones.set(subAgentId, {
      ...subAgent.state,
      status: "closed",
      completedAt: subAgent.state.completedAt,
    });
    this.scheduleTombstoneCleanup(subAgentId);
    this.emit("subagent.closed", subAgent);

    // Clean up
    this.cleanupSubAgent(subAgentId);

    return true;
  }

  /**
   * Cancel a SubAgent without removing it from the manager.
   */
  cancel(subAgentId: string): boolean {
    const subAgent = this.subAgents.get(subAgentId);
    if (!subAgent) {
      return false;
    }

    if (!subAgent.abortController.signal.aborted) {
      subAgent.abortController.abort();
    }

    subAgent.state.status = "canceled";
    subAgent.state.completedAt = nowIso();
    this.emit("subagent.canceled", subAgent);
    return true;
  }

  /**
   * List all SubAgents.
   */
  list(filter?: {
    status?: SubAgentStatus;
    parentId?: string;
    ownerId?: string;
  }): SubAgent[] {
    const activeAgents = [...this.subAgents.values()];
    const tombstoneAgents = [...this.tombstones.values()].map((state) => this.buildTombstoneAgent(state));
    let agents = [...activeAgents, ...tombstoneAgents];

    if (filter?.status) {
      agents = agents.filter((a) => a.state.status === filter.status);
    }

    if (filter?.parentId) {
      agents = agents.filter((a) => a.state.parentId === filter.parentId);
    }

    if (filter?.ownerId) {
      agents = agents.filter((a) => a.state.ownerId === filter.ownerId);
    }

    return agents;
  }

  getByOwner(ownerId: string): SubAgentState[] {
    return this.list({ ownerId }).map((agent) => agent.state);
  }

  getByStatus(status: SubAgentStatus): SubAgentState[] {
    return this.list({ status }).map((agent) => agent.state);
  }

  hasRunning(): boolean {
    return [...this.subAgents.values()].some((agent) =>
      agent.state.status === "pending"
      || agent.state.status === "initializing"
      || agent.state.status === "running"
      || agent.state.status === "waiting",
    );
  }

  /**
   * Get a specific SubAgent.
   */
  get(subAgentId: string): SubAgent | undefined {
    return this.subAgents.get(subAgentId);
  }

  /**
   * Get SubAgent state snapshot.
   */
  getState(subAgentId: string): SubAgentState | undefined {
    return this.subAgents.get(subAgentId)?.state ?? this.tombstones.get(subAgentId);
  }

  /**
   * Update SubAgent status.
   */
  updateStatus(
    subAgentId: string,
    status: SubAgentStatus,
    error?: string,
  ): boolean {
    const subAgent = this.subAgents.get(subAgentId);
    if (!subAgent) {
      return false;
    }

    subAgent.state.status = status;
    subAgent.config.status = status;
    if (status === "running") {
      subAgent.state.startedAt = nowIso();
    }
    if (
      status === "completed" ||
      status === "failed" ||
      status === "canceled" ||
      status === "closed"
    ) {
      subAgent.state.completedAt = nowIso();
    }
    if (error) {
      subAgent.state.error = error;
      subAgent.config.output = error;
    }

    // Emit events
    if (status === "completed") {
      const result = this.buildResult(
        subAgent,
        new Date(subAgent.state.createdAt).getTime(),
        "live",
      );
      this.config.onSubAgentComplete?.(subAgent, result);
      this.emit("subagent.completed", subAgent, result);
    } else if (status === "failed") {
      this.config.onSubAgentError?.(subAgent, new Error(error ?? "Unknown error"));
      this.emit("subagent.failed", subAgent);
    } else if (status === "canceled") {
      this.emit("subagent.canceled", subAgent);
    }

    return true;
  }

  /**
   * Update SubAgent result.
   */
  setResult(subAgentId: string, result: string): boolean {
    const subAgent = this.subAgents.get(subAgentId);
    if (!subAgent) {
      return false;
    }
    subAgent.state.result = result;
    subAgent.state.output = result;
    subAgent.config.output = result;
    return true;
  }

  /**
   * Increment message counter for a SubAgent.
   */
  incrementMessages(subAgentId: string): void {
    const subAgent = this.subAgents.get(subAgentId);
    if (subAgent) {
      subAgent.state.messages++;
    }
  }

  /**
   * Increment tool call counter for a SubAgent.
   */
  incrementToolCalls(subAgentId: string): void {
    const subAgent = this.subAgents.get(subAgentId);
    if (subAgent) {
      subAgent.state.toolCalls++;
    }
  }

  /**
   * Set progress for a SubAgent.
   */
  setProgress(subAgentId: string, progress: number): boolean {
    const subAgent = this.subAgents.get(subAgentId);
    if (!subAgent) {
      return false;
    }
    subAgent.state.progress = Math.min(100, Math.max(0, progress));
    return true;
  }

  private buildToolsForSubAgent(
    _subAgentId: string,
    options: {
      allowedTools?: string[];
      disallowedTools?: string[];
    },
  ): OmiTool[] {
    const allTools = this.config.getTools?.() ?? [];
    let filteredTools = allTools;

    // Handle allowed tools
    if (options.allowedTools && options.allowedTools.length > 0) {
      filteredTools = filteredTools.filter((t) =>
        options.allowedTools!.includes(t.name),
      );
    }

    if (options.disallowedTools && options.disallowedTools.length > 0) {
      filteredTools = filteredTools.filter(
        (t) => !options.disallowedTools!.includes(t.name),
      );
    }

    return filteredTools;
  }

  private cleanupSubAgent(subAgentId: string): void {
    this.subAgents.delete(subAgentId);
  }

  private buildResult(
    subAgent: SubAgent,
    startTime: number,
    terminalSource: "live" | "tombstone",
  ): TaskResult {
    return this.buildResultFromState(
      subAgent.config.id,
      subAgent.state,
      startTime,
      terminalSource,
    );
  }

  private buildResultFromState(
    subAgentId: string,
    state: SubAgentState,
    startTime: number,
    terminalSource: "live" | "tombstone",
  ): TaskResult {
    const resultText = state.output ?? state.result ?? state.error ?? "";
    const success = state.status === "completed";
    return {
      subAgentId,
      status:
        state.status === "completed"
          ? "completed"
          : state.status === "failed"
            ? "failed"
            : state.status === "canceled" || state.status === "closed"
              ? "canceled"
              : "timeout",
      success,
      text: resultText,
      output: state.output ?? state.result,
      result: state.result ?? state.output,
      error: state.error,
      completedAt: state.completedAt ?? nowIso(),
      durationMs: Date.now() - startTime,
      terminalSource,
      terminalAt: state.completedAt ?? nowIso(),
      tombstone: terminalSource === "tombstone",
    };
  }

  private isTerminalStatus(status: SubAgentStatus): boolean {
    return status === "completed" || status === "failed" || status === "canceled" || status === "closed";
  }

  private buildTombstoneAgent(state: SubAgentState): SubAgent {
    return {
      config: {
        id: state.id,
        name: state.name,
        task: state.task,
        ownerId: state.ownerId,
        writeScope: state.writeScope,
        status: state.status,
        output: state.output,
        workspaceRoot: state.workspaceRoot,
        parentId: state.parentId,
        background: state.background,
      },
      state: { ...state },
      mailbox: this.config.mailbox ?? new Mailbox(),
      abortController: new AbortController(),
      tools: [],
    };
  }

  private scheduleTombstoneCleanup(subAgentId: string): void {
    const retentionMs = this.config.tombstoneRetentionMs ?? 300000;
    if (retentionMs <= 0) {
      return;
    }
    setTimeout(() => {
      this.tombstones.delete(subAgentId);
    }, retentionMs);
  }

  private emit(event: SubAgentManagerEvent, subAgent: SubAgent, result?: TaskResult): void {
    const listeners = this.listeners.get(event);
    if (!listeners || listeners.size === 0) {
      return;
    }

    for (const listener of listeners) {
      try {
        listener(subAgent, result);
      } catch {
        // Ignore listener errors
      }
    }
  }
}

// ============================================================================
// Tool Factories
// ============================================================================

function makeTextContent(text: string): TextContent {
  return { type: "text", text };
}

function makeErrorContent(error: unknown): TextContent {
  return {
    type: "text",
    text:
      error instanceof Error ? error.message : String(error),
  };
}

export function createSubOmiTools(
  manager: SubAgentManager,
): OmiTool[] {
  return [
    createSpawnTool(manager),
    createSendTool(manager),
    createWaitTool(manager),
    createCloseTool(manager),
    createListSubAgentsTool(manager),
  ];
}

function createSpawnTool(manager: SubAgentManager): OmiTool {
  return {
    name: "subagent.spawn",
    label: "subagent.spawn",
    description:
      "Spawn a new SubAgent to execute a task in parallel with the main agent.",
    parameters: spawnSchema,
    execute: async (_toolCallId, params: unknown) => {
      try {
        const typedParams = params as SubAgentSpawnRequest;
        const subAgentId = manager.spawn(typedParams);
        const subAgentState = manager.getState(subAgentId);
        return {
          content: [
            makeTextContent(
              `SubAgent spawned: ${subAgentState?.name ?? subAgentId} (${subAgentId})\n` +
                `Task: ${typedParams.task}\n` +
                `Workspace: ${subAgentState?.workspaceRoot ?? "unknown"}`,
            ),
          ],
          details: { subAgentId },
        };
      } catch (error) {
        return {
          content: [makeErrorContent(error)],
          details: {},
        };
      }
    },
  };
}

function createSendTool(manager: SubAgentManager): OmiTool {
  return {
    name: "subagent.send",
    label: "subagent.send",
    description: "Send a message to a running SubAgent.",
    parameters: sendSchema,
    execute: async (_toolCallId, params: unknown) => {
      const typedParams = params as {
        subAgentId: string;
        message: string;
        topic?: string;
      };
      const result = manager.send(
        typedParams.subAgentId,
        typedParams.message,
        typedParams.topic ?? MailboxTopics.TASK_DELEGATE,
      );

      if (!result) {
        return {
          content: [
            makeTextContent(
              `Failed to send message: SubAgent ${typedParams.subAgentId} not found`,
            ),
          ],
          details: {},
        };
      }

      return {
        content: [
          makeTextContent(
            `Message sent to ${typedParams.subAgentId} on topic ${typedParams.topic ?? MailboxTopics.TASK_DELEGATE}\n` +
              `Message ID: ${result.id}`,
          ),
        ],
        details: { subAgentId: typedParams.subAgentId },
      };
    },
  };
}

function createWaitTool(manager: SubAgentManager): OmiTool {
  return {
    name: "subagent.wait",
    label: "subagent.wait",
    description: "Wait for a SubAgent to complete its task.",
    parameters: waitSchema,
    execute: async (_toolCallId, params: unknown) => {
      const typedParams = params as {
        subAgentId: string;
        timeout?: number;
      };

      try {
        const result = await manager.wait(
          typedParams.subAgentId,
          typedParams.timeout,
        );

        let message = `SubAgent ${typedParams.subAgentId} finished with status: ${result.status}`;
        if (result.result) {
          message += `\n\nResult:\n${result.result}`;
        }
        if (result.error) {
          message += `\n\nError:\n${result.error}`;
        }
        message += `\n\nDuration: ${(result.durationMs / 1000).toFixed(2)}s`;

        return {
          content: [makeTextContent(message)],
          details: {
            subAgentId: typedParams.subAgentId,
            timedOut: result.status === "timeout",
          },
        };
      } catch (error) {
        return {
          content: [makeErrorContent(error)],
          details: { subAgentId: typedParams.subAgentId },
        };
      }
    },
  };
}

function createCloseTool(manager: SubAgentManager): OmiTool {
  return {
    name: "subagent.close",
    label: "subagent.close",
    description: "Close a SubAgent, optionally forcing termination.",
    parameters: closeSchema,
    execute: async (_toolCallId, params: unknown) => {
      const typedParams = params as {
        subAgentId: string;
        force?: boolean;
      };
      const success = manager.close(
        typedParams.subAgentId,
        typedParams.force ?? false,
      );

      return {
        content: [
          makeTextContent(
            success
              ? `SubAgent ${typedParams.subAgentId} closed${typedParams.force ? " (forced)" : ""}`
              : `Failed to close SubAgent ${typedParams.subAgentId}: not found`,
          ),
        ],
        details: { subAgentId: typedParams.subAgentId },
      };
    },
  };
}

function createListSubAgentsTool(manager: SubAgentManager): OmiTool {
  return {
    name: "subagent_list",
    label: "subagent_list",
    description:
      "List all SubAgents, optionally filtered by status or parent.",
    parameters: listSchema,
    execute: async (_toolCallId, params: unknown) => {
      const typedParams = (params ?? {}) as {
        status?: string;
        parentId?: string;
        ownerId?: string;
      };
      const subAgents = manager.list({
        status: typedParams.status as SubAgentStatus | undefined,
        parentId: typedParams.parentId,
        ownerId: typedParams.ownerId,
      });

      if (subAgents.length === 0) {
        return {
          content: [makeTextContent("No SubAgents found.")],
          details: { subAgents: [] },
        };
      }

      const lines = subAgents.map((agent) => {
        const state = agent.state;
        return [
          `## ${state.name} (${state.id})`,
          `- Status: ${state.status}`,
          `- Task: ${state.task.slice(0, 100)}${state.task.length > 100 ? "..." : ""}`,
          `- Workspace: ${state.workspaceRoot}`,
          `- Created: ${state.createdAt}`,
          state.startedAt ? `- Started: ${state.startedAt}` : null,
          state.completedAt ? `- Completed: ${state.completedAt}` : null,
          state.error ? `- Error: ${state.error}` : null,
          `- Messages: ${state.messages}, Tool Calls: ${state.toolCalls}`,
        ]
          .filter(Boolean)
          .join("\n");
      });

      return {
        content: [makeTextContent(lines.join("\n\n"))],
        details: {
          subAgents: subAgents.map((a) => a.state),
        },
      };
    },
  };
}

// ============================================================================
// Exports
// ============================================================================
