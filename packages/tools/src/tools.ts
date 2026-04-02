import type { AgentTool } from "@mariozechner/pi-agent-core";

import { createReadTool } from "./read.js";
import { createBashTool } from "./bash.js";
import { createEditTool } from "./edit.js";
import { createWriteTool } from "./write.js";
import { createLsTool } from "./ls.js";
import { createGrepTool } from "./grep.js";
import { createFindTool } from "./find.js";

import {
  type ToolDefinition,
  type ToolRiskLevel,
  type ToolIdempotencyPolicy,
  TOOL_ERROR_CODES,
  RISK_LEVEL_SCORE,
} from "./definitions";
import {
  type ToolRegistry,
  getGlobalRegistry,
  byNames,
  enabledByDefault,
  readOnly,
  writeTools,
  createToolRegistry,
} from "./registry";

export type ApprovalPolicy = "always" | "safe";
export type ToolName = string;

export interface ToolContext {
  workspaceRoot: string;
}

// ============================================================================
// Tool Definitions (metadata for governance)
// ============================================================================

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "read",
    description: "Read file contents with line numbers. Supports text files, images, and PDFs.",
    inputSchema: {} as any,
    isReadOnly: true,
    isConcurrencySafe: true,
    riskLevel: "low",
    idempotencyPolicy: "safe",
    enabledByDefault: true,
    errorCodes: [
      TOOL_ERROR_CODES.FILE_NOT_FOUND,
      TOOL_ERROR_CODES.PERMISSION_DENIED,
      TOOL_ERROR_CODES.FILE_TOO_LARGE,
      TOOL_ERROR_CODES.INVALID_PATH,
    ],
    auditFields: ["executionId", "invokedAt"],
  },
  {
    name: "bash",
    description: "Execute bash commands. Requires approval due to write side effects.",
    inputSchema: {} as any,
    isReadOnly: false,
    isConcurrencySafe: false,
    riskLevel: "high",
    idempotencyPolicy: "none",
    enabledByDefault: true,
    errorCodes: [
      TOOL_ERROR_CODES.COMMAND_FAILED,
      TOOL_ERROR_CODES.COMMAND_TIMEOUT,
      TOOL_ERROR_CODES.INVALID_COMMAND,
      TOOL_ERROR_CODES.PERMISSION_DENIED,
    ],
    auditFields: ["executionId", "invokedAt", "inputHash"],
  },
  {
    name: "edit",
    description: "Edit a file by replacing a specific string. Safe and idempotent for single edits.",
    inputSchema: {} as any,
    isReadOnly: false,
    isConcurrencySafe: false,
    riskLevel: "medium",
    idempotencyPolicy: "conflict",
    enabledByDefault: true,
    errorCodes: [
      TOOL_ERROR_CODES.FILE_NOT_FOUND,
      TOOL_ERROR_CODES.INVALID_INPUT,
      TOOL_ERROR_CODES.PERMISSION_DENIED,
    ],
    auditFields: ["executionId", "invokedAt", "inputHash"],
  },
  {
    name: "write",
    description: "Write or overwrite a file with given content.",
    inputSchema: {} as any,
    isReadOnly: false,
    isConcurrencySafe: false,
    riskLevel: "medium",
    idempotencyPolicy: "conflict",
    enabledByDefault: true,
    errorCodes: [
      TOOL_ERROR_CODES.FILE_NOT_FOUND,
      TOOL_ERROR_CODES.PERMISSION_DENIED,
      TOOL_ERROR_CODES.INVALID_PATH,
    ],
    auditFields: ["executionId", "invokedAt", "inputHash"],
  },
  {
    name: "ls",
    description: "List directory contents with details (permissions, size, modified date).",
    inputSchema: {} as any,
    isReadOnly: true,
    isConcurrencySafe: true,
    riskLevel: "none",
    idempotencyPolicy: "safe",
    enabledByDefault: true,
    errorCodes: [
      TOOL_ERROR_CODES.DIRECTORY_NOT_FOUND,
      TOOL_ERROR_CODES.PERMISSION_DENIED,
    ],
    auditFields: ["executionId", "invokedAt"],
  },
  {
    name: "grep",
    description: "Search for text patterns in files using regex.",
    inputSchema: {} as any,
    isReadOnly: true,
    isConcurrencySafe: true,
    riskLevel: "none",
    idempotencyPolicy: "safe",
    enabledByDefault: true,
    errorCodes: [
      TOOL_ERROR_CODES.FILE_NOT_FOUND,
      TOOL_ERROR_CODES.INVALID_INPUT,
    ],
    auditFields: ["executionId", "invokedAt"],
  },
  {
    name: "find",
    description: "Find files by name pattern using fast disk search.",
    inputSchema: {} as any,
    isReadOnly: true,
    isConcurrencySafe: true,
    riskLevel: "none",
    idempotencyPolicy: "safe",
    enabledByDefault: true,
    errorCodes: [
      TOOL_ERROR_CODES.DIRECTORY_NOT_FOUND,
      TOOL_ERROR_CODES.INVALID_PATH,
    ],
    auditFields: ["executionId", "invokedAt"],
  },
];

