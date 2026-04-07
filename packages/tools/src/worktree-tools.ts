/**
 * Worktree Tools
 *
 * Tools for managing worktrees for agent isolation.
 * Note: These tools depend on external WorktreeMode implementation.
 */

import type { OmiTool } from "@omi/core";
import { Type } from "@mariozechner/pi-ai";
import type { TextContent } from "@mariozechner/pi-ai";

// ============================================================================
// Tool Names
// ============================================================================

export const ENTER_WORKTREE_TOOL = "enter_worktree";
export const EXIT_WORKTREE_TOOL = "exit_worktree";
export const LIST_WORKTREES_TOOL = "list_worktrees";
export const CHECK_WORKTREE_CHANGES_TOOL = "check_worktree_changes";

// ============================================================================
// Tool Schemas
// ============================================================================

export const enterWorktreeSchema = Type.Object({
  branch: Type.Optional(
    Type.String({ description: "Branch name for the worktree" })
  ),
  fromCommit: Type.Optional(
    Type.String({ description: "Create worktree from a specific commit" })
  ),
  name: Type.Optional(
    Type.String({ description: "Name for the worktree" })
  ),
});

export const exitWorktreeSchema = Type.Object({
  worktreeId: Type.Optional(
    Type.String({ description: "Worktree ID to exit from (default: current)" })
  ),
  force: Type.Optional(
    Type.Boolean({
      description: "Force cleanup even with uncommitted changes",
    })
  ),
});

export const listWorktreesSchema = Type.Object({
  filter: Type.Optional(
    Type.Union([
      Type.Literal("all"),
      Type.Literal("active"),
      Type.Literal("dirty"),
    ], { description: "Filter worktrees by status" })
  ),
});

export const checkWorktreeChangesSchema = Type.Object({
  worktreeId: Type.Optional(
    Type.String({ description: "Worktree ID to check (default: current)" })
  ),
});

// ============================================================================
// Tool Implementations
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface WorktreeToolsConfig {
  /** Worktree mode instance */
  worktreeMode: any;
  /** Default config for worktree creation */
  defaultConfig: any;
}

/**
 * Create Enter Worktree tool.
 */
export function createEnterWorktreeTool(config: WorktreeToolsConfig): OmiTool<typeof enterWorktreeSchema> {
  return {
    name: ENTER_WORKTREE_TOOL,
    label: ENTER_WORKTREE_TOOL,
    description: "Create and enter a new worktree for isolated agent execution. Changes in the worktree are isolated from the parent.",
    parameters: enterWorktreeSchema,
    execute: async (toolCallId: string, params: unknown) => {
      const { branch, fromCommit, name } = params as {
        branch?: string;
        fromCommit?: string;
        name?: string;
      };

      try {
        const worktree = config.worktreeMode.createWorktree({
          branch: name ? `${config.defaultConfig.branchPrefix ?? "agent/"}${name}` : branch,
          fromCommit,
        });

        return {
          content: [{
            type: "text" as const,
            text: `Created worktree: ${worktree.name}\nPath: ${worktree.path}\nBranch: ${worktree.branch}`,
          } as TextContent],
          details: worktree,
        };
      } catch (error) {
        return {
          content: [{
            type: "text" as const,
            text: `Error creating worktree: ${error instanceof Error ? error.message : String(error)}`,
          } as TextContent],
          details: { error: String(error) },
        };
      }
    },
  };
}

/**
 * Create Exit Worktree tool.
 */
export function createExitWorktreeTool(config: WorktreeToolsConfig): OmiTool<typeof exitWorktreeSchema> {
  return {
    name: EXIT_WORKTREE_TOOL,
    label: EXIT_WORKTREE_TOOL,
    description: "Exit and clean up a worktree. Use force=true to force cleanup even with uncommitted changes.",
    parameters: exitWorktreeSchema,
    execute: async (toolCallId: string, params: unknown) => {
      const { worktreeId, force = false } = params as {
        worktreeId?: string;
        force?: boolean;
      };

      try {
        const targetId = worktreeId ?? config.worktreeMode.getCurrentWorktree()?.name;
        if (!targetId) {
          return {
            content: [{
              type: "text" as const,
              text: "No active worktree to exit from.",
            } as TextContent],
            details: { error: "No active worktree" },
          };
        }

        // Check if safe to delete
        const canDelete = config.worktreeMode.canDelete(targetId);
        if (!canDelete.safe && !force) {
          return {
            content: [{
              type: "text" as const,
              text: `Cannot exit worktree: ${canDelete.reason}\nUse force=true to force cleanup.`,
            } as TextContent],
            details: { safe: false, reason: canDelete.reason },
          };
        }

        const cleaned = await config.worktreeMode.cleanup(targetId, force);

        return {
          content: [{
            type: "text" as const,
            text: `Worktree cleaned: ${cleaned.name}\nPath: ${cleaned.path}`,
          } as TextContent],
          details: cleaned,
        };
      } catch (error) {
        return {
          content: [{
            type: "text" as const,
            text: `Error exiting worktree: ${error instanceof Error ? error.message : String(error)}`,
          } as TextContent],
          details: { error: String(error) },
        };
      }
    },
  };
}

/**
 * Create List Worktrees tool.
 */
