import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@mariozechner/pi-ai";

import { parseToolInput } from "./input-parse";
import {
  getTaskToolRuntime,
  type TaskToolRecord,
} from "./runtime";

// ============================================================================
// Schemas
// ============================================================================

export type TaskStatus = "inbox" | "active" | "review" | "done" | "dismissed";

export interface TaskCreateInput {
  title: string;
  originSessionId: string;
  candidateReason: string;
  autoCreated?: boolean;
  status?: TaskStatus;
}

export interface TaskUpdateInput {
  taskId: string;
  title?: string;
  status?: TaskStatus;
  candidateReason?: string;
  autoCreated?: boolean;
}

export interface TaskGetInput {
  taskId: string;
}

export interface TaskListInput {
  status?: TaskStatus;
  originSessionId?: string;
}

export interface TaskStopInput {
  taskId: string;
}

export interface TaskOutputInput {
  taskId: string;
  output: string;
}

export const taskCreateSchema = Type.Object({
  title: Type.String({ description: "Human-readable task title" }),
  originSessionId: Type.String({ description: "Origin session ID" }),
  candidateReason: Type.String({ description: "Why this task exists" }),
  autoCreated: Type.Optional(Type.Boolean({ description: "Whether the task was auto-created" })),
  status: Type.Optional(
    Type.Union([
      Type.Literal("inbox"),
      Type.Literal("active"),
      Type.Literal("review"),
      Type.Literal("done"),
      Type.Literal("dismissed"),
    ]),
  ),
});

export const taskUpdateSchema = Type.Object({
  taskId: Type.String({ description: "Task ID" }),
  title: Type.Optional(Type.String({ description: "Updated title" })),
  status: Type.Optional(
    Type.Union([
      Type.Literal("inbox"),
      Type.Literal("active"),
      Type.Literal("review"),
      Type.Literal("done"),
      Type.Literal("dismissed"),
    ]),
  ),
  candidateReason: Type.Optional(Type.String({ description: "Updated candidate reason" })),
  autoCreated: Type.Optional(Type.Boolean({ description: "Updated auto-created flag" })),
});

export const taskGetSchema = Type.Object({
  taskId: Type.String({ description: "Task ID" }),
});

export const taskListSchema = Type.Object({
  status: Type.Optional(
    Type.Union([
      Type.Literal("inbox"),
      Type.Literal("active"),
      Type.Literal("review"),
      Type.Literal("done"),
      Type.Literal("dismissed"),
    ]),
  ),
  originSessionId: Type.Optional(Type.String({ description: "Filter by origin session ID" })),
});

export const taskStopSchema = Type.Object({
  taskId: Type.String({ description: "Task ID" }),
});

export const taskOutputSchema = Type.Object({
  taskId: Type.String({ description: "Task ID" }),
  output: Type.String({ description: "Task output" }),
});

export interface TaskToolDetails {
  task?: TaskToolRecord["task"];
  tasks?: TaskToolRecord["task"][];
  output?: string;
  stoppedAt?: string;
}

