import type { Task } from "@omi/core";
import { nowIso } from "@omi/core";
import type { AppStore } from "@omi/store";
import type { TaskToolRuntime, TaskToolRecord } from "@omi/tools";

class DatabaseTaskToolRuntime implements TaskToolRuntime {
  private readonly meta = new Map<string, { output?: string; stoppedAt?: string }>();

  constructor(private readonly database: AppStore) {}

  createTask(input: {
    title: string;
    originSessionId: string;
    candidateReason: string;
    autoCreated?: boolean;
    status?: Task["status"];
  }): TaskToolRecord {
    const task = this.database.createTask({
      title: input.title,
      originSessionId: input.originSessionId,
      candidateReason: input.candidateReason,
      autoCreated: input.autoCreated ?? true,
      status: input.status ?? "inbox",
    });
    return this.toRecord(task);
  }

  updateTask(taskId: string, input: {
    title?: string;
    status?: Task["status"];
    candidateReason?: string;
    autoCreated?: boolean;
  }): TaskToolRecord | null {
    const current = this.database.getTask(taskId);
    if (!current) {
      return null;
    }
    const updated = this.database.updateTask(taskId, {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.candidateReason !== undefined ? { candidateReason: input.candidateReason } : {}),
      ...(input.autoCreated !== undefined ? { autoCreated: input.autoCreated } : {}),
    });
    return this.toRecord(updated);
  }

  getTask(taskId: string): TaskToolRecord | null {
    const task = this.database.getTask(taskId);
    return task ? this.toRecord(task) : null;
  }

  listTasks(input?: { status?: Task["status"]; originSessionId?: string }): TaskToolRecord[] {
    return this.database
      .listTasks()
      .filter((task) => {
        if (input?.status && task.status !== input.status) return false;
        if (input?.originSessionId && task.originSessionId !== input.originSessionId) return false;
        return true;
      })
      .map((task) => this.toRecord(task));
  }

  stopTask(taskId: string): TaskToolRecord | null {
    const task = this.database.getTask(taskId);
    if (!task) {
      return null;
    }
    const updated = this.database.updateTask(taskId, { status: "dismissed" });
    this.meta.set(taskId, { ...this.meta.get(taskId), stoppedAt: nowIso() });
    return this.toRecord(updated);
  }

  setTaskOutput(taskId: string, output: string): TaskToolRecord | null {
    const task = this.database.getTask(taskId);
    if (!task) {
      return null;
    }
    this.meta.set(taskId, { ...this.meta.get(taskId), output });
    return this.toRecord(task);
  }

  private toRecord(task: Task): TaskToolRecord {
    const details = this.meta.get(task.id);
    return {
      task,
      output: details?.output,
      stoppedAt: details?.stoppedAt,
    };
  }
}

export function createDatabaseTaskToolRuntime(database: AppStore): TaskToolRuntime {
  return new DatabaseTaskToolRuntime(database);
}
