/**
 * Swarm Mode
 *
 * Implements task-claiming pattern where multiple agents compete for
 * and collaborate on tasks without central coordination.
 */

import { createId, nowIso } from "@omi/core";
import { SubAgentManager, type SubAgentConfig, type SubAgentOutput } from "../subagent-manager";
import { TaskMailbox, type MailboxEvent, type EventFilter, type EventHandler } from "../task-mailbox";

// ============================================================================
// Types
// ============================================================================

export type SwarmAgentStatus = "idle" | "working" | "waiting" | "leaving";
export type SwarmStatus = "idle" | "accepting" | "processing" | "draining" | "completed" | "failed";

export interface SwarmTask {
  id: string;
  description: string;
  priority: number;
  claimedBy?: string;
  status: "available" | "claimed" | "in_progress" | "completed" | "failed" | "abandoned";
  result?: unknown;
  error?: string;
  claimedAt?: string;
  completedAt?: string;
  attempts: number;
}

export interface SwarmAgentInfo {
  id: string;
  name: string;
  status: SwarmAgentStatus;
  currentTask?: string;
  completedTasks: number;
  failedTasks: number;
  lastHeartbeat: string;
}

export interface SwarmConfig {
  maxAgents?: number;
  minAgents?: number;
  taskTimeout?: number;
  heartbeatInterval?: number;
  abandonTimeout?: number;
  maxTaskAttempts?: number;
}

export interface SwarmResult {
  success: boolean;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  abandonedTasks: number;
  results: Map<string, unknown>;
  summary: string;
}

// ============================================================================
// Swarm
// ============================================================================

export class Swarm {
  private swarmStatus: SwarmStatus = "idle";
  private tasks: Map<string, SwarmTask> = new Map();
  private agents: Map<string, SwarmAgentInfo> = new Map();
  private manager: SubAgentManager;
  private mailbox: TaskMailbox;
  private readonly config: Required<SwarmConfig>;
  private heartbeatTimers: Map<string, NodeJS.Timeout> = new Map();
  private drainResolve?: () => void;

  constructor(
    private readonly swarmId: string,
    private readonly workspaceRoot: string,
    config: SwarmConfig = {},
  ) {
    this.manager = new SubAgentManager(workspaceRoot);
    this.mailbox = new TaskMailbox();
    this.config = {
      maxAgents: config.maxAgents ?? 10,
      minAgents: config.minAgents ?? 1,
      taskTimeout: config.taskTimeout ?? 120000,
      heartbeatInterval: config.heartbeatInterval ?? 10000,
      abandonTimeout: config.abandonTimeout ?? 60000,
      maxTaskAttempts: config.maxTaskAttempts ?? 3,
    };

    this.setupMailboxHandlers();
  }

  // ==========================================================================
  // Task Management
  // ==========================================================================

  /**
   * Add a task to the swarm.
   */
  addTask(description: string, priority = 0): string {
    const taskId = createId("task");
    const task: SwarmTask = {
      id: taskId,
      description,
      priority,
      status: "available",
      attempts: 0,
    };

    this.tasks.set(taskId, task);
    this.mailbox.publishTaskNotification("submitted", this.swarmId, taskId, {
      description,
      priority,
    });

    return taskId;
  }

  /**
   * Add multiple tasks to the swarm.
   */
  addTasks(descriptions: string[], basePriority = 0): string[] {
    return descriptions.map((desc, i) => this.addTask(desc, basePriority - i));
  }

  /**
   * Get available tasks for claiming.
   */
  getAvailableTasks(): SwarmTask[] {
    return [...this.tasks.values()]
      .filter((t) => t.status === "available")
      .sort((a, b) => b.priority - a.priority);
  }

  /**
   * Get task by ID.
   */
  getTask(taskId: string): SwarmTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Get all tasks.
   */
  getAllTasks(): SwarmTask[] {
    return [...this.tasks.values()];
  }

  // ==========================================================================
  // Agent Management
  // ==========================================================================

  /**
   * Register a new agent with the swarm.
   */
  registerAgent(agentId: string, name: string): void {
    if (this.agents.size >= this.config.maxAgents) {
      throw new Error(`Swarm at capacity: ${this.config.maxAgents} agents`);
    }

    const agent: SwarmAgentInfo = {
      id: agentId,
      name,
      status: "idle",
      completedTasks: 0,
      failedTasks: 0,
      lastHeartbeat: nowIso(),
    };

    this.agents.set(agentId, agent);
    this.startHeartbeat(agentId);

    this.mailbox.publish({
      type: "agent.status",
      senderId: agentId,
      payload: { status: "registered", name },
    });
  }

  /**
   * Unregister an agent from the swarm.
   */
  unregisterAgent(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    // Abandon any current task
    if (agent.currentTask) {
      this.abandonTask(agent.currentTask, `Agent ${agentId} leaving`);
    }

    agent.status = "leaving";
    this.stopHeartbeat(agentId);
    this.agents.delete(agentId);

    this.mailbox.publish({
      type: "agent.status",
      senderId: agentId,
      payload: { status: "unregistered", name: agent.name },
    });
  }

