/**
 * SubAgent Manager - SubAgent lifecycle and task delegation
 *
 * Manages SubAgent instances with spawn/send/wait/close tool chain.
 * SubAgents share the main workspace by default, with worktree isolation
 * only enabled when explicitly requested or multi-session is active.
 */

import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { TextContent, Static, TSchema } from "@mariozechner/pi-ai";
import { Type } from "@mariozechner/pi-ai";
import { createId, nowIso } from "@omi/core";

import type { Mailbox, MailboxMessage } from "./task-mailbox.js";
import { MailboxTopics } from "./task-mailbox.js";

// ============================================================================
// Types
// ============================================================================

/**
 * SubAgent status
 */
export type SubAgentStatus = "pending" | "initializing" | "running" | "waiting" | "completed" | "failed" | "closed";

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
  /** Working directory (defaults to parent workspace) */
  workspaceRoot?: string;
  /** Whether to use git worktree for isolation */
  isolated?: boolean;
  /** Parent agent ID */
  parentId: string;
  /** Model to use (inherits from parent if not specified) */
  model?: string;
  /** Provider to use */
  provider?: string;
  /** Tool restrictions for this subagent */
  allowedTools?: string[];
  /** Blocked tools for this subagent */
  blockedTools?: string[];
}

/**
 * SubAgent state
 */
export interface SubAgentState {
  id: string;
  name: string;
  status: SubAgentStatus;
  task: string;
  workspaceRoot: string;
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
  tools: AgentTool[];
}

/**
 * SubAgent spawn options
 */
export interface SpawnOptions {
  name?: string;
  workspaceRoot?: string;
  isolated?: boolean;
  model?: string;
  provider?: string;
  allowedTools?: string[];
  blockedTools?: string[];
}

/**
 * Delegated task result
 */
export interface TaskResult {
  subAgentId: string;
  status: "completed" | "failed" | "timeout" | "cancelled";
  result?: string;
  error?: string;
  completedAt: string;
  durationMs: number;
}

// ============================================================================
// Tool Schemas
// ============================================================================

export const spawnSchema: TSchema = Type.Object({
  name: Type.Optional(Type.String({ description: "Human-readable name for the subagent" })),
  task: Type.String({ description: "Task description for the subagent to execute" }),
  workspaceRoot: Type.Optional(Type.String({ description: "Working directory (defaults to parent workspace)" })),
  isolated: Type.Optional(Type.Boolean({ description: "Whether to use git worktree for isolation (default: false)" })),
  model: Type.Optional(Type.String({ description: "Model to use for the subagent" })),
  provider: Type.Optional(Type.String({ description: "Provider to use for the subagent" })),
  allowedTools: Type.Optional(Type.Array(Type.String())),
  blockedTools: Type.Optional(Type.Array(Type.String())),
});

export type SpawnInput = Static<typeof spawnSchema>;

export const sendSchema: TSchema = Type.Object({
  subAgentId: Type.String({ description: "ID of the subagent to send a message to" }),
  message: Type.String({ description: "Message content to send" }),
  topic: Type.Optional(Type.String({ description: "Message topic (default: task/delegate)" })),
});

export type SendInput = Static<typeof sendSchema>;

export const waitSchema: TSchema = Type.Object({
  subAgentId: Type.String({ description: "ID of the subagent to wait for" }),
  timeout: Type.Optional(Type.Number({ description: "Timeout in milliseconds (default: no timeout)" })),
});

export type WaitInput = Static<typeof waitSchema>;

export const closeSchema: TSchema = Type.Object({
  subAgentId: Type.String({ description: "ID of the subagent to close" }),
  force: Type.Optional(Type.Boolean({ description: "Force close without waiting for completion" })),
});

export type CloseInput = Static<typeof closeSchema>;

export const listSchema: TSchema = Type.Object({
  status: Type.Optional(Type.String({ description: "Filter by status (pending, running, completed, failed, closed)" })),
  parentId: Type.Optional(Type.String({ description: "Filter by parent agent ID" })),
});

export type ListInput = Static<typeof listSchema>;

// ============================================================================
// SubAgent Manager
// ============================================================================

