/**
 * Coordinator Mode
 *
 * Implements central orchestration pattern where a coordinator agent
 * distributes tasks to worker agents and synthesizes results.
 */

import { createId, nowIso } from "@omi/core";
import { SubAgentManager, type SubAgentConfig, type SubAgentOutput } from "../subagent-manager";
import { TaskMailbox, createTaskSubmittedEvent, createTaskCompletedEvent, createTaskFailedEvent } from "../task-mailbox";

// ============================================================================
// Types
// ============================================================================

export type CoordinatorStatus = "idle" | "planning" | "dispatching" | "waiting" | "synthesizing" | "completed" | "failed";

export interface CoordinatorTask {
  id: string;
  description: string;
  priority: number;
  assignedTo?: string;
  status: "pending" | "assigned" | "running" | "completed" | "failed" | "skipped";
  result?: unknown;
  error?: string;
}

export interface CoordinatorPlan {
  id: string;
  tasks: CoordinatorTask[];
  createdAt: string;
  completedAt?: string;
}

export interface CoordinatorResult {
  success: boolean;
  planId: string;
  results: Map<string, unknown>;
  errors: Map<string, string>;
  summary: string;
}

export interface CoordinatorOptions {
  maxConcurrent?: number;
  timeout?: number;
  retryOnFailure?: boolean;
  maxRetries?: number;
}

// ============================================================================
// Coordinator
// ============================================================================

export class CoordinatorAgent {
  private status: CoordinatorStatus = "idle";
  private plan?: CoordinatorPlan;
  private manager: SubAgentManager;
  private mailbox: TaskMailbox;
  private results: Map<string, SubAgentOutput> = new Map();
  private errors: Map<string, string> = new Map();
  private readonly maxConcurrent: number;
  private readonly timeout: number;
  private readonly retryOnFailure: boolean;
  private readonly maxRetries: number;

  constructor(
    private readonly coordinatorId: string,
    private readonly workspaceRoot: string,
    options: CoordinatorOptions = {},
  ) {
    this.manager = new SubAgentManager(workspaceRoot);
    this.mailbox = new TaskMailbox();
    this.maxConcurrent = options.maxConcurrent ?? 3;
    this.timeout = options.timeout ?? 300000;
    this.retryOnFailure = options.retryOnFailure ?? true;
    this.maxRetries = options.maxRetries ?? 2;

    this.setupMailboxHandlers();
  }

  // ==========================================================================
  // Planning
  // ==========================================================================

  /**
   * Create a plan with tasks to be executed.
   */
  createPlan(tasks: string[]): CoordinatorPlan {
    const planId = createId("plan");
    const planTasks: CoordinatorTask[] = tasks.map((description, index) => ({
      id: createId("task"),
      description,
      priority: tasks.length - index,
      status: "pending" as const,
    }));

    this.plan = {
      id: planId,
      tasks: planTasks,
      createdAt: nowIso(),
    };

    this.status = "planning";
    return this.plan;
  }

  /**
   * Update task priorities.
   */
  updatePriorities(priorities: Map<string, number>): void {
    if (!this.plan) throw new Error("No active plan");
    for (const [taskId, priority] of priorities) {
      const task = this.plan.tasks.find((t) => t.id === taskId);
      if (task) task.priority = priority;
    }
    this.plan.tasks.sort((a, b) => b.priority - a.priority);
  }

  // ==========================================================================
  // Execution
  // ==========================================================================

  /**
   * Execute the plan by dispatching tasks to sub-agents.
   */
  async execute(providerConfig?: any): Promise<CoordinatorResult> {
    if (!this.plan) throw new Error("No plan created");
    this.status = "dispatching";

    // Dispatch tasks based on priority until max concurrent
    const pendingTasks = this.plan.tasks.filter((t) => t.status === "pending");
    const dispatched: string[] = [];

    for (let i = 0; i < Math.min(pendingTasks.length, this.maxConcurrent); i++) {
      const task = pendingTasks[i];
      dispatched.push(task.id);
      await this.dispatchTask(task, providerConfig);
    }

    this.status = "waiting";

    // Wait for all tasks to complete
    await this.waitForCompletion();

    this.status = "synthesizing";

    // Synthesize results
    const result = this.synthesizeResults();

    this.status = result.success ? "completed" : "failed";
    if (this.status === "completed") {
      this.plan.completedAt = nowIso();
    }

    return result;
  }

  /**
   * Dispatch a single task to a sub-agent.
   */
  private async dispatchTask(task: CoordinatorTask, providerConfig?: any): Promise<void> {
    if (!this.plan) return;

    task.status = "assigned";

    // Publish task submission event
    this.mailbox.publish(createTaskSubmittedEvent(this.coordinatorId, task.id, task.description));

    const config: SubAgentConfig = {
      id: createId("subagent"),
      ownerId: this.coordinatorId,
      task: task.description,
      writeScope: "shared",
      deadline: this.timeout,
      background: true,
      providerConfig,
    };

    const agentId = await this.manager.spawn(config);
    task.assignedTo = agentId;
    task.status = "running";

    // Update pending tasks and dispatch more if capacity available
    this.processNextPending();
  }