  /**
   * Get agents by status.
   */
  getAgentsByStatus(status: SwarmAgentStatus): SwarmAgentInfo[] {
    return [...this.agents.values()].filter((a) => a.status === status);
  }

  // ==========================================================================
  // Task Claiming
  // ==========================================================================

  /**
   * Claim a task for an agent.
   */
  claimTask(agentId: string, taskId?: string): SwarmTask | null {
    const agent = this.agents.get(agentId);
    if (!agent) return null;

    if (agent.status === "working") {
      return null; // Already working
    }

    // Find task to claim
    let task: SwarmTask | undefined;
    if (taskId) {
      task = this.tasks.get(taskId);
      if (!task || task.status !== "available") {
        return null;
      }
    } else {
      // Auto-select highest priority available task
      const available = this.getAvailableTasks();
      task = available[0];
    }

    if (!task) return null;

    // Claim the task
    task.status = "claimed";
    task.claimedBy = agentId;
    task.claimedAt = nowIso();

    agent.status = "working";
    agent.currentTask = task.id;

    this.mailbox.publishTaskNotification("started", agentId, task.id, {
      claimedBy: agentId,
    });

    // Start task execution
    this.executeTask(agentId, task);

    return task;
  }

  /**
   * Execute a claimed task.
   */
  private async executeTask(agentId: string, task: SwarmTask): Promise<void> {
    task.status = "in_progress";
    const agent = this.agents.get(agentId);
    if (!agent) return;

    const config: SubAgentConfig = {
      id: createId("subagent"),
      ownerId: agentId,
      task: task.description,
      writeScope: "shared",
      deadline: this.config.taskTimeout,
      background: false,
    };

    try {
      const subAgentId = await this.manager.spawn(config);
      await this.manager.start(subAgentId);
      const output = await this.manager.wait(subAgentId, this.config.taskTimeout);

      if (output.success) {
        task.status = "completed";
        task.result = output.text;
        task.completedAt = nowIso();
        agent.completedTasks++;
      } else {
        task.status = "failed";
        task.error = output.error;
        agent.failedTasks++;
        task.attempts++;

        // Retry if under max attempts
        if (task.attempts < this.config.maxTaskAttempts) {
          task.status = "available";
          task.claimedBy = undefined;
          task.claimedAt = undefined;
          agent.currentTask = undefined;
          agent.status = "idle";

          this.mailbox.publishTaskNotification("failed", agentId, task.id, {
            error: task.error,
            recoverable: true,
          });
        } else {
          this.mailbox.publishTaskNotification("failed", agentId, task.id, {
            error: task.error,
            recoverable: false,
          });
        }
      }
    } catch (error) {
      task.status = "failed";
      task.error = error instanceof Error ? error.message : String(error);
      task.attempts++;
      agent.failedTasks++;
      agent.status = "idle";
      agent.currentTask = undefined;

      this.mailbox.publishTaskNotification("failed", agentId, task.id, {
        error: task.error,
        recoverable: task.attempts < this.config.maxTaskAttempts,
      });
    }

    if (task.status === "completed") {
      this.mailbox.publishTaskNotification("completed", agentId, task.id, {
        result: task.result,
      });
      agent.status = "idle";
      agent.currentTask = undefined;
    }
  }

  /**
   * Abandon a task.
   */
  abandonTask(taskId: string, reason?: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    if (task.claimedBy) {
      const agent = this.agents.get(task.claimedBy);
      if (agent) {
        agent.status = "idle";
        agent.currentTask = undefined;
      }
    }

    task.status = "abandoned";
    task.result = undefined;
    if (reason) task.error = reason;

    this.mailbox.publishTaskNotification("canceled", this.swarmId, taskId, { reason });
  }

  // ==========================================================================
  // Execution
  // ==========================================================================

