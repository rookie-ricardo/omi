import { AsyncLocalStorage } from "node:async_hooks";
import { createId, nowIso, type Task } from "@omi/core";
import type { McpRegistry } from "@omi/provider";

import type { SubAgentManagerClient } from "./subagent";

export interface ToolRuntimeContext {
  mcpRegistry?: McpRegistry | null;
  subAgentClient?: SubAgentManagerClient | null;
  taskRuntime?: TaskToolRuntime | null;
}

const runtimeContextStorage = new AsyncLocalStorage<ToolRuntimeContext>();

export function runWithToolRuntimeContext<T>(
  context: ToolRuntimeContext,
  fn: () => T,
): T {
  return runtimeContextStorage.run(context, fn);
}

export function getCurrentToolRuntimeContext(): ToolRuntimeContext | null {
  return runtimeContextStorage.getStore() ?? null;
}

// ============================================================================
// MCP Registry Runtime
// ============================================================================

let globalMcpRegistry: McpRegistry | null = null;

export function getMcpRegistryRuntime(): McpRegistry | null {
  return getCurrentToolRuntimeContext()?.mcpRegistry ?? globalMcpRegistry;
}

export function setMcpRegistryRuntime(registry: McpRegistry | null): void {
  globalMcpRegistry = registry;
}

// ============================================================================
// SubAgent Runtime
// ============================================================================

let globalSubAgentClient: SubAgentManagerClient | null = null;

export function getSubAgentClientRuntime(): SubAgentManagerClient | null {
  return getCurrentToolRuntimeContext()?.subAgentClient ?? globalSubAgentClient;
}

export function setSubAgentClientRuntime(client: SubAgentManagerClient | null): void {
  globalSubAgentClient = client;
}

// ============================================================================
// Task Runtime
// ============================================================================

export interface TaskToolRecord {
  task: Task;
  output?: string;
  stoppedAt?: string;
}

export interface TaskToolCreateInput {
  title: string;
  originSessionId: string;
  candidateReason: string;
  autoCreated?: boolean;
  status?: Task["status"];
}

export interface TaskToolUpdateInput {
  title?: string;
  status?: Task["status"];
  candidateReason?: string;
  autoCreated?: boolean;
}

export interface TaskToolListInput {
  status?: Task["status"];
  originSessionId?: string;
}

export interface TaskToolRuntime {
  createTask(input: TaskToolCreateInput): TaskToolRecord;
  updateTask(taskId: string, input: TaskToolUpdateInput): TaskToolRecord | null;
  getTask(taskId: string): TaskToolRecord | null;
  listTasks(input?: TaskToolListInput): TaskToolRecord[];
  stopTask(taskId: string): TaskToolRecord | null;
  setTaskOutput(taskId: string, output: string): TaskToolRecord | null;
}

class InMemoryTaskToolRuntime implements TaskToolRuntime {
  private readonly tasks = new Map<string, TaskToolRecord>();

  createTask(input: TaskToolCreateInput): TaskToolRecord {
    const now = nowIso();
    const task: Task = {
      id: createId("task"),
      title: input.title,
      status: input.status ?? "inbox",
      originSessionId: input.originSessionId,
      candidateReason: input.candidateReason,
      autoCreated: input.autoCreated ?? true,
      createdAt: now,
      updatedAt: now,
    };
    const record: TaskToolRecord = { task };
    this.tasks.set(task.id, record);
    return record;
  }

  updateTask(taskId: string, input: TaskToolUpdateInput): TaskToolRecord | null {
    const current = this.tasks.get(taskId);
    if (!current) return null;

    const updated: Task = {
      ...current.task,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.candidateReason !== undefined ? { candidateReason: input.candidateReason } : {}),
      ...(input.autoCreated !== undefined ? { autoCreated: input.autoCreated } : {}),
      updatedAt: nowIso(),
    };
    const next: TaskToolRecord = {
      task: updated,
      output: current.output,
      stoppedAt: current.stoppedAt,
    };
    this.tasks.set(taskId, next);
    return next;
  }

  getTask(taskId: string): TaskToolRecord | null {
    return this.tasks.get(taskId) ?? null;
  }

  listTasks(input?: TaskToolListInput): TaskToolRecord[] {
    return [...this.tasks.values()].filter((record) => {
      if (input?.status && record.task.status !== input.status) return false;
      if (input?.originSessionId && record.task.originSessionId !== input.originSessionId) return false;
      return true;
    });
  }

  stopTask(taskId: string): TaskToolRecord | null {
    const current = this.tasks.get(taskId);
    if (!current) return null;

    const updated: Task = {
      ...current.task,
      status: "dismissed",
      updatedAt: nowIso(),
    };
    const next: TaskToolRecord = {
      task: updated,
      output: current.output,
      stoppedAt: nowIso(),
    };
    this.tasks.set(taskId, next);
    return next;
  }

  setTaskOutput(taskId: string, output: string): TaskToolRecord | null {
    const current = this.tasks.get(taskId);
    if (!current) return null;

    const next: TaskToolRecord = {
      task: {
        ...current.task,
        updatedAt: nowIso(),
      },
      output,
      stoppedAt: current.stoppedAt,
    };
    this.tasks.set(taskId, next);
    return next;
  }
}

let globalTaskRuntime: TaskToolRuntime | null = null;

export function getTaskToolRuntime(): TaskToolRuntime {
  const scopedRuntime = getCurrentToolRuntimeContext()?.taskRuntime;
  if (scopedRuntime) {
    return scopedRuntime;
  }

  if (!globalTaskRuntime) {
    throw new Error("Task runtime is not configured");
  }
  return globalTaskRuntime;
}

export function setTaskToolRuntime(runtime: TaskToolRuntime | null): void {
  globalTaskRuntime = runtime;
}

export function resetTaskToolRuntime(): void {
  globalTaskRuntime = null;
}

export function createInMemoryTaskToolRuntime(): TaskToolRuntime {
  return new InMemoryTaskToolRuntime();
}
