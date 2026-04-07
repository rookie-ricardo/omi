/**
 * ExitWorktree Tool - 退出 worktree 工作空间
 *
 * 支持两种退出策略：
 * - keep: 保留 worktree 目录，切换回原目录
 * - remove: 删除 worktree（有严格的变更检测 fail-closed）
 */

import type { OmiTool } from "@omi/core";
import { Type } from "@mariozechner/pi-ai";

export const exitWorktreeSchema = Type.Object({
	action: Type.Union([Type.Literal("keep"), Type.Literal("remove")], {
		description: "Action to take: 'keep' preserves the worktree directory, 'remove' deletes it.",
	}),
	discard_changes: Type.Optional(
		Type.Boolean({
			description: "Required when action is 'remove' and there are uncommitted changes or new commits. Force removal even with changes.",
		}),
	),
});

export type ExitWorktreeInput = typeof exitWorktreeSchema.static;

interface ExitWorktreeOptions {
	action: "keep" | "remove";
	discardChanges?: boolean;
}

interface WorktreeChanges {
	hasUncommittedChanges: boolean;
	hasNewCommits: boolean;
	uncommittedFilesCount: number;
	newCommitsCount: number;
}

interface WorktreeState {
	worktreePath?: string;
	originalHeadCommit?: string;
}

interface ExitWorktreeStateManager {
	isInWorktree(): boolean;
	getState(): WorktreeState;
	countWorktreeChanges(worktreePath: string, originalHeadCommit?: string): WorktreeChanges | null;
	exitWorktree(options: ExitWorktreeOptions): Promise<void>;
}

let exitWorktreeStateInstance: ExitWorktreeStateManager = {
	isInWorktree: () => false,
	getState: () => ({}),
	countWorktreeChanges: () => null,
	exitWorktree: async () => {
		throw new Error("Exit worktree state manager not initialized");
	},
};

export function setExitWorktreeStateManager(manager: ExitWorktreeStateManager): void {
	exitWorktreeStateInstance = manager;
}

/**
 * 创建 ExitWorktreeTool
 *
 * 使用场景：
 * - 任务完成，需要合并 worktree 中的变更
 * - 任务失败，需要清理 worktree
 * - 切换回主工作目录
 */
export function createExitWorktreeTool(sessionId: string): OmiTool {
	return {
		name: "exit_worktree",
		label: "exit_worktree",
		description: `Exit the current worktree. Only operates on worktrees created by enter_worktree in the current session.

Actions:
- "keep": Preserve the worktree directory for later manual work or merging
- "remove": Delete the worktree. Has safety checks: will fail if there are uncommitted changes or new commits, unless you set discard_changes: true

Use discard_changes: true only when you are certain the worktree changes are no longer needed.`,

		parameters: exitWorktreeSchema,

		execute: async (
			_toolCallId: string,
			params: unknown,
		) => {
			const input = params as ExitWorktreeInput;

			if (!exitWorktreeStateInstance.isInWorktree()) {
				return {
					content: [
						{
							type: "text" as const,
							text: "Not in a worktree.",
						},
					],
					details: {},
				};
			}

			const options: ExitWorktreeOptions = {
				action: input.action,
				discardChanges: input.discard_changes ?? false,
			};

			// 检查变更情况
			const state = exitWorktreeStateInstance.getState();
			if (options.action === "remove" && state.worktreePath) {
				const changes = exitWorktreeStateInstance.countWorktreeChanges(
					state.worktreePath,
					state.originalHeadCommit,
				);

				if (changes === null) {
					return {
						content: [
							{
								type: "text" as const,
								text: "Cannot determine worktree changes. Please resolve manually or use 'keep' action instead.",
							},
						],
						details: {
							blocked: true,
							reason: "Cannot determine changes (git command failed)",
						},
					};
				}

				if (changes.hasUncommittedChanges && !options.discardChanges) {
					return {
						content: [
							{
								type: "text" as const,
								text: `Worktree has ${changes.uncommittedFilesCount} uncommitted file(s). Use discard_changes: true to force removal, or commit changes first.`,
							},
						],
						details: {
							blocked: true,
							reason: "Uncommitted changes",
							uncommittedFilesCount: changes.uncommittedFilesCount,
						},
					};
				}

				if (changes.hasNewCommits && !options.discardChanges) {
					return {
						content: [
							{
								type: "text" as const,
								text: `Worktree has ${changes.newCommitsCount} new commit(s). Use discard_changes: true to force removal, or merge changes first.`,
							},
						],
						details: {
							blocked: true,
							reason: "New commits exist",
							newCommitsCount: changes.newCommitsCount,
						},
					};
				}
			}

			try {
				await exitWorktreeStateInstance.exitWorktree(options);

				if (options.action === "keep") {
					return {
						content: [
							{
								type: "text" as const,
								text: `Worktree preserved. You can continue working in the main directory. The worktree at ${state.worktreePath} is still available for manual work or merging.`,
							},
						],
						details: {
							action: "keep",
							worktreePath: state.worktreePath,
						},
					};
				} else {
					return {
						content: [
							{
								type: "text" as const,
								text: "Worktree removed.\n\nNote: Changes in the removed worktree are lost. Make sure you have merged or committed any important changes.",
							},
						],
						details: {
							action: "remove",
							discardChanges: options.discardChanges,
						},
					};
				}
			} catch (error) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Failed to exit worktree: ${error instanceof Error ? error.message : String(error)}`,
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

export const exitWorktreeTool = createExitWorktreeTool("");