export function createListWorktreesTool(config: WorktreeToolsConfig): OmiTool<typeof listWorktreesSchema> {
  return {
    name: LIST_WORKTREES_TOOL,
    label: LIST_WORKTREES_TOOL,
    description: "List all worktrees managed by this agent.",
    parameters: listWorktreesSchema,
    execute: async (toolCallId: string, params: unknown) => {
      const { filter = "all" } = params as { filter?: "all" | "active" | "dirty" };

      try {
        let worktrees = config.worktreeMode.listWorktrees();

        // Refresh statuses
        config.worktreeMode.refresh();

        switch (filter) {
          case "active":
            worktrees = worktrees.filter((w: any) => w.status === "active");
            break;
          case "dirty":
            worktrees = config.worktreeMode.getDirtyWorktrees();
            break;
        }

        if (worktrees.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: `No worktrees found (filter: ${filter}).`,
            } as TextContent],
            details: { count: 0 },
          };
        }

        const current = config.worktreeMode.getCurrentWorktree();
        const lines: string[] = [`Worktrees (${worktrees.length}):`];
        lines.push("");

        for (const wt of worktrees) {
          const isCurrent = current?.name === wt.name;
          lines.push(`## ${wt.name}${isCurrent ? " [CURRENT]" : ""}`);
          lines.push(`- Path: ${wt.path}`);
          lines.push(`- Branch: ${wt.branch}`);
          lines.push(`- Status: ${wt.status}`);
          lines.push(`- Dirty: ${wt.isDirty ? "Yes" : "No"}`);
          lines.push(`- Created: ${wt.createdAt}`);
          lines.push("");
        }

        return {
          content: [{
            type: "text" as const,
            text: lines.join("\n"),
          } as TextContent],
          details: { count: worktrees.length, worktrees },
        };
      } catch (error) {
        return {
          content: [{
            type: "text" as const,
            text: `Error listing worktrees: ${error instanceof Error ? error.message : String(error)}`,
          } as TextContent],
          details: { error: String(error) },
        };
      }
    },
  };
}

/**
 * Create Check Worktree Changes tool.
 */
export function createCheckWorktreeChangesTool(
  config: WorktreeToolsConfig
): OmiTool<typeof checkWorktreeChangesSchema> {
  return {
    name: CHECK_WORKTREE_CHANGES_TOOL,
    label: CHECK_WORKTREE_CHANGES_TOOL,
    description: "Check for uncommitted changes in a worktree.",
    parameters: checkWorktreeChangesSchema,
    execute: async (toolCallId: string, params: unknown) => {
      const { worktreeId } = params as { worktreeId?: string };

      try {
        const targetId = worktreeId ?? config.worktreeMode.getCurrentWorktree()?.name;
        if (!targetId) {
          return {
            content: [{
              type: "text" as const,
              text: "No worktree specified.",
            } as TextContent],
            details: { error: "No worktree specified" },
          };
        }

        const changes = config.worktreeMode.detectChanges(targetId);
        const worktree = config.worktreeMode.getWorktree(targetId);

        const lines: string[] = [`Worktree: ${targetId}`];
        lines.push(`Safe to delete: ${changes.safeToDelete ? "Yes" : "No"}`);
        lines.push("");
        lines.push(`Total changes: ${changes.totalChanges}`);

        if (changes.modified.length > 0) {
          lines.push(`\nModified (${changes.modified.length}):`);
          for (const file of changes.modified.slice(0, 10)) {
            lines.push(`  - ${file}`);
          }
          if (changes.modified.length > 10) {
            lines.push(`  ... and ${changes.modified.length - 10} more`);
          }
        }

        if (changes.added.length > 0) {
          lines.push(`\nAdded (${changes.added.length}):`);
          for (const file of changes.added.slice(0, 10)) {
            lines.push(`  + ${file}`);
          }
          if (changes.added.length > 10) {
            lines.push(`  ... and ${changes.added.length - 10} more`);
          }
        }

        if (changes.deleted.length > 0) {
          lines.push(`\nDeleted (${changes.deleted.length}):`);
          for (const file of changes.deleted.slice(0, 10)) {
            lines.push(`  - ${file}`);
          }
          if (changes.deleted.length > 10) {
            lines.push(`  ... and ${changes.deleted.length - 10} more`);
          }
        }

        if (changes.totalChanges === 0) {
          lines.push("\nNo changes detected.");
        }

        return {
          content: [{
            type: "text" as const,
            text: lines.join("\n"),
          } as TextContent],
          details: {
            worktreeId: targetId,
            worktree,
            ...changes,
          },
        };
      } catch (error) {
        return {
          content: [{
            type: "text" as const,
            text: `Error checking changes: ${error instanceof Error ? error.message : String(error)}`,
          } as TextContent],
          details: { error: String(error) },
        };
      }
    },
  };
}

/**
 * Create all worktree tools.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createWorktreeTools(config: WorktreeToolsConfig): OmiTool<any>[] {
  return [
    createEnterWorktreeTool(config) as OmiTool<any>,
    createExitWorktreeTool(config) as OmiTool<any>,
    createListWorktreesTool(config) as OmiTool<any>,
    createCheckWorktreeChangesTool(config) as OmiTool<any>,
  ];
}
