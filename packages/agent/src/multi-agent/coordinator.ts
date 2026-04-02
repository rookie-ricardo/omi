/**
 * Coordinator - Multi-agent coordination pattern
 *
 * Implements a coordinator that manages a team of specialized agents,
 * delegating tasks based on capabilities and current workload.
 */

import { createId, nowIso } from "@omi/core";

import type { Mailbox, MailboxMessage } from "../task-mailbox.js";
import { MailboxTopics } from "../task-mailbox.js";
import type { SubAgent, SubAgentManager, SubAgentState, TaskResult } from "../subagent-manager.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Agent capability
 */
export interface AgentCapability {
  type: "coding" | "review" | "testing" | "documentation" | "research" | "planning" | "custom";
  name: string;
  description: string;
  weight?: number; // Relative weight for task distribution
}

/**
 * Agent registration in the coordinator
 */
export interface CoordinatorAgent {
  id: string;
  name: string;
  capabilities: AgentCapability[];
  currentLoad: number;
  maxLoad: number;
  status: "available" | "busy" | "offline";
  subAgentId?: string; // If this is a SubAgent
  metadata?: Record<string, unknown>;
}

/**
 * Task assignment from the coordinator
 */
export interface CoordinatorTask {
  id: string;
  description: string;
  requiredCapabilities: AgentCapability["type"][];
  priority: "low" | "normal" | "high" | "critical";
  assignedAgentId?: string;
  status: "pending" | "assigned" | "in_progress" | "completed" | "failed";
  result?: string;
  error?: string;
  createdAt: string;
  assignedAt?: string;
  completedAt?: string;
  dependencies?: string[]; // Task IDs that must complete first
}

/**
 * Coordination strategy
 */
export type CoordinationStrategy = "load_balanced" | "capability_based" | "priority_based" | "round_robin";

/**
 * Coordinator configuration
 */
export interface CoordinatorConfig {
  mailbox: Mailbox;
  subAgentManager: SubAgentManager;
  strategy: CoordinationStrategy;
  maxConcurrentTasks?: number;
  defaultTimeout?: number;
  enableProgressTracking?: boolean;
}

/**
 * Coordinator event
 */
export type CoordinatorEvent =
  | { type: "task_assigned"; task: CoordinatorTask; agentId: string }
  | { type: "task_completed"; task: CoordinatorTask; result: TaskResult }
  | { type: "task_failed"; task: CoordinatorTask; error: string }
  | { type: "agent_registered"; agent: CoordinatorAgent }
  | { type: "agent_unregistered"; agentId: string }
  | { type: "coordination_started" }
  | { type: "coordination_stopped" };

// ============================================================================
// Coordinator Implementation
// ============================================================================

export class Coordinator {
  private readonly agents = new Map<string, CoordinatorAgent>();
  private readonly tasks = new Map<string, CoordinatorTask>();
  private readonly config: CoordinatorConfig;
  private readonly listeners = new Set<(event: CoordinatorEvent) => void>();
  private running = false;
  private roundRobinIndex = 0;

  constructor(config: CoordinatorConfig) {
    this.config = {
      maxConcurrentTasks: config.maxConcurrentTasks ?? 10,
      defaultTimeout: config.defaultTimeout ?? 300000, // 5 minutes
      enableProgressTracking: config.enableProgressTracking ?? true,
      ...config,
    };

    // Subscribe to SubAgent events
    this.config.mailbox.subscribe(MailboxTopics.TASK_COMPLETE, (msg) => this.handleTaskComplete(msg));
    this.config.mailbox.subscribe(MailboxTopics.TASK_FAIL, (msg) => this.handleTaskFail(msg));
    this.config.mailbox.subscribe(MailboxTopics.TASK_PROGRESS, (msg) => this.handleProgress(msg));
  }

  /**
   * Start the coordinator.
   */
  start(): void {
    this.running = true;
    this.emit({ type: "coordination_started" });
  }

  /**
   * Stop the coordinator.
   */
  stop(): void {
    this.running = false;
    this.emit({ type: "coordination_stopped" });
  }

  /**
   * Register an agent with the coordinator.
   */
  registerAgent(agent: Omit<CoordinatorAgent, "currentLoad" | "status">): void {
    const fullAgent: CoordinatorAgent = {
      ...agent,
      currentLoad: 0,
      status: "available",
    };
    this.agents.set(agent.id, fullAgent);
    this.emit({ type: "agent_registered", agent: fullAgent });
  }

