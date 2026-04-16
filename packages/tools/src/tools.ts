import type { OmiTool } from "@omi/core";

import {
  createBuiltInToolMap,
  getBuiltInToolDefinition,
  getBuiltInToolDefinitions,
  isBuiltInTool as isBuiltInToolFromRegistry,
} from "./builtins";
import { executeWithStructuredOutput } from "./registry";

export type ApprovalPolicy = "always" | "safe";
export type ToolName = string;

export interface ToolContext {
  workspaceRoot: string;
  sessionId?: string;
}

/**
 * Check if a tool requires user approval before execution.
 */
export function requiresApproval(toolName: ToolName): boolean {
  const definition = getBuiltInToolDefinition(toolName);
  if (!definition) {
    return false;
  }
  return !definition.isReadOnly;
}

/**
 * Check if a tool name is a known built-in tool.
 */
export function isBuiltInTool(toolName: string): boolean {
  return isBuiltInToolFromRegistry(toolName);
}

/**
 * Return the built-in tool names in registration order.
 */
export function listBuiltInToolNames(): ToolName[] {
  return getBuiltInToolDefinitions().map((definition) => definition.name);
}

/**
 * Create all coding tools configured for a specific working directory.
 * Returns a Record mapping tool names to OmiTool instances.
 */
export function createAllTools(cwd: string, sessionId?: string): Record<string, OmiTool> {
  void sessionId;
  return createBuiltInToolMap(cwd);
}

/**
 * Create all tools as an array for direct use with Agent.setTools().
 */
export function createToolArray(cwd: string): OmiTool[] {
  return Object.values(createAllTools(cwd));
}

// ============================================================================
// Backward compatibility layer
// ============================================================================

/**
 * @deprecated Use isBuiltInTool() instead.
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

    const output = await executeWithStructuredOutput(tool, `${toolName}-call`, rawInput);
    if (output.ok) {
      return {
        ok: true,
        output: {
          content: output.content ?? "",
          details: output.data ?? {},
          meta: output.meta ?? {},
        },
      };
    }

    return {
      ok: false,
      error: {
        code: output.error?.code ?? "TOOL_EXECUTION_FAILED",
        message: output.error?.message ?? "Tool execution failed",
      },
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