export interface SubAgentManagerConfig {
  workspaceRoot: string;
  mailbox: Mailbox;
  getTools?: () => AgentTool[];
  onSubAgentStart?: (subAgent: SubAgent) => void;
  onSubAgentComplete?: (subAgent: SubAgent, result: TaskResult) => void;
  onSubAgentError?: (subAgent: SubAgent, error: Error) => void;
}

export class SubAgentManager {
  private readonly subAgents = new Map<string, SubAgent>();
  private readonly config: SubAgentManagerConfig;

  constructor(config: SubAgentManagerConfig) {
    this.config = config;
  }

  /**
   * Spawn a new SubAgent with the given task.
   */
  spawn(options: SpawnOptions & { task: string }): SubAgent {
    const id = createId("agent");
    const now = nowIso();

    const subAgent: SubAgent = {
      config: {
        id,
        name: options.name ?? `subagent-${id.slice(0, 8)}`,
        task: options.task,
        workspaceRoot: options.workspaceRoot ?? this.config.workspaceRoot,
        isolated: options.isolated ?? false,
        parentId: "main", // Will be set by parent
        model: options.model,
        provider: options.provider,
        allowedTools: options.allowedTools,
        blockedTools: options.blockedTools,
      },
      state: {
        id,
        name: options.name ?? `subagent-${id.slice(0, 8)}`,
        status: "initializing",
        task: options.task,
        workspaceRoot: options.workspaceRoot ?? this.config.workspaceRoot,
        parentId: "main",
        createdAt: now,
        messages: 0,
        toolCalls: 0,
      },
      mailbox: this.config.mailbox,
      abortController: new AbortController(),
      tools: this.buildToolsForSubAgent(id, options),
    };

    this.subAgents.set(id, subAgent);
    this.config.onSubAgentStart?.(subAgent);

    return subAgent;
  }

  /**
   * Send a message to a SubAgent.
   */
  send(subAgentId: string, message: string, topic: string = MailboxTopics.TASK_DELEGATE): MailboxMessage | null {
    const subAgent = this.subAgents.get(subAgentId);
    if (!subAgent) {
      return null;
    }

    return this.config.mailbox.sendTo("main", subAgentId, topic, { text: message });
  }

  /**
   * Wait for a SubAgent to complete.
   */
  async wait(subAgentId: string, timeoutMs?: number): Promise<TaskResult> {
    const subAgent = this.subAgents.get(subAgentId);
    if (!subAgent) {
      return {
        subAgentId,
        status: "failed",
        error: `SubAgent ${subAgentId} not found`,
        completedAt: nowIso(),
        durationMs: 0,
      };
    }

    const startTime = Date.now();

    // If already completed, return immediately
    if (subAgent.state.status === "completed" || subAgent.state.status === "failed") {
      return this.buildResult(subAgent, startTime);
    }

    return new Promise((resolve) => {
      // Subscribe to completion
      const subscription = this.config.mailbox.subscribe(
        MailboxTopics.TASK_COMPLETE,
        (msg) => {
          if (msg.senderId === subAgentId) {
            this.config.mailbox.unsubscribe(subscription.id);
            resolve(this.buildResult(subAgent, startTime));
          }
        },
      );

      // Also listen for failures
      const failSubscription = this.config.mailbox.subscribe(
        MailboxTopics.TASK_FAIL,
        (msg) => {
          if (msg.senderId === subAgentId) {
            this.config.mailbox.unsubscribe(failSubscription.id);
            resolve(this.buildResult(subAgent, startTime));
          }
        },
      );

      // Apply timeout if specified
      if (timeoutMs !== undefined && timeoutMs > 0) {
        setTimeout(() => {
          this.config.mailbox.unsubscribe(subscription.id);
          this.config.mailbox.unsubscribe(failSubscription.id);

          if (!subAgent.abortController.signal.aborted) {
            resolve({
              subAgentId,
              status: "timeout",
              error: `Timeout after ${timeoutMs}ms`,
              completedAt: nowIso(),
              durationMs: Date.now() - startTime,
            });
          }
        }, timeoutMs);
      }
    });
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
      this.config.mailbox.broadcast(subAgentId, MailboxTopics.SHUTDOWN, {
        reason: "Parent agent requested shutdown",
      });
    }

