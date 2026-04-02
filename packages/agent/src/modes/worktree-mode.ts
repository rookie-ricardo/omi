/**
 * Worktree Mode - Git Worktree 隔离机制
 *
 * 实现：
 * 1. EnterWorktree 生命周期：创建独立工作目录
 * 2. ExitWorktree 生命周期：安全清理或保留 worktree
 * 3. 变更检测 fail-closed：拒绝删除有未提交变更的 worktree
 */

import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { chdir } from "node:process";
import { nowIso } from "@omi/core";

// ============================================================================
// Types
// ============================================================================

/**
 * Worktree 状态
 */
export interface WorktreeState {
	isInWorktree: boolean;
	worktreePath?: string;
	worktreeName?: string;
	worktreeBranch?: string;
	originalCwd?: string;
	originalBranch?: string;
	originalHeadCommit?: string;
	sessionId?: string;
	createdAt?: string;
	hookBased?: boolean;
}

/**
 * Worktree 创建选项
 */
export interface WorktreeCreateOptions {
	name?: string;
	branch?: string;
	hookBased?: boolean;
	sessionId?: string;
}

/**
 * Worktree 创建结果
 */
export interface WorktreeCreateResult {
	worktreePath: string;
	worktreeBranch: string;
	originalBranch: string;
	originalHeadCommit: string;
	creationDurationMs?: number;
}

/**
 * Worktree 变更统计
 */
export interface WorktreeChanges {
	hasUncommittedChanges: boolean;
	hasNewCommits: boolean;
	uncommittedFilesCount: number;
	newCommitsCount: number;
}

/**
 * ExitWorktree 选项
 */
export interface ExitWorktreeOptions {
	action: "keep" | "remove";
	discardChanges?: boolean;
}

/**
 * Worktree 事件类型
 */
export type WorktreeEventType = "enter_worktree" | "exit_worktree" | "remove_worktree" | "keep_worktree";

/**
 * Worktree 事件
 */
export interface WorktreeEvent {
	type: WorktreeEventType;
	sessionId: string;
	timestamp: string;
	worktreePath?: string;
	worktreeName?: string;
	success?: boolean;
	error?: string;
}

/**
 * Worktree 事件处理器
 */
export type WorktreeEventHandler = (event: WorktreeEvent) => void;

// ============================================================================
// Worktree State Manager
// ============================================================================

/**
 * Worktree 状态管理器
 * 管理 worktree 的创建/销毁和状态
 */
export class WorktreeStateManager {
	private state: WorktreeState = {
		isInWorktree: false,
	};

	private eventHandlers: WorktreeEventHandler[] = [];

	/**
	 * 检查当前是否处于 Worktree 中
	 */
	isInWorktree(): boolean {
		return this.state.isInWorktree;
	}

	/**
	 * 获取当前 Worktree 状态
	 */
	getState(): Readonly<WorktreeState> {
		return this.state;
	}

	/**
	 * 进入 Worktree
	 */
	async enterWorktree(
		repoRoot: string,
		options: WorktreeCreateOptions = {},
	): Promise<WorktreeCreateResult> {
		if (this.state.isInWorktree) {
			throw new Error("Already in a worktree");
		}

		const startTime = Date.now();
		const sessionId = options.sessionId ?? randomUUID();
		const slug = options.name ?? `worktree-${sessionId.slice(0, 8)}`;

		// 获取原始分支和 commit
		const originalBranch = this.getCurrentBranch(repoRoot);
		const originalHeadCommit = this.getCurrentHead(repoRoot);

		// 创建 worktree
		const worktreeBranch = options.branch ?? `worktree/${slug}`;
		const worktreePath = await this.createWorktree(repoRoot, slug, worktreeBranch);

		// 更新状态
		this.state = {
			isInWorktree: true,
			worktreePath,
			worktreeName: slug,
			worktreeBranch,
			originalCwd: process.cwd(),
			originalBranch,
			originalHeadCommit,
			sessionId,
			createdAt: nowIso(),
			hookBased: options.hookBased,
		};

		// 切换到 worktree 目录
		chdir(worktreePath);

		const durationMs = Date.now() - startTime;

		this.emitEvent({
			type: "enter_worktree",
			sessionId,
			timestamp: nowIso(),
			worktreePath,
			worktreeName: slug,
			success: true,
		});

		return {
			worktreePath,
			worktreeBranch,
			originalBranch,
			originalHeadCommit,
			creationDurationMs: durationMs,
		};
	}

