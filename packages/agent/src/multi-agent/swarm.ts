/**
 * Swarm - Emergent multi-agent collaboration pattern
 *
 * Implements a swarm of agents that collaborate through message passing
 * and emergent task resolution. Unlike the coordinator, swarm agents
 * self-organize and can spawn additional agents as needed.
 */

import { createId, nowIso } from "@omi/core";

import type { Mailbox, MailboxMessage } from "../task-mailbox.js";
import { MailboxTopics } from "../task-mailbox.js";
import type { SubAgentManager, SubAgent } from "../subagent-manager.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Swarm agent role
 */
export type SwarmRole =
  | "worker"      // Executes tasks
  | "scout"       // Explores and gathers information
  | "relay"       // Coordinates communication
  | "synthesizer" // Combines results from multiple agents
  | "specialist"; // Expert in a specific domain

/**
 * Swarm agent in the network
 */
export interface SwarmAgent {
  id: string;
  name: string;
  role: SwarmRole;
  expertise: string[];
  parentId: string | null;
  subAgentId?: string;
  status: "active" | "idle" | "collaborating" | "finished";
  contribution?: string;
}

/**
 * Task in the swarm
 */
export interface SwarmTask {
  id: string;
  description: string;
  status: "queued" | "in_progress" | "collaborating" | "completed" | "failed";
  claimedBy: string[];
  contributors: string[];
  result?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Collaboration message between agents
 */
export interface CollaborationMessage {
  type: "discovery" | "offer" | "request" | "result" | "delegate" | "synthesize";
  senderId: string;
  targetId?: string;
  payload: unknown;
  timestamp: string;
}

/**
 * Swarm configuration
 */
export interface SwarmConfig {
  mailbox: Mailbox;
  subAgentManager: SubAgentManager;
  maxAgents?: number;
  maxDepth?: number; // Maximum spawn depth
  enableSpontaneousSpawn?: boolean; // Allow agents to spawn others
  collaborationTopics?: string[];
}

/**
 * Swarm event
 */
export type SwarmEvent =
  | { type: "agent_joined"; agent: SwarmAgent }
  | { type: "agent_left"; agentId: string }
  | { type: "task_created"; task: SwarmTask }
  | { type: "task_claimed"; task: SwarmTask; agentId: string }
  | { type: "task_collaborating"; task: SwarmTask }
  | { type: "task_completed"; task: SwarmTask }
  | { type: "collaboration_message"; message: CollaborationMessage }
  | { type: "swarm_started" }
  | { type: "swarm_converged"; results: string[] };

// ============================================================================
// Swarm Implementation
// ============================================================================

export class Swarm {
  private readonly agents = new Map<string, SwarmAgent>();
  private readonly tasks = new Map<string, SwarmTask>();
  private readonly config: Required<SwarmConfig>;
  private readonly listeners = new Set<(event: SwarmEvent) => void>();
  private readonly taskQueue: string[] = [];
  private running = false;
  private currentDepth = 0;
  private readonly rootAgentId: string;

  constructor(config: SwarmConfig) {
    this.config = {
      maxAgents: config.maxAgents ?? 10,
      maxDepth: config.maxDepth ?? 3,
      enableSpontaneousSpawn: config.enableSpontaneousSpawn ?? true,
      collaborationTopics: config.collaborationTopics ?? [
        MailboxTopics.TASK_DELEGATE,
        MailboxTopics.TASK_COMPLETE,
        MailboxTopics.TASK_FAIL,
        MailboxTopics.TASK_PROGRESS,
        "swarm/discover",
        "swarm/offer",
        "swarm/request",
        "swarm/result",
      ],
      mailbox: config.mailbox,
      subAgentManager: config.subAgentManager,
    };

    this.rootAgentId = createId("swarm");

    // Subscribe to collaboration topics
    for (const topic of this.config.collaborationTopics) {
      this.config.mailbox.subscribe(topic, (msg) => this.handleMessage(msg));
    }
  }

  /**
   * Start the swarm with the root agent.
   */
  async start(initialTask: string): Promise<string> {
    this.running = true;

    // Create root agent
    const rootAgent = this.registerAgent({
      id: this.rootAgentId,
      name: "swarm-root",
      role: "synthesizer",
      expertise: ["general"],
      parentId: null,
      status: "active",
    });

    this.emit({ type: "swarm_started" });

    // Create initial task
    const task = this.createTask(initialTask);
    this.claimTask(task.id, rootAgent.id);

    return rootAgent.id;
  }

  /**
   * Stop the swarm.
   */
  stop(): void {
    this.running = false;

    // Close all agents
    for (const agent of this.agents.values()) {
      if (agent.subAgentId) {
        this.config.subAgentManager.close(agent.subAgentId, true);
      }
    }

    this.agents.clear();
    this.tasks.clear();
    this.taskQueue.length = 0;
  }