// ============================================================================
// Global Registry Initialization
// ============================================================================

let registryInitialized = false;

function ensureRegistryInitialized(): void {
  if (registryInitialized) return;
  registryInitialized = true;

  const registry = getGlobalRegistry();

  // Register all built-in tools
  const factories: Array<{ name: string; factory: (cwd: string) => AgentTool }> = [
    { name: "read", factory: createReadTool },
    { name: "bash", factory: createBashTool },
    { name: "edit", factory: createEditTool },
    { name: "write", factory: createWriteTool },
    { name: "ls", factory: createLsTool },
    { name: "grep", factory: createGrepTool },
    { name: "find", factory: createFindTool },
  ];

  for (const def of TOOL_DEFINITIONS) {
    const entry = factories.find((f) => f.name === def.name);
    if (entry) {
      registry.register({ definition: def, factory: entry.factory });
    }
  }
}

// ============================================================================
// Tool Lookup Helpers (backward compatible)
// ============================================================================

/**
 * Check if a tool requires user approval before execution.
 * Uses registry: tools with riskLevel >= medium require approval.
 */
export function requiresApproval(toolName: ToolName): boolean {
  ensureRegistryInitialized();
  const registry = getGlobalRegistry();
  const def = registry.get(toolName);
  if (!def) return false;
  return RISK_LEVEL_SCORE[def.riskLevel] >= RISK_LEVEL_SCORE["medium"];
}

/**
 * Check if a tool name is a known built-in tool.
 */
export function isBuiltInTool(toolName: string): boolean {
  ensureRegistryInitialized();
  return getGlobalRegistry().has(toolName);
}

/**
 * Get tool definition by name.
 */
export function getToolDefinition(name: string): ToolDefinition | undefined {
  ensureRegistryInitialized();
  return getGlobalRegistry().get(name);
}

/**
 * Get the global tool registry.
 */
export function getRegistry(): ToolRegistry {
  ensureRegistryInitialized();
  return getGlobalRegistry();
}

// ============================================================================
// Tool Creation (backward compatible)
// ============================================================================

/**
 * Create all coding tools configured for a specific working directory.
 * Returns a Record mapping tool names to AgentTool instances.
 */
export function createAllTools(cwd: string): Record<string, AgentTool> {
  ensureRegistryInitialized();
  return getGlobalRegistry().createMap(cwd, enabledByDefault());
}

/**
 * Create all tools as an array for direct use with Agent.setTools().
 */
export function createToolArray(cwd: string): AgentTool[] {
  ensureRegistryInitialized();
  return getGlobalRegistry().createAll(cwd, enabledByDefault());
}

/**
 * Create tools matching specific criteria.
 */
export function createFilteredTools(cwd: string, filter: (def: ToolDefinition) => boolean): Record<string, AgentTool> {
  ensureRegistryInitialized();
  return getGlobalRegistry().createMap(cwd, filter);
}

/**
 * Create only safe (read-only) tools.
 */
export function createSafeTools(cwd: string): Record<string, AgentTool> {
  return createFilteredTools(cwd, readOnly());
}

/**
 * Create only write tools (always require approval).
 */
export function createWriteToolsOnly(cwd: string): Record<string, AgentTool> {
  return createFilteredTools(cwd, writeTools());
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