	/**
	 * 退出 Worktree
	 */
	async exitWorktree(options: ExitWorktreeOptions = { action: "keep" }): Promise<void> {
		if (!this.state.isInWorktree || !this.state.worktreePath) {
			throw new Error("Not in a worktree");
		}

		const { worktreePath, worktreeName, worktreeBranch } = this.state;
		const sessionId = this.state.sessionId ?? "";

		if (options.action === "keep") {
			// 保留 worktree，只切换回原目录
			this.keepWorktree();
			return;
		}

		// action === "remove"：删除 worktree
		const changes = this.countWorktreeChanges(worktreePath, this.state.originalHeadCommit);

		if (changes === null) {
			// fail-closed: 无法确定变更，拒绝删除
			throw new Error(
				"Cannot determine worktree changes. Manual cleanup required.",
			);
		}

		if (changes.hasUncommittedChanges && !options.discardChanges) {
			throw new Error(
				`Worktree has ${changes.uncommittedFilesCount} uncommitted file(s). Use discardChanges: true to force removal.`,
			);
		}

		if (changes.hasNewCommits && !options.discardChanges) {
			throw new Error(
				`Worktree has ${changes.newCommitsCount} new commit(s). Use discardChanges: true to force removal.`,
			);
		}

		// 执行删除
		await this.removeWorktree(worktreePath, worktreeBranch);

		// 清理状态
		this.state = {
			isInWorktree: false,
		};

		this.emitEvent({
			type: "exit_worktree",
			sessionId,
			timestamp: nowIso(),
			worktreePath,
			worktreeName,
			success: true,
		});
	}

	/**
	 * 保留 worktree，切换回原目录
	 */
	private keepWorktree(): void {
		if (this.state.originalCwd) {
			chdir(this.state.originalCwd);
		}

		this.emitEvent({
			type: "keep_worktree",
			sessionId: this.state.sessionId ?? "",
			timestamp: nowIso(),
			worktreePath: this.state.worktreePath,
			worktreeName: this.state.worktreeName,
			success: true,
		});

		// 只清空 worktree 状态，保留目录
		this.state = {
			isInWorktree: false,
		};
	}