  /**
   * Register an agent in the swarm.
   */
  registerAgent(agent: SwarmAgent): SwarmAgent {
    if (this.agents.size >= this.config.maxAgents) {
      throw new Error(`Swarm at maximum capacity: ${this.config.maxAgents} agents`);
    }

    this.agents.set(agent.id, agent);
    this.emit({ type: "agent_joined", agent });
    return agent;
  }

  /**
   * Unregister an agent.
   */
  unregisterAgent(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      this.agents.delete(agentId);
      this.emit({ type: "agent_left", agentId });
    }
  }

  /**
   * Create a task in the swarm.
   */
  createTask(description: string): SwarmTask {
    const task: SwarmTask = {
      id: createId("swarm"),
      description,
      status: "queued",
      claimedBy: [],
      contributors: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    this.tasks.set(task.id, task);
    this.taskQueue.push(task.id);
    this.emit({ type: "task_created", task });

    return task;
  }

  /**
   * Claim a task for an agent.
   */
  claimTask(taskId: string, agentId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    if (task.claimedBy.includes(agentId)) return true;

    task.claimedBy.push(agentId);
    task.contributors.push(agentId);
    task.status = "in_progress";
    task.updatedAt = nowIso();

    this.emit({ type: "task_claimed", task, agentId });
    return true;
  }

  /**
   * Add a collaborator to a task.
   */
  collaborate(taskId: string, agentId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    if (!task.contributors.includes(agentId)) {
      task.contributors.push(agentId);
    }

    if (task.claimedBy.length > 1 && task.status !== "collaborating") {
      task.status = "collaborating";
      this.emit({ type: "task_collaborating", task });
    }

    task.updatedAt = nowIso();
    return true;
  }

  /**
   * Complete a task with results.
   */
  completeTask(taskId: string, result: string, agentId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    task.status = "completed";
    task.result = result;
    task.updatedAt = nowIso();

    // Update agent contribution
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.contribution = result;
      agent.status = "finished";
    }

    this.emit({ type: "task_completed", task });

    // Check for convergence
    this.checkConvergence();

    return true;
  }

  /**
   * Fail a task.
   */
  failTask(taskId: string, error: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    task.status = "failed";
    task.error = error;
    task.updatedAt = nowIso();

    this.emit({ type: "task_completed", task });
    return true;
  }

  /**
   * Spawn a new agent for a subtask.
   */
  spawnForTask(
    parentTaskId: string,
    subtask: string,
    role: SwarmRole = "worker",
    expertise: string[] = [],
  ): SwarmAgent | null {
    if (!this.config.enableSpontaneousSpawn) return null;
    if (this.currentDepth >= this.config.maxDepth) return null;
    if (this.agents.size >= this.config.maxAgents) return null;

    const parentTask = this.tasks.get(parentTaskId);
    const parentAgentId = parentTask?.claimedBy[0] ?? this.rootAgentId;
    const parentAgent = this.agents.get(parentAgentId);

    if (!parentAgent) return null;

    this.currentDepth++;

    // Spawn SubAgent
    const subAgent = this.config.subAgentManager.spawn({
      name: `${role}-${createId("swarm").slice(0, 6)}`,
      task: subtask,
    });

    // Register in swarm
    const swarmAgent = this.registerAgent({
      id: createId("swarm"),
      name: subAgent.config.name,
      role,
      expertise,
      parentId: parentAgentId,
      subAgentId: subAgent.config.id,
      status: "active",
    });

    // Create task for the agent
    const task = this.createTask(subtask);
    this.claimTask(task.id, swarmAgent.id);

    this.currentDepth--;

    return swarmAgent;
  }

  /**
   * Send a collaboration message.
   */
  sendCollaborationMessage(
    type: CollaborationMessage["type"],
    senderId: string,
    payload: unknown,
    targetId?: string,
  ): void {
    const message: CollaborationMessage = {
      type,
      senderId,
      targetId,
      payload,
      timestamp: nowIso(),
    };

    const topic = `swarm/${type}`;
    if (targetId) {
      this.config.mailbox.sendTo(senderId, targetId, topic, message);
    } else {
      this.config.mailbox.broadcast(senderId, topic, message);
    }

    this.emit({ type: "collaboration_message", message });
  }

  /**
   * Request help from other agents.
   */
  requestHelp(agentId: string, request: string): string[] {
    const agent = this.agents.get(agentId);
    if (!agent) return [];

    this.sendCollaborationMessage("request", agentId, { request, agentRole: agent.role });

    // Find potential helpers
    const helpers = [...this.agents.values()]
      .filter((a) => a.id !== agentId && a.status === "idle")
      .map((a) => a.id);

    return helpers;
  }

