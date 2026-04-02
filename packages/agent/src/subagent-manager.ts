/**
 * SubAgent Manager
 *
 * Manages sub-agent lifecycle with spawn/send/wait/close operations.
 * Supports:
 * - Task model: owner, writeScope, status, deadline, output
 * - Isolation strategies (shared workspace vs worktree)
 * - Background/foreground execution
 * - Structured output recovery
 */

import { createId, nowIso } from "@omi/core";
import type { ProviderConfig, Run, Session, Task, ToolCall } from "@omi/core";

// ============================================================================
// Types
// ============================================================================

export type SubAgentStatus =
  | "pending"
  | "spawning"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "canceled"
  | "timeout";

export type WriteScope = "shared" | "isolated" | "worktree";

export interface SubAgentConfig {
  /** Unique identifier for this sub-agent */
  id: string;
  /** Owner session ID (parent agent) */
  ownerId: string;
  /** Task description */
  task: string;
  /** Workspace scope */
  writeScope: WriteScope;
  /** Maximum execution time in ms */
  deadline?: number;
  /** Model to use */
  model?: string;
  /** Provider configuration */
  providerConfig?: ProviderConfig;
  /** Whether to run in background */
  background?: boolean;
  /** Custom instructions */
  instructions?: string;
  /** Parent worktree root (for isolation) */
  parentWorktreeRoot?: string;
}

export interface SubAgentState {
  id: string;
  ownerId: string;
  task: string;
  status: SubAgentStatus;
  writeScope: WriteScope;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  deadline?: number;
  output?: SubAgentOutput;
  error?: string;
  runId?: string;
  sessionId?: string;
}

export interface SubAgentOutput {
  success: boolean;
  text: string;
  toolCalls?: ToolCall[];
  error?: string;
  tokensUsed?: number;
  turns?: number;
}

export interface SpawnOptions {
  background?: boolean;
  deadline?: number;
  writeScope?: WriteScope;
}

// ============================================================================
// SubAgent Manager
// ============================================================================

export interface SubAgentManagerEvents {
  "subagent.spawned": { id: string; ownerId: string; task: string };
  "subagent.started": { id: string };
  "subagent.completed": { id: string; output: SubAgentOutput };
  "subagent.failed": { id: string; error: string };
  "subagent.canceled": { id: string };
  "subagent.timeout": { id: string };
}

export type SubAgentEventHandler<K extends keyof SubAgentManagerEvents> = (
  event: SubAgentManagerEvents[K],
) => void | Promise<void>;

export class SubAgentManager {
  private agents: Map<string, SubAgentState> = new Map();
  private callbacks: Map<keyof SubAgentManagerEvents, Set<SubAgentEventHandler<any>>> = new Map();
  private pendingResults: Map<string, (output: SubAgentOutput) => void> = new Map();
  private runningBackground: Set<string> = new Set();

  /**
   * Create a new sub-agent manager.
   */
  constructor(private readonly workspaceRoot: string) {}

  // ==========================================================================
  // Event Handling
  // ==========================================================================

  on<K extends keyof SubAgentManagerEvents>(
    event: K,
    handler: SubAgentEventHandler<K>,
  ): () => void {
    if (!this.callbacks.has(event)) {
      this.callbacks.set(event, new Set());
    }
    this.callbacks.get(event)!.add(handler);

    // Return unsubscribe function
    return () => {
      this.callbacks.get(event)?.delete(handler);
    };
  }

