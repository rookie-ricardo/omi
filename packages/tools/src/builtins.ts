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
import { createReadTool, readSchema } from "./read";
import { createBashTool, bashSchema } from "./bash";
import { createEditTool, editSchema } from "./edit";
import { createWriteTool, writeSchema } from "./write";
import { createLsTool, lsSchema } from "./ls";
import { createGrepTool, grepSchema } from "./grep";
import { createFindTool, findSchema } from "./find";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BuiltInToolFactory = (cwd: string) => OmiTool<any>;

const READ_AUDIT_FIELDS: ToolDefinition["auditFields"] = ["executionId", "invokedAt", "inputHash"];
const WRITE_AUDIT_FIELDS: ToolDefinition["auditFields"] = ["executionId", "invokedAt", "inputHash", "retryCount"];

function renameTool<T extends OmiTool>(tool: T, name: string): T {
  return {
    ...tool,
    name,
    label: name,
  } as T;
}

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
    auditFields: options.auditFields ?? [...READ_AUDIT_FIELDS],
  };
}

const toolSearchSchema = Type.Object({
  query: Type.String({ description: "Search query for tool name or description" }),
});

interface ToolSearchInput {
  query: string;
}

function createToolSearchTool(): OmiTool {
  return {
    name: "tool.search",
    label: "tool.search",
    description: "Search available built-in tools by name or description.",
    parameters: toolSearchSchema,
    execute: async (_toolCallId: string, params: unknown) => {
      const { query } = params as ToolSearchInput;
      const matches = findTools(query);
      const text = matches.length > 0
        ? matches.map((definition) => `- ${definition.name}: ${definition.description}`).join("\n")
        : "No tools matched";

      return {
        content: [{ type: "text" as const, text }],
        details: { query, matches },
      };
    },
  };
}

interface BuiltInEntry {
  definition: ToolDefinition;
  factory: BuiltInToolFactory;
}

