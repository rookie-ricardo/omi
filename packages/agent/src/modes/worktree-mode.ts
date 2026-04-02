/**
 * Worktree Mode
 *
 * Provides worktree isolation for agent execution:
 * - Create isolated worktrees for tasks
 * - Safe cleanup with change detection
 * - Parent-child relationship tracking
 */

import { createId, nowIso } from "@omi/core";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export type WorktreeStatus = "inactive" | "active" | "dirty" | "cleaning" | "cleaned" | "failed";

export interface WorktreeInfo {
  /** Worktree root path */
  path: string;
  /** Worktree name (git worktree list name) */
  name: string;
  /** Branch name */
  branch: string;
  /** Parent worktree path */
  parentPath?: string;
  /** When the worktree was created */
  createdAt: string;
  /** Whether there are uncommitted changes */
  isDirty: boolean;
  /** Status of the worktree */
  status: WorktreeStatus;
}

export interface WorktreeConfig {
  /** Base path for worktrees */
  basePath: string;
  /** Git executable path */
  gitPath?: string;
  /** Whether to fail if worktree has uncommitted changes */
  failOnDirty?: boolean;
  /** Custom branch prefix */
  branchPrefix?: string;
}

export interface WorktreeChangeDetection {
  /** Files that have been modified */
  modified: string[];
  /** Files that have been added */
  added: string[];
  /** Files that have been deleted */
  deleted: string[];
  /** Total number of changes */
  totalChanges: number;
  /** Whether it's safe to delete */
  safeToDelete: boolean;
}

// ============================================================================
// Worktree Manager
// ============================================================================

export class WorktreeMode {
  private config: Required<WorktreeConfig>;
  private worktrees: Map<string, WorktreeInfo> = new Map();
  private currentWorktree?: string;

