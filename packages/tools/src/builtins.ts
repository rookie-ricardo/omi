import type { OmiTool } from "@omi/core";
import { Type } from "@mariozechner/pi-ai";

import {
  type ToolDefinition,
  type ToolErrorCode,
  type ToolIdempotencyPolicy,
  type ToolRiskLevel,
  TOOL_ERROR_CODES,
} from "./definitions";
import {
  createToolRegistry,
  setGlobalRegistry,
  type ToolRegistry,
} from "./registry";
import { createSkillTool, skillSchema } from "./pi-skill";
import { createSubagentTool, subagentSchema } from "./pi-subagent";

export type BuiltInToolFactory = (cwd: string) => OmiTool<any>;

function defineTool(
  name: string,
  description: string,
  schema: ToolDefinition["schema"],
  options: {
    isReadOnly: boolean;
    isConcurrencySafe: boolean;
    riskLevel: ToolRiskLevel;
    idempotencyPolicy: ToolIdempotencyPolicy;
    enabledByDefault?: boolean;
    errorCodes: ToolErrorCode[];
    auditFields?: ToolDefinition["auditFields"];
  },
): ToolDefinition {
  return {
    name,
    description,
    schema,
    isReadOnly: options.isReadOnly,
    isConcurrencySafe: options.isConcurrencySafe,
    riskLevel: options.riskLevel,
    idempotencyPolicy: options.idempotencyPolicy,
    enabledByDefault: options.enabledByDefault ?? true,
    errorCodes: options.errorCodes,
    auditFields: options.auditFields ?? ["executionId", "invokedAt", "inputHash"],
  };
}

interface BuiltInEntry {
  definition: ToolDefinition;
  factory: BuiltInToolFactory;
}

/**
 * OMI-specific tools only. Standard coding tools (Read, Write, Edit, Bash,
 * Grep, Glob, LS, NotebookEdit) are provided by the SDK's claude_code preset.
 */
const ENTRIES: BuiltInEntry[] = [
  {
    definition: defineTool(
      "skill",
      "Execute a skill within the main conversation.",
      skillSchema,
      {
        isReadOnly: true,
        isConcurrencySafe: true,
        riskLevel: "low",
        idempotencyPolicy: "safe",
        errorCodes: [TOOL_ERROR_CODES.INVALID_INPUT],
      },
    ),
    factory: () => createSkillTool(),
  },
  {
    definition: defineTool(
      "subagent",
      "Delegate tasks to specialized subagents with isolated context.",
      subagentSchema,
      {
        isReadOnly: true,
        isConcurrencySafe: true,
        riskLevel: "low",
        idempotencyPolicy: "safe",
        errorCodes: [TOOL_ERROR_CODES.INVALID_INPUT],
      },
    ),
    factory: () => createSubagentTool(),
  },
];

let builtInRegistry: ToolRegistry | null = null;

function registerEntries(registry: ToolRegistry): void {
  for (const entry of ENTRIES) {
    registry.register(entry);
  }
}

export function getBuiltInToolRegistry(): ToolRegistry {
  if (!builtInRegistry) {
    const registry = createToolRegistry();
    registerEntries(registry);
    setGlobalRegistry(registry);
    builtInRegistry = registry;
  }
  return builtInRegistry;
}

export function createBuiltInToolRegistry(): ToolRegistry {
  return getBuiltInToolRegistry();
}

export function getBuiltInToolDefinitions(): ToolDefinition[] {
  return getBuiltInToolRegistry().listAll();
}

export function getBuiltInToolDefinition(name: string): ToolDefinition | undefined {
  return getBuiltInToolRegistry().get(name);
}

export function isBuiltInTool(name: string): boolean {
  return getBuiltInToolRegistry().has(name);
}

export function findTools(query: string): ToolDefinition[] {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) {
    return [];
  }

  return getBuiltInToolDefinitions().filter((definition) =>
    definition.name.toLowerCase().includes(normalized)
      || definition.description.toLowerCase().includes(normalized),
  );
}

export function createBuiltInToolMap(cwd: string): Record<string, OmiTool> {
  return getBuiltInToolRegistry().createMap(cwd);
}