  /**
   * Unregister an agent.
   */
  unregisterAgent(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      this.agents.delete(agentId);
      this.emit({ type: "agent_unregistered", agentId });
    }
  }

  /**
   * Create a task for coordination.
   */
  createTask(input: {
    description: string;
    requiredCapabilities?: AgentCapability["type"][];
    priority?: "low" | "normal" | "high" | "critical";
    dependencies?: string[];
  }): CoordinatorTask {
    const task: CoordinatorTask = {
      id: createId("task"),
      description: input.description,
      requiredCapabilities: input.requiredCapabilities ?? [],
      priority: input.priority ?? "normal",
      status: "pending",
      createdAt: nowIso(),
      dependencies: input.dependencies,
    };

    this.tasks.set(task.id, task);
    return task;
  }

  /**
   * Submit multiple tasks at once.
   */
  submitTasks(taskInputs: Array<{
    description: string;
    requiredCapabilities?: AgentCapability["type"][];
    priority?: "low" | "normal" | "high" | "critical";
    dependencies?: string[];
  }>): CoordinatorTask[] {
    return taskInputs.map((input) => this.createTask(input));
  }

  /**
   * Assign a task to an available agent.
   */
  assignTask(taskId: string, agentId?: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== "pending") {
      return false;
    }

    // Check dependencies
    if (task.dependencies && task.dependencies.length > 0) {
      const pendingDeps = task.dependencies.filter((depId) => {
        const dep = this.tasks.get(depId);
        return dep && dep.status !== "completed" && dep.status !== "failed";
      });
      if (pendingDeps.length > 0) {
        return false; // Wait for dependencies
      }
    }

    // Find or use specified agent
    const agent = agentId
      ? this.agents.get(agentId)
      : this.findBestAgent(task.requiredCapabilities);

    if (!agent || agent.status !== "available" || agent.currentLoad >= agent.maxLoad) {
      return false;
    }

    // Assign task
    task.assignedAgentId = agent.id;
    task.status = "assigned";
    task.assignedAt = nowIso();

    agent.currentLoad++;
    if (agent.currentLoad >= agent.maxLoad) {
      agent.status = "busy";
    }

    // Send task to agent
    this.config.mailbox.sendTo("coordinator", agent.id, MailboxTopics.TASK_DELEGATE, {
      taskId: task.id,
      description: task.description,
      priority: task.priority,
    });

    this.emit({ type: "task_assigned", task, agentId: agent.id });
    return true;
  }

  /**
   * Automatically coordinate all pending tasks.
   */
  coordinatePendingTasks(): number {
    if (!this.running) {
      return 0;
    }

    let assigned = 0;
    for (const task of this.tasks.values()) {
      if (task.status === "pending") {
        if (this.assignTask(task.id)) {
          assigned++;
        }
      }
    }
    return assigned;
  }

  /**
   * Get task status.
   */
  getTask(taskId: string): CoordinatorTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Get all tasks, optionally filtered.
   */
  getTasks(filter?: {
    status?: CoordinatorTask["status"];
    agentId?: string;
    priority?: CoordinatorTask["priority"];
  }): CoordinatorTask[] {
    let tasks = [...this.tasks.values()];

    if (filter?.status) {
      tasks = tasks.filter((t) => t.status === filter.status);
    }
    if (filter?.agentId) {
      tasks = tasks.filter((t) => t.assignedAgentId === filter.agentId);
    }
    if (filter?.priority) {
      tasks = tasks.filter((t) => t.priority === filter.priority);
    }

    return tasks;
  }

  /**
   * Get agent status.
   */
  getAgent(agentId: string): CoordinatorAgent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get all registered agents.
   */
  getAgents(filter?: {
    status?: CoordinatorAgent["status"];
    capability?: AgentCapability["type"];
  }): CoordinatorAgent[] {
    let agents = [...this.agents.values()];

    if (filter?.status) {
      agents = agents.filter((a) => a.status === filter.status);
    }
    if (filter?.capability) {
      agents = agents.filter((a) =>
        a.capabilities.some((c) => c.type === filter.capability)
      );
    }

    return agents;
  }

  /**
   * Get coordination statistics.
   */
  getStats(): {
    totalTasks: number;
    pendingTasks: number;
    completedTasks: number;
    failedTasks: number;
    totalAgents: number;
    availableAgents: number;
    busyAgents: number;
    totalLoad: number;
    maxLoad: number;
  } {
    let pendingTasks = 0;
    let completedTasks = 0;
    let failedTasks = 0;
    let availableAgents = 0;
    let busyAgents = 0;
    let totalLoad = 0;
    let maxLoad = 0;

    for (const task of this.tasks.values()) {
      if (task.status === "pending" || task.status === "assigned" || task.status === "in_progress") {
        pendingTasks++;
      } else if (task.status === "completed") {
        completedTasks++;
      } else if (task.status === "failed") {
        failedTasks++;
      }
    }

    for (const agent of this.agents.values()) {
      totalLoad += agent.currentLoad;
      maxLoad += agent.maxLoad;
      if (agent.status === "available") {
        availableAgents++;
      } else if (agent.status === "busy") {
        busyAgents++;
      }
    }

    return {
      totalTasks: this.tasks.size,
      pendingTasks,
      completedTasks,
      failedTasks,
      totalAgents: this.agents.size,
      availableAgents,
      busyAgents,
      totalLoad,
      maxLoad,
    };
  }

  /**
   * Subscribe to coordinator events.
   */
  subscribe(listener: (event: CoordinatorEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private findBestAgent(requiredCapabilities: AgentCapability["type"][]): CoordinatorAgent | undefined {
    const availableAgents = [...this.agents.values()].filter(
      (a) => a.status === "available" && a.currentLoad < a.maxLoad
    );

    if (availableAgents.length === 0) {
      return undefined;
    }

    switch (this.config.strategy) {
      case "load_balanced":
        return availableAgents.sort((a, b) => a.currentLoad - b.currentLoad)[0];

      case "capability_based":
        return this.findByCapability(availableAgents, requiredCapabilities);

      case "priority_based":
        // Higher load tolerance for agents with needed capabilities
        return availableAgents
          .filter((a) => a.currentLoad < a.maxLoad)
          .sort((a, b) => {
            const aMatch = this.capabilityMatch(a, requiredCapabilities);
            const bMatch = this.capabilityMatch(b, requiredCapabilities);
            if (aMatch !== bMatch) return bMatch - aMatch;
            return a.currentLoad - b.currentLoad;
          })[0];

      case "round_robin":
        const agent = availableAgents[this.roundRobinIndex % availableAgents.length];
        this.roundRobinIndex++;
        return agent;

      default:
        return availableAgents[0];
    }
  }

  private findByCapability(
    agents: CoordinatorAgent[],
    requiredCapabilities: AgentCapability["type"][],
  ): CoordinatorAgent | undefined {
    if (requiredCapabilities.length === 0) {
      return agents[0];
    }

    return agents
      .filter((a) => requiredCapabilities.every((cap) => a.capabilities.some((c) => c.type === cap)))
      .sort((a, b) => {
        const aScore = a.capabilities
          .filter((c) => requiredCapabilities.includes(c.type))
          .reduce((sum, c) => sum + (c.weight ?? 1), 0);
        const bScore = b.capabilities
          .filter((c) => requiredCapabilities.includes(c.type))
          .reduce((sum, c) => sum + (c.weight ?? 1), 0);
        if (aScore !== bScore) return bScore - aScore;
        return a.currentLoad - b.currentLoad;
      })[0];
  }

  private capabilityMatch(agent: CoordinatorAgent, required: AgentCapability["type"][]): number {
    if (required.length === 0) return 1;
    const matches = agent.capabilities.filter((c) => required.includes(c.type)).length;
    return matches / required.length;
  }

  private handleTaskComplete(message: MailboxMessage): void {
    const agentId = message.senderId;
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.currentLoad = Math.max(0, agent.currentLoad - 1);
      if (agent.status === "busy" && agent.currentLoad < agent.maxLoad) {
        agent.status = "available";
      }
    }

    // Find and update task
    const payload = message.payload as { taskId?: string; result?: string };
    if (payload?.taskId) {
      const task = this.tasks.get(payload.taskId);
      if (task) {
        task.status = "completed";
        task.completedAt = nowIso();
        task.result = payload.result;

        this.emit({
          type: "task_completed",
          task,
          result: {
            subAgentId: agentId,
            status: "completed",
            result: payload.result,
            completedAt: nowIso(),
            durationMs: 0,
          },
        });

        // Try to assign more tasks
        void this.coordinatePendingTasks();
      }
    }
  }

  private handleTaskFail(message: MailboxMessage): void {
    const agentId = message.senderId;
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.currentLoad = Math.max(0, agent.currentLoad - 1);
      if (agent.status === "busy" && agent.currentLoad < agent.maxLoad) {
        agent.status = "available";
      }
    }

    const payload = message.payload as { taskId?: string; error?: string };
    if (payload?.taskId) {
      const task = this.tasks.get(payload.taskId);
      if (task) {
        task.status = "failed";
        task.completedAt = nowIso();
        task.error = payload.error;

        this.emit({ type: "task_failed", task, error: payload.error ?? "Unknown error" });
      }
    }
  }

  private handleProgress(message: MailboxMessage): void {
    if (!this.config.enableProgressTracking) {
      return;
    }

    const payload = message.payload as { taskId?: string; progress?: number };
    if (payload?.taskId) {
      const task = this.tasks.get(payload.taskId);
      if (task && task.status === "assigned") {
        task.status = "in_progress";
      }
    }
  }

  private emit(event: CoordinatorEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener errors
      }
    }
  }
}

// ============================================================================
// Default Capabilities
// ============================================================================

export const DefaultCapabilities: AgentCapability[] = [
  { type: "coding", name: "Code Generation", description: "Write and modify code", weight: 1 },
  { type: "review", name: "Code Review", description: "Review code for issues", weight: 0.8 },
  { type: "testing", name: "Testing", description: "Write and run tests", weight: 0.8 },
  { type: "documentation", name: "Documentation", description: "Write documentation", weight: 0.6 },
  { type: "research", name: "Research", description: "Research and analysis", weight: 0.7 },
  { type: "planning", name: "Planning", description: "Plan and coordinate", weight: 0.9 },
];

// ============================================================================
// Exports
// ============================================================================