function toTextRecord(record: TaskToolRecord): string {
  return [
    `## ${record.task.title} (${record.task.id})`,
    `- Status: ${record.task.status}`,
    `- Origin session: ${record.task.originSessionId}`,
    `- Candidate reason: ${record.task.candidateReason}`,
    `- Auto created: ${record.task.autoCreated}`,
    `- Created: ${record.task.createdAt}`,
    `- Updated: ${record.task.updatedAt}`,
    record.output ? `- Output: ${record.output}` : null,
    record.stoppedAt ? `- Stopped at: ${record.stoppedAt}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export function createTaskCreateTool(): AgentTool<typeof taskCreateSchema, TaskToolDetails> {
  return {
    name: "task.create",
    label: "task.create",
    description: "Create a task record for the session.",
    parameters: taskCreateSchema,
    execute: async (_toolCallId: string, params: unknown) => {
      const input = parseToolInput("task.create", taskCreateSchema, params);
      const runtime = getTaskToolRuntime();
      const created = runtime.createTask(input);
      return {
        content: [{ type: "text" as const, text: `Created task ${created.task.id} (${created.task.title})` }],
        details: { task: created.task },
      };
    },
  };
}

export function createTaskUpdateTool(): AgentTool<typeof taskUpdateSchema, TaskToolDetails> {
  return {
    name: "task.update",
    label: "task.update",
    description: "Update an existing task record.",
    parameters: taskUpdateSchema,
    execute: async (_toolCallId: string, params: unknown) => {
      const input = parseToolInput("task.update", taskUpdateSchema, params);
      const runtime = getTaskToolRuntime();
      const updated = runtime.updateTask(input.taskId, input);
      if (!updated) {
        return {
          content: [{ type: "text" as const, text: `Task ${input.taskId} not found` }],
          details: {},
        };
      }
      return {
        content: [{ type: "text" as const, text: `Updated task ${updated.task.id}` }],
        details: { task: updated.task, output: updated.output, stoppedAt: updated.stoppedAt },
      };
    },
  };
}

export function createTaskGetTool(): AgentTool<typeof taskGetSchema, TaskToolDetails> {
  return {
    name: "task.get",
    label: "task.get",
    description: "Get a task by ID.",
    parameters: taskGetSchema,
    execute: async (_toolCallId: string, params: unknown) => {
      const { taskId } = parseToolInput("task.get", taskGetSchema, params);
      const runtime = getTaskToolRuntime();
      const record = runtime.getTask(taskId);
      if (!record) {
        return {
          content: [{ type: "text" as const, text: `Task ${taskId} not found` }],
          details: {},
        };
      }
      return {
        content: [{ type: "text" as const, text: toTextRecord(record) }],
        details: { task: record.task, output: record.output, stoppedAt: record.stoppedAt },
      };
    },
  };
}

export function createTaskListTool(): AgentTool<typeof taskListSchema, TaskToolDetails> {
  return {
    name: "task.list",
    label: "task.list",
    description: "List tasks with optional filters.",
    parameters: taskListSchema,
    execute: async (_toolCallId: string, params: unknown) => {
      const input = parseToolInput("task.list", taskListSchema, params);
      const runtime = getTaskToolRuntime();
      const tasks = runtime.listTasks(input);
      if (tasks.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No tasks found" }],
          details: { tasks: [] },
        };
      }
      return {
        content: [{ type: "text" as const, text: tasks.map(toTextRecord).join("\n\n") }],
        details: { tasks: tasks.map((entry) => entry.task) },
      };
    },
  };
}

export function createTaskStopTool(): AgentTool<typeof taskStopSchema, TaskToolDetails> {
  return {
    name: "task.stop",
    label: "task.stop",
    description: "Stop a task by marking it dismissed.",
    parameters: taskStopSchema,
    execute: async (_toolCallId: string, params: unknown) => {
      const { taskId } = parseToolInput("task.stop", taskStopSchema, params);
      const runtime = getTaskToolRuntime();
      const stopped = runtime.stopTask(taskId);
      if (!stopped) {
        return {
          content: [{ type: "text" as const, text: `Task ${taskId} not found` }],
          details: {},
        };
      }
      return {
        content: [{ type: "text" as const, text: `Stopped task ${taskId}` }],
        details: { task: stopped.task, stoppedAt: stopped.stoppedAt },
      };
    },
  };
}

export function createTaskOutputTool(): AgentTool<typeof taskOutputSchema, TaskToolDetails> {
  return {
    name: "task.output",
    label: "task.output",
    description: "Attach an output artifact to a task.",
    parameters: taskOutputSchema,
    execute: async (_toolCallId: string, params: unknown) => {
      const { taskId, output } = parseToolInput("task.output", taskOutputSchema, params);
      const runtime = getTaskToolRuntime();
      const stored = runtime.setTaskOutput(taskId, output);
      if (!stored) {
        return {
          content: [{ type: "text" as const, text: `Task ${taskId} not found` }],
          details: {},
        };
      }
      return {
        content: [{ type: "text" as const, text: `Stored output for task ${taskId}` }],
        details: { task: stored.task, output: stored.output, stoppedAt: stored.stoppedAt },
      };
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createTaskTools(): AgentTool<any>[] {
  return [
    createTaskCreateTool(),
    createTaskUpdateTool(),
    createTaskGetTool(),
    createTaskListTool(),
    createTaskStopTool(),
    createTaskOutputTool(),
  ];
}