const ENTRIES: BuiltInEntry[] = [
  {
    definition: defineTool(
      "read",
      "Read the contents of a file.",
      readSchema,
      {
        isReadOnly: true,
        isConcurrencySafe: true,
        riskLevel: "none",
        idempotencyPolicy: "safe",
        errorCodes: [
          TOOL_ERROR_CODES.FILE_NOT_FOUND,
          TOOL_ERROR_CODES.DIRECTORY_NOT_FOUND,
          TOOL_ERROR_CODES.INVALID_PATH,
          TOOL_ERROR_CODES.PERMISSION_DENIED,
          TOOL_ERROR_CODES.FILE_TOO_LARGE,
        ],
      },
    ),
    factory: (cwd) => createReadTool(cwd),
  },
  {
    definition: defineTool(
      "ls",
      "List files and directories.",
      lsSchema,
      {
        isReadOnly: true,
        isConcurrencySafe: true,
        riskLevel: "none",
        idempotencyPolicy: "safe",
        errorCodes: [
          TOOL_ERROR_CODES.DIRECTORY_NOT_FOUND,
          TOOL_ERROR_CODES.INVALID_PATH,
        ],
      },
    ),
    factory: (cwd) => createLsTool(cwd),
  },
  {
    definition: defineTool(
      "grep",
      "Search file contents for a pattern.",
      grepSchema,
      {
        isReadOnly: true,
        isConcurrencySafe: true,
        riskLevel: "low",
        idempotencyPolicy: "safe",
        errorCodes: [
          TOOL_ERROR_CODES.SEARCH_ERROR,
          TOOL_ERROR_CODES.FILE_NOT_FOUND,
          TOOL_ERROR_CODES.INVALID_INPUT,
          TOOL_ERROR_CODES.PERMISSION_DENIED,
          TOOL_ERROR_CODES.OUTPUT_TRUNCATED,
        ],
      },
    ),
    factory: (cwd) => createGrepTool(cwd),
  },
  {
    definition: defineTool(
      "glob",
      "Search for files by glob pattern.",
      findSchema,
      {
        isReadOnly: true,
        isConcurrencySafe: true,
        riskLevel: "none",
        idempotencyPolicy: "safe",
        errorCodes: [
          TOOL_ERROR_CODES.SEARCH_ERROR,
          TOOL_ERROR_CODES.FILE_NOT_FOUND,
          TOOL_ERROR_CODES.INVALID_INPUT,
          TOOL_ERROR_CODES.OUTPUT_TRUNCATED,
        ],
      },
    ),
    factory: (cwd) => renameTool(createFindTool(cwd), "glob"),
  },
  {
    definition: defineTool(
      "bash",
      "Execute a shell command in the working directory.",
      bashSchema,
      {
        isReadOnly: false,
        isConcurrencySafe: false,
        riskLevel: "high",
        idempotencyPolicy: "none",
        errorCodes: [
          TOOL_ERROR_CODES.COMMAND_FAILED,
          TOOL_ERROR_CODES.COMMAND_TIMEOUT,
          TOOL_ERROR_CODES.PROCESS_KILLED,
          TOOL_ERROR_CODES.INVALID_COMMAND,
          TOOL_ERROR_CODES.PERMISSION_DENIED,
        ],
        auditFields: [...WRITE_AUDIT_FIELDS],
      },
    ),
    factory: (cwd) => createBashTool(cwd),
  },
  {
    definition: defineTool(
      "edit",
      "Edit a file by replacing exact text.",
      editSchema,
      {
        isReadOnly: false,
        isConcurrencySafe: false,
        riskLevel: "high",
        idempotencyPolicy: "conflict",
        errorCodes: [
          TOOL_ERROR_CODES.FILE_NOT_FOUND,
          TOOL_ERROR_CODES.INVALID_PATH,
          TOOL_ERROR_CODES.PERMISSION_DENIED,
          TOOL_ERROR_CODES.INVALID_INPUT,
        ],
        auditFields: [...WRITE_AUDIT_FIELDS],
      },
    ),
    factory: (cwd) => createEditTool(cwd),
  },
  {
    definition: defineTool(
      "notebook_edit",
      "Edit notebook or JSON-like content with explicit notebook tool name.",
      editSchema,
      {
        isReadOnly: false,
        isConcurrencySafe: false,
        riskLevel: "high",
        idempotencyPolicy: "conflict",
        errorCodes: [
          TOOL_ERROR_CODES.FILE_NOT_FOUND,
          TOOL_ERROR_CODES.INVALID_PATH,
          TOOL_ERROR_CODES.PERMISSION_DENIED,
          TOOL_ERROR_CODES.INVALID_INPUT,
        ],
        auditFields: [...WRITE_AUDIT_FIELDS],
      },
    ),
    factory: (cwd) => renameTool(createEditTool(cwd), "notebook_edit"),
  },
  {
    definition: defineTool(
      "write",
      "Write content to a file.",
      writeSchema,
      {
        isReadOnly: false,
        isConcurrencySafe: false,
        riskLevel: "high",
        idempotencyPolicy: "conflict",
        errorCodes: [
          TOOL_ERROR_CODES.FILE_ALREADY_EXISTS,
          TOOL_ERROR_CODES.INVALID_PATH,
          TOOL_ERROR_CODES.PERMISSION_DENIED,
          TOOL_ERROR_CODES.DIRECTORY_NOT_FOUND,
        ],
        auditFields: [...WRITE_AUDIT_FIELDS],
      },
    ),
    factory: (cwd) => createWriteTool(cwd),
  },
  {
    definition: defineTool(
      "tool.search",
      "Search available built-in tools.",
      toolSearchSchema,
      {
        isReadOnly: true,
        isConcurrencySafe: true,
        riskLevel: "none",
        idempotencyPolicy: "safe",
        errorCodes: [TOOL_ERROR_CODES.INVALID_INPUT],
      },
    ),
    factory: () => createToolSearchTool(),
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