  /**
   * Run the swarm until all tasks are complete or timeout.
   */
  async run(timeoutMs?: number): Promise<SwarmResult> {
    this.swarmStatus = "accepting";

    // Wait for minimum agents
    await this.waitForMinAgents();

    this.swarmStatus = "processing";

    // Run until complete or timeout
    const startTime = Date.now();
    while (this.hasActiveTasks() || this.hasIdleAgents()) {
      // Check timeout
      if (timeoutMs && Date.now() - startTime > timeoutMs) {
        break;
      }

      // Distribute available tasks
      this.distributeTasks();

      // Brief wait to prevent CPU spinning
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Drain remaining tasks
    this.swarmStatus = "draining";
    await this.drain();

    this.swarmStatus = "completed";
    return this.synthesizeResults();
  }

  /**
   * Wait for minimum agents to be available.
   */
  private async waitForMinAgents(): Promise<void> {
    while (this.agents.size < this.config.minAgents) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  /**
   * Check if there are active tasks.
   */
  private hasActiveTasks(): boolean {
    return [...this.tasks.values()].some(
      (t) => t.status === "claimed" || t.status === "in_progress" || t.status === "available",
    );
  }

  /**
   * Check if there are idle agents.
   */
  private hasIdleAgents(): boolean {
    return this.getAgentsByStatus("idle").length > 0;
  }

  /**
   * Distribute available tasks to idle agents.
   */
  private distributeTasks(): void {
    const idleAgents = this.getAgentsByStatus("idle");
    const availableTasks = this.getAvailableTasks();

    for (let i = 0; i < Math.min(idleAgents.length, availableTasks.length); i++) {
      this.claimTask(idleAgents[i].id, availableTasks[i].id);
    }
  }

  /**
   * Drain completed tasks.
   */
  private drain(): Promise<void> {
    return new Promise((resolve) => {
      this.drainResolve = resolve;

      const check = () => {
        const hasActive = [...this.tasks.values()].some(
          (t) => t.status === "claimed" || t.status === "in_progress",
        );
        if (!hasActive) {
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };

      setTimeout(check, 100);

      // Timeout for drain
      setTimeout(resolve, this.config.taskTimeout);
    });
  }

  // ==========================================================================
  // Heartbeat
  // ==========================================================================

  private startHeartbeat(agentId: string): void {
    const timer = setInterval(() => {
      const agent = this.agents.get(agentId);
      if (agent) {
        agent.lastHeartbeat = nowIso();

        // Check for abandoned tasks
        if (agent.status === "working" && agent.currentTask) {
          const task = this.tasks.get(agent.currentTask);
          if (task && task.claimedAt) {
            const elapsed = Date.now() - new Date(task.claimedAt).getTime();
            if (elapsed > this.config.abandonTimeout) {
              this.abandonTask(task.id, "Agent heartbeat timeout");
            }
          }
        }
      }
    }, this.config.heartbeatInterval);

    this.heartbeatTimers.set(agentId, timer);
  }

  private stopHeartbeat(agentId: string): void {
    const timer = this.heartbeatTimers.get(agentId);
    if (timer) {
      clearInterval(timer);
      this.heartbeatTimers.delete(agentId);
    }
  }

  // ==========================================================================
  // Mailbox
  // ==========================================================================

  private setupMailboxHandlers(): void {
    // Subscribe to task events for automatic task distribution
    this.mailbox.subscribe(
      { type: ["task.completed", "task.failed"] },
      () => {
        this.distributeTasks();
      },
    );

    // Subscribe to agent heartbeats
    this.mailbox.subscribe(
      { type: "agent.heartbeat" },
      (event) => {
        const agent = this.agents.get(event.senderId);
        if (agent) {
          agent.lastHeartbeat = event.timestamp;
        }
      },
    );
  }

  subscribe(filter: EventFilter, handler: EventHandler): string {
    return this.mailbox.subscribe(filter, handler);
  }

  unsubscribe(subscriptionId: string): void {
    this.mailbox.unsubscribe(subscriptionId);
  }

  // ==========================================================================
  // Synthesis
  // ==========================================================================

  private synthesizeResults(): SwarmResult {
    const results = new Map<string, unknown>();
    let completed = 0;
    let failed = 0;
    let abandoned = 0;

    for (const task of this.tasks.values()) {
      if (task.status === "completed" && task.result) {
        results.set(task.id, task.result);
        completed++;
      } else if (task.status === "failed") {
        failed++;
      } else if (task.status === "abandoned") {
        abandoned++;
      }
    }

    const total = this.tasks.size;
    const success = failed === 0 && abandoned === 0;

    return {
      success,
      totalTasks: total,
      completedTasks: completed,
      failedTasks: failed,
      abandonedTasks: abandoned,
      results,
      summary: `Swarm completed: ${completed}/${total} tasks successful. ${failed} failed, ${abandoned} abandoned.`,
    };
  }

  // ==========================================================================
  // State
  // ==========================================================================

  getStatus(): SwarmStatus {
    return this.swarmStatus;
  }

  getAgentCount(): number {
    return this.agents.size;
  }

  getTaskStats(): { total: number; available: number; completed: number; failed: number; abandoned: number } {
    const tasks = [...this.tasks.values()];
    return {
      total: tasks.length,
      available: tasks.filter((t) => t.status === "available").length,
      completed: tasks.filter((t) => t.status === "completed").length,
      failed: tasks.filter((t) => t.status === "failed").length,
      abandoned: tasks.filter((t) => t.status === "abandoned").length,
    };
  }

  shutdown(): void {
    // Stop all heartbeats
    for (const timer of this.heartbeatTimers.values()) {
      clearInterval(timer);
    }
    this.heartbeatTimers.clear();

    // Cancel all running tasks
    for (const agent of this.agents.values()) {
      if (agent.currentTask) {
        this.abandonTask(agent.currentTask, "Swarm shutdown");
      }
    }

    this.agents.clear();
    this.tasks.clear();
    this.mailbox.clearSubscriptions();
    this.swarmStatus = "failed";
  }
}