  constructor(config: WorktreeConfig) {
    this.config = {
      basePath: config.basePath,
      gitPath: config.gitPath ?? "git",
      failOnDirty: config.failOnDirty ?? true,
      branchPrefix: config.branchPrefix ?? "agent/",
    };
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Create a new worktree.
   */
  createWorktree(options: {
    branch?: string;
    fromCommit?: string;
    parentPath?: string;
  } = {}): WorktreeInfo {
    const worktreeId = createId("wt");
    const branch = options.branch ?? `${this.config.branchPrefix}${worktreeId}`;
    const worktreePath = path.join(this.config.basePath, worktreeId);

    // Create the worktree
    const args = ["worktree", "add"];

    if (options.fromCommit) {
      args.push("-b", branch);
      args.push(worktreePath);
      args.push(options.fromCommit);
    } else {
      args.push(worktreePath);
      args.push(`-b`, branch);
    }

    try {
      this.execGit(args);
    } catch (error) {
      throw new Error(`Failed to create worktree: ${error instanceof Error ? error.message : String(error)}`);
    }

    const worktree: WorktreeInfo = {
      path: worktreePath,
      name: worktreeId,
      branch,
      parentPath: options.parentPath,
      createdAt: nowIso(),
      isDirty: false,
      status: "active",
    };

    this.worktrees.set(worktreeId, worktree);
    this.currentWorktree = worktreeId;

    return worktree;
  }

  /**
   * Switch to a worktree.
   */
  switchTo(worktreeId: string): WorktreeInfo {
    const worktree = this.worktrees.get(worktreeId);
    if (!worktree) {
      throw new Error(`Worktree not found: ${worktreeId}`);
    }

    this.currentWorktree = worktreeId;
    return worktree;
  }

  /**
   * Get current worktree.
   */
  getCurrentWorktree(): WorktreeInfo | undefined {
    if (!this.currentWorktree) return undefined;
    return this.worktrees.get(this.currentWorktree);
  }

  /**
   * Get worktree by ID.
   */
  getWorktree(worktreeId: string): WorktreeInfo | undefined {
    return this.worktrees.get(worktreeId);
  }

  /**
   * List all worktrees.
   */
  listWorktrees(): WorktreeInfo[] {
    return Array.from(this.worktrees.values());
  }

  // ==========================================================================
  // Change Detection
  // ==========================================================================

  /**
   * Check if worktree has uncommitted changes.
   */
  checkDirty(worktreeId: string): boolean {
    const worktree = this.worktrees.get(worktreeId);
    if (!worktree) {
      throw new Error(`Worktree not found: ${worktreeId}`);
    }

    try {
      const result = this.execGit(["status", "--porcelain"], worktree.path);
      worktree.isDirty = result.trim().length > 0;
      return worktree.isDirty;
    } catch {
      return false;
    }
  }

  /**
   * Detect changes in a worktree.
   */
  detectChanges(worktreeId: string): WorktreeChangeDetection {
    const worktree = this.worktrees.get(worktreeId);
    if (!worktree) {
      throw new Error(`Worktree not found: ${worktreeId}`);
    }

    try {
      const result = this.execGit(["status", "--porcelain", "-uall"], worktree.path);
      const lines = result.trim().split("\n").filter(Boolean);

      const modified: string[] = [];
      const added: string[] = [];
      const deleted: string[] = [];

      for (const line of lines) {
        const status = line.slice(0, 2);
        const file = line.slice(3);

        if (status.includes("M") || status === " M") {
          modified.push(file);
        } else if (status.includes("A") || status === "A ") {
          added.push(file);
        } else if (status.includes("D") || status === " D") {
          deleted.push(file);
        }
      }

      const totalChanges = modified.length + added.length + deleted.length;

      return {
        modified,
        added,
        deleted,
        totalChanges,
        safeToDelete: totalChanges === 0,
      };
    } catch {
      return {
        modified: [],
        added: [],
        deleted: [],
        totalChanges: 0,
        safeToDelete: true,
      };
    }
  }

  /**
   * Check if it's safe to delete a worktree.
   */
  canDelete(worktreeId: string): { safe: boolean; reason?: string } {
    const worktree = this.worktrees.get(worktreeId);
    if (!worktree) {
      return { safe: false, reason: "Worktree not found" };
    }

    if (worktree.status === "cleaning") {
      return { safe: false, reason: "Worktree is being cleaned" };
    }

    if (worktree.status === "cleaned") {
      return { safe: false, reason: "Worktree already cleaned" };
    }

    // Check for uncommitted changes
    if (this.checkDirty(worktreeId)) {
      if (this.config.failOnDirty) {
        return {
          safe: false,
          reason: "Worktree has uncommitted changes and failOnDirty is enabled",
        };
      }

      const changes = this.detectChanges(worktreeId);
      if (changes.totalChanges > 0) {
        return {
          safe: false,
          reason: `Worktree has ${changes.totalChanges} uncommitted changes`,
        };
      }
    }

    return { safe: true };
  }

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  /**
   * Clean up a worktree (fail-closed: reject if has changes).
   */
  async cleanup(worktreeId: string, force = false): Promise<WorktreeInfo> {
    const worktree = this.worktrees.get(worktreeId);
    if (!worktree) {
      throw new Error(`Worktree not found: ${worktreeId}`);
    }

    // Check if safe to delete
    if (!force) {
      const canDelete = this.canDelete(worktreeId);
      if (!canDelete.safe) {
        throw new Error(`Cannot delete worktree: ${canDelete.reason}`);
      }
    }

    worktree.status = "cleaning";

    try {
      // Remove from git
      this.execGit(["worktree", "remove", worktree.path, "--force"]);

      // Remove directory
      if (fs.existsSync(worktree.path)) {
        fs.rmSync(worktree.path, { recursive: true, force: true });
      }

      worktree.status = "cleaned";

      if (this.currentWorktree === worktreeId) {
        this.currentWorktree = undefined;
      }
    } catch (error) {
      worktree.status = "failed";
      throw new Error(`Failed to cleanup worktree: ${error instanceof Error ? error.message : String(error)}`);
    }

    return worktree;
  }

  /**
   * Clean up all worktrees.
   */
  async cleanupAll(force = false): Promise<string[]> {
    const cleaned: string[] = [];

    for (const [id, worktree] of this.worktrees.entries()) {
      try {
        await this.cleanup(id, force);
        cleaned.push(id);
      } catch {
        // Continue with other worktrees
      }
    }

    return cleaned;
  }

  // ==========================================================================
  // Git Operations
  // ==========================================================================

  /**
   * Execute a git command in a worktree.
   */
  execGit(args: string[], worktreePath?: string): string {
    const cwd = worktreePath ?? this.config.basePath;
    try {
      return execSync([this.config.gitPath, ...args].join(" "), {
        cwd,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
      });
    } catch (error) {
      if (error instanceof Error && "stdout" in error) {
        return (error as any).stdout ?? "";
      }
      throw error;
    }
  }

  // ==========================================================================
  // State
  // ==========================================================================

  /**
   * Get active worktrees count.
   */
  getActiveCount(): number {
    return Array.from(this.worktrees.values()).filter((w) => w.status === "active").length;
  }

  /**
   * Get worktrees with changes.
   */
  getDirtyWorktrees(): WorktreeInfo[] {
    return Array.from(this.worktrees.values()).filter((w) => w.isDirty);
  }

  /**
   * Update all worktree statuses.
   */
  refresh(): void {
    for (const [id, worktree] of this.worktrees.entries()) {
      if (worktree.status === "active") {
        this.checkDirty(id);
      }
    }
  }
}

// ============================================================================
// Worktree Lifecycle Integration
// ============================================================================

export interface WorktreeLifecycleEvents {
  "worktree.created": WorktreeInfo;
  "worktree.entered": WorktreeInfo;
  "worktree.exited": WorktreeInfo;
  "worktree.cleaning": WorktreeInfo;
  "worktree.cleaned": WorktreeInfo;
  "worktree.failed": { worktree: WorktreeInfo; error: string };
}

/**
 * Create worktree lifecycle hooks.
 */
export function createWorktreeLifecycleHooks(
  worktreeMode: WorktreeMode
): {
  onCreate: (callback: (info: WorktreeInfo) => void) => void;
  onEnter: (callback: (info: WorktreeInfo) => void) => void;
  onExit: (callback: (info: WorktreeInfo) => void) => void;
  onClean: (callback: (info: WorktreeInfo) => void) => void;
} {
  const listeners: Partial<WorktreeLifecycleEvents> = {};

  return {
    onCreate: (callback) => {
      // Hook into createWorktree
    },
    onEnter: (callback) => {
      // Hook into switchTo
    },
    onExit: (callback) => {
      // Hook into cleanup
    },
    onClean: (callback) => {
      // Hook into cleanup completion
    },
  };
}