    // Abort any ongoing operations
    if (!subAgent.abortController.signal.aborted) {
      subAgent.abortController.abort();
    }

    // Update state
    subAgent.state.status = "closed";
    subAgent.state.completedAt = nowIso();

    // Clean up subscriptions
    this.cleanupSubAgent(subAgentId);

    return true;
  }

  /**
   * List all SubAgents.
   */
  list(filter?: { status?: SubAgentStatus; parentId?: string }): SubAgent[] {
    let agents = [...this.subAgents.values()];

    if (filter?.status) {
      agents = agents.filter((a) => a.state.status === filter.status);
    }

    if (filter?.parentId) {
      agents = agents.filter((a) => a.state.parentId === filter.parentId);
    }

    return agents;
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
    return this.subAgents.get(subAgentId)?.state;
  }

  /**
   * Update SubAgent status.
   */
  updateStatus(subAgentId: string, status: SubAgentStatus, error?: string): boolean {
    const subAgent = this.subAgents.get(subAgentId);
    if (!subAgent) {
      return false;
    }

    subAgent.state.status = status;
    if (status === "running") {
      subAgent.state.startedAt = nowIso();
    }
    if (status === "completed" || status === "failed" || status === "closed") {
      subAgent.state.completedAt = nowIso();
    }
    if (error) {
      subAgent.state.error = error;
    }

    // Emit events
    if (status === "completed") {
      const result = this.buildResult(subAgent, new Date(subAgent.state.createdAt).getTime());
      this.config.onSubAgentComplete?.(subAgent, result);
    } else if (status === "failed") {
      this.config.onSubAgentError?.(subAgent, new Error(error ?? "Unknown error"));
    }

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

  private buildToolsForSubAgent(subAgentId: string, options: SpawnOptions): AgentTool[] {
    // For now, return a subset of tools based on restrictions
    const allTools = this.config.getTools?.() ?? [];
    let filteredTools = allTools;

    if (options.allowedTools && options.allowedTools.length > 0) {
      filteredTools = filteredTools.filter((t) => options.allowedTools!.includes(t.name));
    }

    if (options.blockedTools && options.blockedTools.length > 0) {
      filteredTools = filteredTools.filter((t) => !options.blockedTools!.includes(t.name));
    }

    return filteredTools;
  }

  private cleanupSubAgent(subAgentId: string): void {
    // Remove from list (but keep state for inspection)
    // In a real implementation, we might archive instead of deleting
    const subAgent = this.subAgents.get(subAgentId);
    if (subAgent) {
      subAgent.state.status = "closed";
    }
  }

  private buildResult(subAgent: SubAgent, startTime: number): TaskResult {
    return {
      subAgentId: subAgent.config.id,
      status: subAgent.state.status === "completed"
        ? "completed"
        : subAgent.state.status === "failed"
          ? "failed"
          : "cancelled",
      result: subAgent.state.result,
      error: subAgent.state.error,
      completedAt: subAgent.state.completedAt ?? nowIso(),
      durationMs: Date.now() - startTime,
    };
  }
}

// ============================================================================
// Tool Factories
// ============================================================================

export function createSubAgentTools(
  manager: SubAgentManager,
): AgentTool<typeof spawnSchema | typeof sendSchema | typeof waitSchema | typeof closeSchema | typeof listSchema, unknown>[] {
  return [
    createSpawnTool(manager),
    createSendTool(manager),
    createWaitTool(manager),
    createCloseTool(manager),
    createListSubAgentsTool(manager),
  ];
}

