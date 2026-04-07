/**
 * EnterWorktree Tool - 创建独立的 worktree 工作空间
 *
 * 使用 git worktree 创建隔离的工作目录：
 * - 支持自定义 worktree 名称
 * - 自动创建 worktree/<name> 分支
 * - 支持 sparse checkout 优化
 */

import type { OmiTool } from "@omi/core";
import { Type } from "@mariozechner/pi-ai";
import { randomUUID } from "node:crypto";

export const enterWorktreeSchema = Type.Object({
	name: Type.Optional(
		Type.String({
			description: "Worktree name (slug). Defaults to 'worktree-<session-id>' if not provided.",
		}),
	),
	branch: Type.Optional(
		Type.String({
			description: "Branch name for the worktree. Defaults to 'worktree/<name>' if not provided.",
		}),
	),
	sparse_paths: Type.Optional(
		Type.Array(Type.String(), {
			description: "Paths for sparse checkout (for large monorepos). Only these paths will be checked out.",
		}),
	),
});

export type EnterWorktreeInput = typeof enterWorktreeSchema.static;

interface WorktreeCreateOptions {
	name?: string;
	branch?: string;
	sessionId?: string;
}

interface WorktreeCreateResult {
	worktreePath: string;
	worktreeBranch: string;
	originalBranch: string;
	originalHeadCommit: string;
	creationDurationMs?: number;
}

interface WorktreeStateManager {
	isInWorktree(): boolean;
	enterWorktree(repoRoot: string, options: WorktreeCreateOptions): Promise<WorktreeCreateResult>;
}

let worktreeStateInstance: WorktreeStateManager = {
	isInWorktree: () => false,
	enterWorktree: async () => {
		throw new Error("Worktree state manager not initialized");
	},
};

export function setWorktreeStateManager(manager: WorktreeStateManager): void {
	worktreeStateInstance = manager;
}

/**
 * 创建 EnterWorktreeTool
 *
 * 使用场景：
 * - 子 Agent 需要独立工作空间
 * - 多 Agent 并行工作避免写入冲突
 * - 需要在不同分支上同时工作
 */
export function createEnterWorktreeTool(
	repoRoot: string,
	sessionId: string,
): OmiTool {
	return {
		name: "enter_worktree",
		label: "enter_worktree",
		description:
			"Create an isolated worktree for parallel work. This creates a new git worktree with its own working directory and branch. Use this for parallel tasks, sub-agents, or when you need to work on multiple branches simultaneously without interference.",

		parameters: enterWorktreeSchema,

		execute: async (
			_toolCallId: string,
			params: unknown,
		) => {
			const input = params as EnterWorktreeInput;

			if (worktreeStateInstance.isInWorktree()) {
				return {
					content: [
						{
							type: "text" as const,
							text: "Already in a worktree. Use exit_worktree first.",
						},
					],
					details: {},
				};
			}

			const name = input.name ?? `worktree-${sessionId.slice(0, 8)}`;
			const branch = input.branch ?? `worktree/${name}`;

			try {
				const result = await worktreeStateInstance.enterWorktree(repoRoot, {
					name,
					branch,
					sessionId,
				});

				return {
					content: [
						{
							type: "text" as const,
							text: `Entered worktree successfully:\n\n` +
								`- Path: ${result.worktreePath}\n` +
								`- Branch: ${result.worktreeBranch}\n` +
								`- Original branch: ${result.originalBranch}\n` +
								`${result.creationDurationMs ? `- Creation time: ${result.creationDurationMs}ms\n` : ""}` +
								`\nUse this path as cwd/workdir in subsequent commands for isolated execution.`,
						},
					],
					details: {
						worktreePath: result.worktreePath,
						worktreeBranch: result.worktreeBranch,
						originalBranch: result.originalBranch,
						originalHeadCommit: result.originalHeadCommit,
						creationDurationMs: result.creationDurationMs,
					},
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Failed to enter worktree: ${error instanceof Error ? error.message : String(error)}`,
						},
					],
					details: {
						error: error instanceof Error ? error.message : String(error),
					},
				};
			}
		},
	};
}

export const enterWorktreeTool = createEnterWorktreeTool(process.cwd(), randomUUID());
