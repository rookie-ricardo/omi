import type { AgentTool } from "@mariozechner/pi-agent-core";

import { createReadTool } from "./read.js";
import { createBashTool } from "./bash.js";
import { createEditTool } from "./edit.js";
import { createWriteTool } from "./write.js";
import { createLsTool } from "./ls.js";
import { createGrepTool } from "./grep.js";
import { createFindTool } from "./find.js";
import { createEnterPlanTool } from "./enter-plan/index.js";
import { createExitPlanTool } from "./exit-plan/index.js";
import { createEnterWorktreeTool } from "./enter-worktree/index.js";
import { createExitWorktreeTool } from "./exit-worktree/index.js";

export type ApprovalPolicy = "always" | "safe";
export type ToolName = string;

export interface ToolContext {
  workspaceRoot: string;
  sessionId?: string;
}

// Tools that require explicit user approval before execution
const ALWAYS_APPROVAL_TOOLS = new Set<string>(["bash", "edit", "write"]);

// All known built-in tool names
const BUILT_IN_TOOL_NAMES = new Set<string>([
  "read",
  "bash",
  "edit",
  "write",
  "ls",
  "grep",
  "find",
  "enter_plan",
  "exit_plan",
  "enter_worktree",
  "exit_worktree",
]);

/**
 * Check if a tool requires user approval before execution.
 */
export function requiresApproval(toolName: ToolName): boolean {
  return ALWAYS_APPROVAL_TOOLS.has(toolName);
}

/**
 * Check if a tool name is a known built-in tool.
 */
export function isBuiltInTool(toolName: string): boolean {
  return BUILT_IN_TOOL_NAMES.has(toolName);
}

/**
 * Create all coding tools configured for a specific working directory.
 * Returns a Record mapping tool names to AgentTool instances.
 */
export function createAllTools(cwd: string, sessionId?: string): Record<string, AgentTool> {
  return {
    read: createReadTool(cwd),
    bash: createBashTool(cwd),
    edit: createEditTool(cwd),
    write: createWriteTool(cwd),
    ls: createLsTool(cwd),
    grep: createGrepTool(cwd),
    find: createFindTool(cwd),
    enter_plan: createEnterPlanTool(sessionId ?? "") as AgentTool,
    exit_plan: createExitPlanTool(sessionId ?? "") as AgentTool,
    enter_worktree: createEnterWorktreeTool(cwd, sessionId ?? "") as AgentTool,
    exit_worktree: createExitWorktreeTool(sessionId ?? "") as AgentTool,
  };
}

/**
 * Create all tools as an array for direct use with Agent.setTools().
 */
export function createToolArray(cwd: string): AgentTool[] {
  return Object.values(createAllTools(cwd));
}

// ============================================================================
// Backward compatibility layer
// ============================================================================

/**
 * @deprecated Use isBuiltInTool() instead.
 */
export const toolRegistry = {
  has: isBuiltInTool,
};

/**
 * @deprecated Use createAllTools() or createToolArray() instead.
 */
export async function executeTool(
  toolName: ToolName,
  rawInput: unknown,
  context: ToolContext,
): Promise<{ ok: boolean; output?: Record<string, unknown>; error?: { code: string; message: string } }> {
  if (!isBuiltInTool(toolName)) {
    return { ok: false, error: { code: "UNKNOWN_TOOL", message: `Unknown tool ${toolName}` } };
  }

  try {
    const allTools = createAllTools(context.workspaceRoot);
    const tool = allTools[toolName];
    if (!tool) {
      return { ok: false, error: { code: "UNKNOWN_TOOL", message: `Tool ${toolName} not found in registry` } };
    }

    const result = await tool.execute(`${toolName}-call`, rawInput);
    const content =
      result.content
        ?.filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n") ?? "";

    return {
      ok: true,
      output: { content, details: result.details ?? {} },
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "TOOL_EXECUTION_FAILED",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