function createSpawnTool(manager: SubAgentManager): AgentTool<typeof spawnSchema, { subAgentId: string }> {
  return {
    name: "subagent_spawn",
    label: "subagent_spawn",
    description: "Spawn a new SubAgent to execute a task in parallel with the main agent.",
    parameters: spawnSchema,
    execute: async (_toolCallId, params) => {
      try {
        const typedParams = params as SpawnOptions & { task: string };
        const subAgent = manager.spawn(typedParams);
        return {
          content: [{
            type: "text",
            text: `SubAgent spawned: ${subAgent.config.name} (${subAgent.config.id})\nTask: ${typedParams.task}\nWorkspace: ${subAgent.config.workspaceRoot}`,
          } as TextContent],
          details: { subAgentId: subAgent.config.id } as { subAgentId: string },
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Failed to spawn SubAgent: ${error instanceof Error ? error.message : String(error)}`,
          } as TextContent],
          details: { subAgentId: "" } as { subAgentId: string },
        };
      }
    },
  };
}

function createSendTool(manager: SubAgentManager): AgentTool<typeof sendSchema, { subAgentId: string }> {
  return {
    name: "subagent_send",
    label: "subagent_send",
    description: "Send a message to a running SubAgent.",
    parameters: sendSchema,
    execute: async (_toolCallId, params) => {
      const { subAgentId, message, topic } = params as { subAgentId: string; message: string; topic?: string };
      const result = manager.send(subAgentId, message, topic ?? MailboxTopics.TASK_DELEGATE);

      if (!result) {
        return {
          content: [{
            type: "text",
            text: `Failed to send message: SubAgent ${subAgentId} not found`,
          } as TextContent],
          details: { subAgentId: "" } as { subAgentId: string },
        };
      }

      return {
        content: [{
          type: "text",
          text: `Message sent to ${subAgentId} on topic ${topic ?? MailboxTopics.TASK_DELEGATE}\nMessage ID: ${result.id}`,
        } as TextContent],
        details: { subAgentId },
      };
    },
  };
}

function createWaitTool(manager: SubAgentManager): AgentTool<typeof waitSchema, { subAgentId: string; timedOut?: boolean }> {
  return {
    name: "subagent_wait",
    label: "subagent_wait",
    description: "Wait for a SubAgent to complete its task.",
    parameters: waitSchema,
    execute: async (_toolCallId, params) => {
      const { subAgentId, timeout } = params as { subAgentId: string; timeout?: number };

      try {
        const result = await manager.wait(subAgentId, timeout);

        let message = `SubAgent ${subAgentId} finished with status: ${result.status}`;
        if (result.result) {
          message += `\n\nResult:\n${result.result}`;
        }
        if (result.error) {
          message += `\n\nError:\n${result.error}`;
        }
        message += `\n\nDuration: ${(result.durationMs / 1000).toFixed(2)}s`;

        return {
          content: [{ type: "text", text: message } as TextContent],
          details: { subAgentId, timedOut: result.status === "timeout" },
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error waiting for SubAgent: ${error instanceof Error ? error.message : String(error)}`,
          } as TextContent],
          details: { subAgentId },
        };
      }
    },
  };
}

function createCloseTool(manager: SubAgentManager): AgentTool<typeof closeSchema, { subAgentId: string }> {
  return {
    name: "subagent_close",
    label: "subagent_close",
    description: "Close a SubAgent, optionally forcing termination.",
    parameters: closeSchema,
    execute: async (_toolCallId, params) => {
      const { subAgentId, force } = params as { subAgentId: string; force?: boolean };
      const success = manager.close(subAgentId, force ?? false);

      return {
        content: [{
          type: "text",
          text: success
            ? `SubAgent ${subAgentId} closed${force ? " (forced)" : ""}`
            : `Failed to close SubAgent ${subAgentId}: not found`,
        } as TextContent],
        details: { subAgentId },
      };
    },
  };
}

function createListSubAgentsTool(manager: SubAgentManager): AgentTool<typeof listSchema, { subAgents: SubAgentState[] }> {
  return {
    name: "subagent_list",
    label: "subagent_list",
    description: "List all SubAgents, optionally filtered by status or parent.",
    parameters: listSchema,
    execute: async (_toolCallId, params) => {
      const { status, parentId } = params as { status?: string; parentId?: string };
      const subAgents = manager.list({
        status: status as SubAgentStatus | undefined,
        parentId,
      });

      if (subAgents.length === 0) {
        return {
          content: [{ type: "text", text: "No SubAgents found." } as TextContent],
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
        ].filter(Boolean).join("\n");
      });

      return {
        content: [{ type: "text", text: lines.join("\n\n") } as TextContent],
        details: { subAgents: subAgents.map((a) => a.state) },
      };
    },
  };
}

// ============================================================================
// Exports
// ============================================================================