  /**
   * Get all agents.
   */
  getAgents(filter?: {
    role?: SwarmRole;
    status?: SwarmAgent["status"];
    expertise?: string;
  }): SwarmAgent[] {
    let agents = [...this.agents.values()];

    if (filter?.role) {
      agents = agents.filter((a) => a.role === filter.role);
    }
    if (filter?.status) {
      agents = agents.filter((a) => a.status === filter.status);
    }
    if (filter?.expertise) {
      agents = agents.filter((a) => a.expertise.includes(filter.expertise!));
    }

    return agents;
  }

  /**
   * Get all tasks.
   */
  getTasks(filter?: {
    status?: SwarmTask["status"];
    agentId?: string;
  }): SwarmTask[] {
    let tasks = [...this.tasks.values()];

    if (filter?.status) {
      tasks = tasks.filter((t) => t.status === filter.status);
    }
    if (filter?.agentId) {
      tasks = tasks.filter((t) => t.claimedBy.includes(filter.agentId!) || t.contributors.includes(filter.agentId!));
    }

    return tasks;
  }

  /**
   * Get swarm statistics.
   */
  getStats(): {
    totalAgents: number;
    activeAgents: number;
    idleAgents: number;
    totalTasks: number;
    pendingTasks: number;
    completedTasks: number;
    failedTasks: number;
    currentDepth: number;
    maxDepth: number;
  } {
    let activeAgents = 0;
    let idleAgents = 0;

    for (const agent of this.agents.values()) {
      if (agent.status === "active" || agent.status === "collaborating") {
        activeAgents++;
      } else if (agent.status === "idle") {
        idleAgents++;
      }
    }

    let pendingTasks = 0;
    let completedTasks = 0;
    let failedTasks = 0;

    for (const task of this.tasks.values()) {
      if (task.status === "queued" || task.status === "in_progress" || task.status === "collaborating") {
        pendingTasks++;
      } else if (task.status === "completed") {
        completedTasks++;
      } else if (task.status === "failed") {
        failedTasks++;
      }
    }

    return {
      totalAgents: this.agents.size,
      activeAgents,
      idleAgents,
      totalTasks: this.tasks.size,
      pendingTasks,
      completedTasks,
      failedTasks,
      currentDepth: this.currentDepth,
      maxDepth: this.config.maxDepth,
    };
  }

  /**
   * Subscribe to swarm events.
   */
  subscribe(listener: (event: SwarmEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Check if swarm has converged (all tasks completed or failed).
   */
  isConverged(): boolean {
    for (const task of this.tasks.values()) {
      if (task.status === "queued" || task.status === "in_progress" || task.status === "collaborating") {
        return false;
      }
    }
    return true;
  }

  /**
   * Get final results from all completed tasks.
   */
  getResults(): string[] {
    const results: string[] = [];

    for (const task of this.tasks.values()) {
      if (task.status === "completed" && task.result) {
        results.push(task.result);
      }
    }

    return results;
  }

  private handleMessage(message: MailboxMessage): void {
    // Update task status based on SubAgent events
    const payload = message.payload as { taskId?: string };

    if (message.topic === MailboxTopics.TASK_COMPLETE) {
      if (payload?.taskId) {
        const task = this.tasks.get(payload.taskId);
        if (task) {
          this.completeTask(task.id, (payload as { result?: string }).result ?? "", message.senderId);
        }
      }
    }

    if (message.topic === MailboxTopics.TASK_FAIL) {
      if (payload?.taskId) {
        const task = this.tasks.get(payload.taskId);
        if (task) {
          this.failTask(task.id, (payload as { error?: string }).error ?? "Unknown error");
        }
      }
    }
  }

  private checkConvergence(): void {
    if (this.isConverged() && this.running) {
      const results = this.getResults();
      this.emit({ type: "swarm_converged", results });
    }
  }

  private emit(event: SwarmEvent): void {
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
// Role Helpers
// ============================================================================

export function getRoleDescription(role: SwarmRole): string {
  const descriptions: Record<SwarmRole, string> = {
    worker: "Executes assigned tasks",
    scout: "Explores and gathers information from various sources",
    relay: "Coordinates communication between agents",
    synthesizer: "Combines and integrates results from multiple agents",
    specialist: "Expert in specific technical domains",
  };
  return descriptions[role];
}

export function getRoleExpertise(role: SwarmRole): string[] {
  const expertise: Record<SwarmRole, string[]> = {
    worker: ["implementation", "debugging"],
    scout: ["research", "analysis", "discovery"],
    relay: ["communication", "coordination"],
    synthesizer: ["integration", "summary", "reporting"],
    specialist: [], // Domain-specific
  };
  return expertise[role];
}

// ============================================================================
// Exports
// ============================================================================
