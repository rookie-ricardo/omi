/**
 * TodoWrite Tool — Persistent TODO list management
 *
 * Aligned with claude-code's TodoWriteTool. Provides a structured TODO
 * list that persists across turns via the task runtime context.
 * Enables the agent to track work items, their status, and priority.
 */

import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@mariozechner/pi-ai";
import { parseToolInput } from "./input-parse";
import { getTaskToolRuntime } from "./runtime";

// ============================================================================
// Schema
// ============================================================================

export const todoWriteSchema = Type.Object({
	todos: Type.Array(
		Type.Object({
			id: Type.String({ description: "Unique identifier for the TODO item" }),
			content: Type.String({ description: "Description of the TODO item" }),
			status: Type.Union(
				[
					Type.Literal("pending"),
					Type.Literal("in_progress"),
					Type.Literal("completed"),
				],
				{ description: "Current status of the TODO item" },
			),
			priority: Type.Optional(
				Type.Union(
					[
						Type.Literal("high"),
						Type.Literal("medium"),
						Type.Literal("low"),
					],
					{ description: "Priority level" },
				),
			),
		}),
		{ description: "Complete list of TODO items (replaces previous list)" },
	),
});

export interface TodoItem {
	id: string;
	content: string;
	status: "pending" | "in_progress" | "completed";
	priority?: "high" | "medium" | "low";
}

export interface TodoWriteInput {
	todos: TodoItem[];
}

// ============================================================================
// In-memory TODO Store
// ============================================================================

const todoStore = new Map<string, TodoItem[]>();

/**
 * Get current TODO list for a session.
 */
export function getTodoItems(sessionId?: string): TodoItem[] {
	return todoStore.get(sessionId ?? "default") ?? [];
}

/**
 * Clear TODO list.
 */
export function clearTodoItems(sessionId?: string): void {
	todoStore.delete(sessionId ?? "default");
}

// ============================================================================
// Tool Factory
// ============================================================================

export function createTodoWriteTool(sessionId?: string): AgentTool {
	return {
		name: "todo.write",
		label: "todo.write",
		description:
			"Write/replace the entire TODO list. Use this to track work items, their status, and priority. " +
			"Each call replaces the previous list, so always include all items (updated or not). " +
			"Use status 'pending' for not-started, 'in_progress' for active work, 'completed' for done.",
		parameters: todoWriteSchema,
		execute: async (_toolCallId: string, params: unknown) => {
			const { todos } = parseToolInput("todo.write", todoWriteSchema, params);
			const storeKey = sessionId ?? "default";

			// Replace the entire list
			todoStore.set(storeKey, todos);

			// Format output
			const pending = todos.filter((t) => t.status === "pending");
			const inProgress = todos.filter((t) => t.status === "in_progress");
			const completed = todos.filter((t) => t.status === "completed");

			const lines: string[] = [
				`TODO list updated (${todos.length} items):`,
				"",
			];

			if (inProgress.length > 0) {
				lines.push(`🔄 In Progress (${inProgress.length}):`);
				for (const item of inProgress) {
					const p = item.priority ? ` [${item.priority}]` : "";
					lines.push(`  - [${item.id}]${p} ${item.content}`);
				}
				lines.push("");
			}

			if (pending.length > 0) {
				lines.push(`⏳ Pending (${pending.length}):`);
				for (const item of pending) {
					const p = item.priority ? ` [${item.priority}]` : "";
					lines.push(`  - [${item.id}]${p} ${item.content}`);
				}
				lines.push("");
			}

			if (completed.length > 0) {
				lines.push(`✅ Completed (${completed.length}):`);
				for (const item of completed) {
					lines.push(`  - [${item.id}] ${item.content}`);
				}
			}

			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
				details: {
					total: todos.length,
					pending: pending.length,
					inProgress: inProgress.length,
					completed: completed.length,
				},
			};
		},
	};
}

export const todoReadSchema = Type.Object({});

export interface TodoReadInput {}

export function createTodoReadTool(sessionId?: string): AgentTool {
	return {
		name: "todo.read",
		label: "todo.read",
		description: "Read the current TODO list.",
		parameters: todoReadSchema,
		execute: async (_toolCallId: string, _params: unknown) => {
			const storeKey = sessionId ?? "default";
			const todos = todoStore.get(storeKey) ?? [];

			if (todos.length === 0) {
				return {
					content: [{ type: "text" as const, text: "No TODO items." }],
					details: { total: 0 },
				};
			}

			const lines = todos.map((t) => {
				const statusIcon = t.status === "completed" ? "✅" : t.status === "in_progress" ? "🔄" : "⏳";
				const p = t.priority ? ` [${t.priority}]` : "";
				return `${statusIcon} [${t.id}]${p} ${t.content}`;
			});

			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
				details: { total: todos.length, todos },
			};
		},
	};
}