  /**
   * Wait for all tasks to complete.
   */
  private async waitForCompletion(): Promise<void> {
    if (!this.plan) return;

    const pendingTasks = this.plan.tasks.filter(
      (t) => t.status === "assigned" || t.status === "running",
    );

    await Promise.all(
      pendingTasks.map(async (task) => {
        if (!task.assignedTo) return;

        try {
          const output = await this.manager.wait(task.assignedTo, this.timeout);
          this.results.set(task.id, output);

          if (output.success) {
            task.status = "completed";
            task.result = output.text;
            this.mailbox.publish(createTaskCompletedEvent(this.coordinatorId, task.id, output.text));
          } else {
            task.status = "failed";
            task.error = output.error;
            this.errors.set(task.id, output.error ?? "Unknown error");
            this.mailbox.publish(createTaskFailedEvent(this.coordinatorId, task.id, task.error ?? "Unknown error"));

            // Retry if enabled
            if (this.retryOnFailure) {
              await this.retryTask(task);
            }
          }
        } catch (error) {
          task.status = "failed";
          const errorMsg = error instanceof Error ? error.message : String(error);
          task.error = errorMsg;
          this.errors.set(task.id, errorMsg);
          this.mailbox.publish(createTaskFailedEvent(this.coordinatorId, task.id, errorMsg));
        }
      }),
    );
  }

  /**
   * Retry a failed task.
   */
  private async retryTask(task: CoordinatorTask, attempt = 1): Promise<void> {
    if (attempt > this.maxRetries) return;
    if (!this.plan) return;

    task.status = "running";

    const config: SubAgentConfig = {
      id: createId("subagent"),
      ownerId: this.coordinatorId,
      task: task.description,
      writeScope: "shared",
      deadline: this.timeout,
      background: true,
    };

    const agentId = await this.manager.spawn(config);
    task.assignedTo = agentId;

    try {
      const output = await this.manager.wait(agentId, this.timeout);
      this.results.set(task.id, output);

      if (output.success) {
        task.status = "completed";
        task.result = output.text;
      } else {
        task.status = "failed";
        task.error = output.error;
        this.errors.set(task.id, output.error ?? "Unknown error");
        await this.retryTask(task, attempt + 1);
      }
    } catch (error) {
      task.status = "failed";
      task.error = error instanceof Error ? error.message : String(error);
      this.errors.set(task.id, task.error);
    }
  }

  /**
   * Process next pending task if capacity available.
   */
  private processNextPending(): void {
    if (!this.plan) return;

    const running = this.plan.tasks.filter((t) => t.status === "running" || t.status === "assigned").length;
    if (running >= this.maxConcurrent) return;

    const pending = this.plan.tasks.filter((t) => t.status === "pending");
    if (pending.length === 0) return;

    const next = pending[0];
    this.dispatchTask(next, undefined);
  }

  // ==========================================================================
  // Synthesis
  // ==========================================================================

  private synthesizeResults(): CoordinatorResult {
    if (!this.plan) throw new Error("No plan");

    const results = new Map<string, unknown>();
    const errors = new Map<string, string>();

    for (const task of this.plan.tasks) {
      if (task.status === "completed" && task.result) {
        results.set(task.id, task.result);
      } else if (task.status === "failed" && task.error) {
        errors.set(task.id, task.error);
      }
    }

    const success = errors.size === 0;
    const summary = this.buildSummary();

    return {
      success,
      planId: this.plan.id,
      results,
      errors,
      summary,
    };
  }

  private buildSummary(): string {
    if (!this.plan) return "";

    const completed = this.plan.tasks.filter((t) => t.status === "completed").length;
    const failed = this.plan.tasks.filter((t) => t.status === "failed").length;
    const total = this.plan.tasks.length;

    if (failed === 0) {
      return `Successfully completed all ${completed} tasks.`;
    }

    return `Completed ${completed}/${total} tasks. ${failed} task(s) failed.`;
  }

  // ==========================================================================
  // Mailbox Setup
  // ==========================================================================

  private setupMailboxHandlers(): void {
    // Listen for task completions
    this.mailbox.subscribe(
      { type: "task.completed" },
      (event) => {
        this.processNextPending();
      },
    );

    // Listen for task failures
    this.mailbox.subscribe(
      { type: "task.failed" },
      (event) => {
        this.processNextPending();
      },
    );
  }

  // ==========================================================================
  // State
  // ==========================================================================

  getStatus(): CoordinatorStatus {
    return this.status;
  }

  getPlan(): CoordinatorPlan | undefined {
    return this.plan;
  }

  getResults(): Map<string, SubAgentOutput> {
    return new Map(this.results);
  }

  getErrors(): Map<string, string> {
    return new Map(this.errors);
  }

  cancel(): void {
    if (!this.plan) return;

    for (const task of this.plan.tasks) {
      if (task.assignedTo) {
        this.manager.cancel(task.assignedTo);
      }
      if (task.status === "pending" || task.status === "assigned" || task.status === "running") {
        task.status = "skipped";
      }
    }

    this.status = "failed";
  }
}