  private emit<K extends keyof SubAgentManagerEvents>(event: K, data: SubAgentManagerEvents[K]): void {
    const handlers = this.callbacks.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch {
          // Ignore handler errors
        }
      }
    }
  }

  // ==========================================================================
  // Lifecycle Management
  // ==========================================================================

  /**
   * Spawn a new sub-agent.
   */
  async spawn(config: SubAgentConfig): Promise<string> {
    const id = config.id || createId("subagent");
    const now = nowIso();

    const state: SubAgentState = {
      id,
      ownerId: config.ownerId,
      task: config.task,
      status: "spawning",
      writeScope: config.writeScope,
      createdAt: now,
      deadline: config.deadline,
    };

    this.agents.set(id, state);
    this.emit("subagent.spawned", { id, ownerId: config.ownerId, task: config.task });

    // Simulate spawning (in real implementation, this would create a new session/run)
    state.status = "pending";

    if (config.background) {
      this.runningBackground.add(id);
      this.executeBackground(id, config);
    }

    return id;
  }

  /**
   * Start a pending sub-agent.
   */
  async start(id: string): Promise<void> {
    const state = this.agents.get(id);
    if (!state) {
      throw new Error(`SubAgent ${id} not found`);
    }

    if (state.status !== "pending" && state.status !== "waiting") {
      throw new Error(`Cannot start sub-agent in status: ${state.status}`);
    }

    state.status = "running";
    state.startedAt = nowIso();
    this.emit("subagent.started", { id });
  }

  /**
   * Wait for a sub-agent to complete.
   */
  async wait(id: string, timeoutMs?: number): Promise<SubAgentOutput> {
    const state = this.agents.get(id);
    if (!state) {
      throw new Error(`SubAgent ${id} not found`);
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingResults.delete(id);
        reject(new Error(`Timeout waiting for sub-agent ${id}`));
      }, timeoutMs ?? state.deadline ?? 300000);

      this.pendingResults.set(id, (output) => {
        clearTimeout(timeout);
        resolve(output);
      });

      // If already completed, resolve immediately
      if (state.status === "completed" && state.output) {
        clearTimeout(timeout);
        this.pendingResults.delete(id);
        resolve(state.output);
      }
    });
  }

  /**
   * Send a message to a running sub-agent.
   */
  async send(id: string, message: string): Promise<void> {
    const state = this.agents.get(id);
    if (!state) {
      throw new Error(`SubAgent ${id} not found`);
    }

    if (state.status !== "running" && state.status !== "waiting") {
      throw new Error(`Cannot send to sub-agent in status: ${state.status}`);
    }

    // In real implementation, this would send a message to the sub-agent
    state.status = "running";
  }

  /**
   * Cancel a sub-agent.
   */
  async cancel(id: string): Promise<void> {
    const state = this.agents.get(id);
    if (!state) {
      throw new Error(`SubAgent ${id} not found`);
    }

    if (state.status === "completed" || state.status === "failed" || state.status === "canceled") {
      return; // Already terminal
    }

    state.status = "canceled";
    state.completedAt = nowIso();
    this.runningBackground.delete(id);

    this.emit("subagent.canceled", { id });

    // Reject pending result
    const pendingResult = this.pendingResults.get(id);
    if (pendingResult) {
      this.pendingResults.delete(id);
      pendingResult({
        success: false,
        text: "",
        error: "Canceled by owner",
      });
    }
  }

  /**
   * Close a sub-agent and clean up resources.
   */
  async close(id: string): Promise<void> {
    await this.cancel(id);
    this.agents.delete(id);
  }

  // ==========================================================================
  // State Queries
  // ==========================================================================

  /**
   * Get sub-agent state.
   */
  getState(id: string): SubAgentState | undefined {
    return this.agents.get(id);
  }

  /**
   * Get all sub-agents for an owner.
   */
  getByOwner(ownerId: string): SubAgentState[] {
    return [...this.agents.values()].filter((a) => a.ownerId === ownerId);
  }

  /**
   * Get sub-agents by status.
   */
  getByStatus(status: SubAgentStatus): SubAgentState[] {
    return [...this.agents.values()].filter((a) => a.status === status);
  }

  /**
   * Check if any sub-agent is running.
   */
  hasRunning(): boolean {
    return [...this.agents.values()].some(
      (a) => a.status === "running" || a.status === "pending" || a.status === "waiting",
    );
  }

  // ==========================================================================
  // Internal Execution
  // ==========================================================================

  private async executeBackground(id: string, config: SubAgentConfig): Promise<void> {
    const state = this.agents.get(id);
    if (!state) return;

    try {
      state.status = "running";
      state.startedAt = nowIso();
      this.emit("subagent.started", { id });

      // Simulate execution (in real implementation, this would run the agent)
      await this.simulateExecution(state, config);

      state.status = "completed";
      state.completedAt = nowIso();
      state.output = {
        success: true,
        text: `Completed task: ${config.task}`,
        turns: 1,
      };

      this.emit("subagent.completed", { id, output: state.output });

      // Resolve pending result
      if (state.output) {
        const pendingResult = this.pendingResults.get(id);
        if (pendingResult) {
          this.pendingResults.delete(id);
          pendingResult(state.output);
        }
      }
    } catch (error) {
      state.status = "failed";
      state.completedAt = nowIso();
      state.error = error instanceof Error ? error.message : String(error);
      state.output = {
        success: false,
        text: "",
        error: state.error,
      };

      this.emit("subagent.failed", { id, error: state.error });

      // Reject pending result
      if (state.output) {
        const pendingResult = this.pendingResults.get(id);
        if (pendingResult) {
          this.pendingResults.delete(id);
          pendingResult(state.output);
        }
      }
    } finally {
      this.runningBackground.delete(id);
    }
  }

  private async simulateExecution(state: SubAgentState, config: SubAgentConfig): Promise<void> {
    // Check deadline
    if (state.deadline) {
      const deadlineTimeout = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error("Deadline exceeded"));
          state.status = "timeout";
          this.emit("subagent.timeout", { id: state.id });
        }, state.deadline);
      });

      await Promise.race([
        this.doExecution(state, config),
        deadlineTimeout,
      ]);
    } else {
      await this.doExecution(state, config);
    }
  }

  private async doExecution(state: SubAgentState, config: SubAgentConfig): Promise<void> {
    // Simulated execution - in real implementation this would spawn an actual agent
    return new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a spawn configuration with sensible defaults.
 */
export function createSpawnConfig(
  ownerId: string,
  task: string,
  options?: SpawnOptions,
): SubAgentConfig {
  return {
    id: createId("subagent"),
    ownerId,
    task,
    writeScope: options?.writeScope ?? "shared",
    deadline: options?.deadline,
    background: options?.background ?? false,
  };
}

/**
 * Create an isolated sub-agent configuration.
 */
export function createIsolatedSpawnConfig(
  ownerId: string,
  task: string,
  parentWorktreeRoot: string,
  options?: SpawnOptions,
): SubAgentConfig {
  return {
    ...createSpawnConfig(ownerId, task, { ...options, writeScope: "isolated" }),
    writeScope: "worktree",
    parentWorktreeRoot,
  };
}