	/**
	 * 删除 worktree
	 */
	private async removeWorktree(worktreePath: string, worktreeBranch?: string): Promise<void> {
		try {
			// git worktree remove --force
			execSync(`git worktree remove "${worktreePath}" --force`, {
				stdio: "pipe",
			});

			// 删除分支
			if (worktreeBranch) {
				try {
					execSync(`git branch -D "${worktreeBranch}"`, {
						stdio: "pipe",
					});
				} catch {
					// 忽略分支删除失败
				}
			}
		} catch (error) {
			throw new Error(`Failed to remove worktree: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * 创建 worktree
	 */
	private async createWorktree(
		repoRoot: string,
		slug: string,
		branch: string,
	): Promise<string> {
		// 验证 slug
		if (!this.validateWorktreeSlug(slug)) {
			throw new Error(`Invalid worktree slug: ${slug}`);
		}

		// worktrees 目录
		const worktreesDir = join(repoRoot, ".claude", "worktrees");
		if (!existsSync(worktreesDir)) {
			mkdirSync(worktreesDir, { recursive: true });
		}

		const worktreePath = join(worktreesDir, slug);

		// 检查是否已存在
		if (existsSync(worktreePath)) {
			// 快速恢复：检查 .git 指针文件
			const gitPointer = join(worktreePath, ".git");
			if (existsSync(gitPointer)) {
				return worktreePath;
			}
			throw new Error(`Worktree path already exists: ${worktreePath}`);
		}

		// 获取默认分支
		const defaultBranch = this.getDefaultBranch(repoRoot);

		// 创建 worktree
		try {
			execSync(
				`git worktree add -b "${branch}" "${worktreePath}" "${defaultBranch}"`,
				{
					cwd: repoRoot,
					stdio: "pipe",
				},
			);
		} catch (error) {
			throw new Error(
				`Failed to create worktree: ${error instanceof Error ? error.message : String(error)}`,
			);
		}

		return worktreePath;
	}

	/**
	 * 验证 worktree slug 格式
	 */
	private validateWorktreeSlug(slug: string): boolean {
		if (slug.length > 64) {
			return false;
		}
		// 每个段只允许字母、数字、.、_、-
		const segmentPattern = /^[a-zA-Z0-9._-]+$/;
		const segments = slug.split("/");
		return segments.every((segment) => segmentPattern.test(segment));
	}

	/**
	 * 获取当前分支
	 */
	private getCurrentBranch(repoRoot: string): string {
		try {
			const branch = execSync("git branch --show-current", {
				cwd: repoRoot,
				stdio: "pipe",
				encoding: "utf-8",
			}).trim();
			return branch || "HEAD";
		} catch {
			return "HEAD";
		}
	}

	/**
	 * 获取默认分支
	 */
	private getDefaultBranch(repoRoot: string): string {
		try {
			const branch = execSync("git rev-parse --abbrev-ref origin/HEAD", {
				cwd: repoRoot,
				stdio: "pipe",
				encoding: "utf-8",
			})
				.trim()
				.replace("origin/", "");
			return branch || "main";
		} catch {
			return "main";
		}
	}

	/**
	 * 获取当前 HEAD commit
	 */
	private getCurrentHead(repoRoot: string): string {
		try {
			return execSync("git rev-parse HEAD", {
				cwd: repoRoot,
				stdio: "pipe",
				encoding: "utf-8",
			}).trim();
		} catch {
			return "";
		}
	}

	/**
	 * 统计 worktree 变更
	 * 返回 null 表示无法确定（fail-closed）
	 */
	countWorktreeChanges(worktreePath: string, originalHeadCommit?: string): WorktreeChanges | null {
		if (!existsSync(worktreePath)) {
			return null;
		}

		try {
			// 统计未提交文件
			const statusOutput = execSync("git status --porcelain", {
				cwd: worktreePath,
				stdio: "pipe",
				encoding: "utf-8",
			});
			const uncommittedFilesCount = statusOutput
				.trim()
				.split("\n")
				.filter((line) => line.length > 0).length;

			// 统计新提交
			let newCommitsCount = 0;
			if (originalHeadCommit) {
				try {
					const logOutput = execSync(
						`git rev-list --count "${originalHeadCommit}"..HEAD`,
						{
							cwd: worktreePath,
							stdio: "pipe",
							encoding: "utf-8",
						},
					);
					newCommitsCount = parseInt(logOutput.trim(), 10) || 0;
				} catch {
					// git rev-list 失败，返回 null（fail-closed）
					return null;
				}
			}

			return {
				hasUncommittedChanges: uncommittedFilesCount > 0,
				hasNewCommits: newCommitsCount > 0,
				uncommittedFilesCount,
				newCommitsCount,
			};
		} catch {
			// git 命令失败，返回 null（fail-closed）
			return null;
		}
	}

	/**
	 * 订阅事件
	 */
	onEvent(handler: WorktreeEventHandler): () => void {
		this.eventHandlers.push(handler);
		return () => {
			const index = this.eventHandlers.indexOf(handler);
			if (index !== -1) {
				this.eventHandlers.splice(index, 1);
			}
		};
	}

	private emitEvent(event: WorktreeEvent): void {
		for (const handler of this.eventHandlers) {
			try {
				handler(event);
			} catch {
				// Ignore handler errors
			}
		}
	}
}

// ============================================================================
// Singleton instance
// ============================================================================

let worktreeStateManagerInstance: WorktreeStateManager | null = null;

export function getWorktreeStateManager(): WorktreeStateManager {
	if (!worktreeStateManagerInstance) {
		worktreeStateManagerInstance = new WorktreeStateManager();
	}
	return worktreeStateManagerInstance;
}

export function createWorktreeStateManager(): WorktreeStateManager {
	worktreeStateManagerInstance = new WorktreeStateManager();
	return worktreeStateManagerInstance;
}

// ============================================================================
// Exports
// ============================================================================

export { WorktreeStateManager as default };
