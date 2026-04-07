import type { AgentTool } from "@mariozechner/pi-agent-core";
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
import { createEnterPlanTool, enterPlanSchema } from "./enter-plan/index";
import { createExitPlanTool, exitPlanSchema } from "./exit-plan/index";
import {
  createMcpResourceListTool,
  createMcpResourceReadTool,
  mcpResourceListSchema,
  mcpResourceReadSchema,
} from "./mcp-resource-tools";
import {
  createMcpPromptListTool,
  createMcpPromptEvalTool,
  mcpPromptListSchema,
  mcpPromptEvalSchema,
} from "./mcp-prompt-tools";
import {
  createSubagentSpawnTool,
  createSubagentSendTool,
  createSubagentWaitTool,
  createSubagentCloseTool,
  createSubagentListTool,
  createSubagentGetTool,
  createSubagentDelegateTool,
  subagentSpawnSchema,
  subagentSendSchema,
  subagentWaitSchema,
  subagentCloseSchema,
  subagentListSchema,
  subagentGetSchema,
  subagentDelegateSchema,
} from "./subagent";
import {
  createTaskCreateTool,
  createTaskUpdateTool,
  createTaskGetTool,
  createTaskListTool,
  createTaskStopTool,
  createTaskOutputTool,
  taskCreateSchema,
  taskUpdateSchema,
  taskGetSchema,
  taskListSchema,
  taskStopSchema,
  taskOutputSchema,
} from "./task-tools";
import {
  createWebFetchTool,
  createWebSearchTool,
  createAskUserTool,
  webFetchSchema,
  webSearchSchema,
  askUserSchema,
} from "./web-tools";
import { getMcpRegistryRuntime, getSubAgentClientRuntime, getSearchSkillsRuntime } from "./runtime";
import {
  createTodoWriteTool,
  createTodoReadTool,
  todoWriteSchema,
  todoReadSchema,
} from "./todo-tools";
import {
  createConfigReadTool,
  createConfigWriteTool,
  configReadSchema,
  configWriteSchema,
} from "./config-tools";
import {
  createDiscoverSkillsTool,
  discoverSkillsToolSchema,
} from "./skill-tools";
import {
  createBashBackgroundTool,
  createMonitorTool,
  bashBackgroundSchema,
  monitorSchema,
} from "./monitor-tools";
import {
  createTeamCreateTool,
  createTeamDeleteTool,
  teamCreateSchema,
  teamDeleteSchema,
} from "./team-tools";
import {
  createWebBrowserTool,
  browserSchema,
} from "./browser-tools";

// ============================================================================
// Tool Search
// ============================================================================

export const toolSearchSchema = Type.Object({
  query: Type.String({ description: "Search query for tool name or description" }),
});

export interface ToolSearchInput {
  query: string;
}

function createToolSearchTool(): AgentTool {
  return {
    name: "tool.search",
    label: "tool.search",
    description: "Search registered tools by name or description.",
    parameters: toolSearchSchema,
    execute: async (_toolCallId: string, params: unknown) => {
      const { query } = params as ToolSearchInput;
      const matches = findTools(query);

      const text = matches.length
        ? matches.map((definition) => `- ${definition.name}: ${definition.description}`).join("\n")
        : "No tools matched";

      return {
        content: [{ type: "text" as const, text }],
        details: { query, matches },
      };
    },
  };
}

// ============================================================================
// Shared Helpers
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BuiltInToolFactory = (cwd: string) => AgentTool<any>;

const READ_AUDIT_FIELDS: ToolDefinition["auditFields"] = ["executionId", "invokedAt", "inputHash"];
const WRITE_AUDIT_FIELDS: ToolDefinition["auditFields"] = ["executionId", "invokedAt", "inputHash", "retryCount"];
const CACHED_AUDIT_FIELDS: ToolDefinition["auditFields"] = ["executionId", "invokedAt", "inputHash", "cached"];

function renameTool<T extends AgentTool>(tool: T, name: string): T {
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
      "bash",
      "Execute a bash command in the working directory.",
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
      "Edit notebook or JSON-like content with an explicit notebook tool name.",
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
      "plan.enter",
      "Enter plan mode.",
      enterPlanSchema,
      {
        isReadOnly: false,
        isConcurrencySafe: false,
        riskLevel: "medium",
        idempotencyPolicy: "conflict",
        errorCodes: [
          TOOL_ERROR_CODES.PLAN_NOT_ACTIVE,
          TOOL_ERROR_CODES.INVALID_INPUT,
        ],
        auditFields: [...WRITE_AUDIT_FIELDS],
      },
    ),
    factory: () => renameTool(createEnterPlanTool(""), "plan.enter"),
  },
  {
    definition: defineTool(
      "plan.exit",
      "Exit plan mode.",
      exitPlanSchema,
      {
        isReadOnly: false,
        isConcurrencySafe: false,
        riskLevel: "medium",
        idempotencyPolicy: "conflict",
        errorCodes: [
          TOOL_ERROR_CODES.PLAN_NOT_ACTIVE,
          TOOL_ERROR_CODES.INVALID_INPUT,
        ],
        auditFields: [...WRITE_AUDIT_FIELDS],
      },
    ),
    factory: () => renameTool(createExitPlanTool(""), "plan.exit"),
  },
  {
    definition: defineTool(
      "mcp.resource.list",
      "List available MCP resources.",
      mcpResourceListSchema,
      {
        isReadOnly: true,
        isConcurrencySafe: true,
        riskLevel: "low",
        idempotencyPolicy: "safe",
        errorCodes: [
          TOOL_ERROR_CODES.MCP_ERROR,
          TOOL_ERROR_CODES.INVALID_INPUT,
        ],
      },
    ),
    factory: () => renameTool(
      createMcpResourceListTool({ registry: getMcpRegistryRuntime() ?? createUnavailableMcpRegistry() }),
      "mcp.resource.list"
    ),
  },
  {
    definition: defineTool(
      "mcp.resource.read",
      "Read a single MCP resource by URI.",
      mcpResourceReadSchema,
      {
        isReadOnly: true,
        isConcurrencySafe: true,
        riskLevel: "low",
        idempotencyPolicy: "safe",
        errorCodes: [
          TOOL_ERROR_CODES.MCP_ERROR,
          TOOL_ERROR_CODES.INVALID_INPUT,
        ],
      },
    ),
    factory: () => renameTool(
      createMcpResourceReadTool({ registry: getMcpRegistryRuntime() ?? createUnavailableMcpRegistry() }),
      "mcp.resource.read"
    ),
  },
  {
    definition: defineTool(
      "mcp.prompt.list",
      "List available MCP prompts.",
      mcpPromptListSchema,
      {
        isReadOnly: true,
        isConcurrencySafe: true,
        riskLevel: "low",
        idempotencyPolicy: "safe",
        errorCodes: [
          TOOL_ERROR_CODES.MCP_ERROR,
          TOOL_ERROR_CODES.INVALID_INPUT,
        ],
      },
    ),
    factory: () => renameTool(
      createMcpPromptListTool({ registry: getMcpRegistryRuntime() ?? createUnavailableMcpRegistry() }),
      "mcp.prompt.list"
    ),
  },
  {
    definition: defineTool(
      "mcp.prompt.eval",
      "Evaluate a single MCP prompt.",
      mcpPromptEvalSchema,
      {
        isReadOnly: true,
        isConcurrencySafe: true,
        riskLevel: "low",
        idempotencyPolicy: "safe",
        errorCodes: [
          TOOL_ERROR_CODES.MCP_ERROR,
          TOOL_ERROR_CODES.INVALID_INPUT,
        ],
      },
    ),
    factory: () => renameTool(
      createMcpPromptEvalTool({ registry: getMcpRegistryRuntime() ?? createUnavailableMcpRegistry() }),
      "mcp.prompt.eval"
    ),
  },
  {
    definition: defineTool(
      "subagent.spawn",
      "Spawn a subagent to execute a task in parallel.",
      subagentSpawnSchema,
      {
        isReadOnly: false,
        isConcurrencySafe: false,
        riskLevel: "high",
        idempotencyPolicy: "conflict",
        errorCodes: [
          TOOL_ERROR_CODES.TASK_FAILED,
          TOOL_ERROR_CODES.INVALID_INPUT,
          TOOL_ERROR_CODES.PERMISSION_DENIED,
        ],
        auditFields: [...WRITE_AUDIT_FIELDS],
      },
    ),
    factory: () => renameTool(createSubagentSpawnTool(() => getSubAgentClientRuntime()), "subagent.spawn"),
  },
  {
    definition: defineTool(
      "subagent.send",
      "Send a message to a running subagent.",
      subagentSendSchema,
      {
        isReadOnly: false,
        isConcurrencySafe: false,
        riskLevel: "high",
        idempotencyPolicy: "conflict",
        errorCodes: [
          TOOL_ERROR_CODES.TASK_FAILED,
          TOOL_ERROR_CODES.INVALID_INPUT,
          TOOL_ERROR_CODES.PERMISSION_DENIED,
        ],
        auditFields: [...WRITE_AUDIT_FIELDS],
      },
    ),
    factory: () => renameTool(createSubagentSendTool(() => getSubAgentClientRuntime()), "subagent.send"),
  },
  {
    definition: defineTool(
      "subagent.wait",
      "Wait for a subagent to complete.",
      subagentWaitSchema,
      {
        isReadOnly: true,
        isConcurrencySafe: true,
        riskLevel: "low",
        idempotencyPolicy: "safe",
        errorCodes: [
          TOOL_ERROR_CODES.TASK_FAILED,
          TOOL_ERROR_CODES.INVALID_INPUT,
        ],
      },
    ),
    factory: () => renameTool(createSubagentWaitTool(() => getSubAgentClientRuntime()), "subagent.wait"),
  },
  {
    definition: defineTool(
      "subagent.close",
      "Close a subagent.",
      subagentCloseSchema,
      {
        isReadOnly: false,
        isConcurrencySafe: false,
        riskLevel: "high",
        idempotencyPolicy: "conflict",
        errorCodes: [
          TOOL_ERROR_CODES.TASK_FAILED,
          TOOL_ERROR_CODES.INVALID_INPUT,
          TOOL_ERROR_CODES.PERMISSION_DENIED,
        ],
        auditFields: [...WRITE_AUDIT_FIELDS],
      },
    ),
    factory: () => renameTool(createSubagentCloseTool(() => getSubAgentClientRuntime()), "subagent.close"),
  },
  {
    definition: defineTool(
      "subagent.list",
      "List spawned subagents.",
      subagentListSchema,
      {
        isReadOnly: true,
        isConcurrencySafe: true,
        riskLevel: "low",
        idempotencyPolicy: "safe",
        errorCodes: [
          TOOL_ERROR_CODES.TASK_FAILED,
          TOOL_ERROR_CODES.INVALID_INPUT,
        ],
      },
    ),
    factory: () => renameTool(createSubagentListTool(() => getSubAgentClientRuntime()), "subagent.list"),
  },
  {
    definition: defineTool(
      "subagent.get",
      "Get subagent details by id.",
      subagentGetSchema,
      {
        isReadOnly: true,
        isConcurrencySafe: true,
        riskLevel: "low",
        idempotencyPolicy: "safe",
        errorCodes: [
          TOOL_ERROR_CODES.TASK_FAILED,
          TOOL_ERROR_CODES.INVALID_INPUT,
        ],
      },
    ),
    factory: () => renameTool(createSubagentGetTool(() => getSubAgentClientRuntime()), "subagent.get"),
  },
  {
    definition: defineTool(
      "subagent.delegate",
      "Delegate a task to a subagent.",
      subagentDelegateSchema,
      {
        isReadOnly: false,
        isConcurrencySafe: false,
        riskLevel: "high",
        idempotencyPolicy: "conflict",
        errorCodes: [
          TOOL_ERROR_CODES.TASK_FAILED,
          TOOL_ERROR_CODES.INVALID_INPUT,
          TOOL_ERROR_CODES.PERMISSION_DENIED,
        ],
        auditFields: [...WRITE_AUDIT_FIELDS],
      },
    ),
    factory: () => renameTool(createSubagentDelegateTool(() => getSubAgentClientRuntime()), "subagent.delegate"),
  },
  {
    definition: defineTool(
      "task.create",
      "Create a task record.",
      taskCreateSchema,
      {
        isReadOnly: false,
        isConcurrencySafe: false,
        riskLevel: "medium",
        idempotencyPolicy: "conflict",
        errorCodes: [
          TOOL_ERROR_CODES.TASK_NOT_FOUND,
          TOOL_ERROR_CODES.INVALID_INPUT,
          TOOL_ERROR_CODES.PERMISSION_DENIED,
        ],
        auditFields: [...WRITE_AUDIT_FIELDS],
      },
    ),
    factory: () => createTaskCreateTool(),
  },
  {
    definition: defineTool(
      "task.update",
      "Update a task record.",
      taskUpdateSchema,
      {
        isReadOnly: false,
        isConcurrencySafe: false,
        riskLevel: "medium",
        idempotencyPolicy: "conflict",
        errorCodes: [
          TOOL_ERROR_CODES.TASK_NOT_FOUND,
          TOOL_ERROR_CODES.INVALID_INPUT,
          TOOL_ERROR_CODES.PERMISSION_DENIED,
        ],
        auditFields: [...WRITE_AUDIT_FIELDS],
      },
    ),
    factory: () => createTaskUpdateTool(),
  },
  {
    definition: defineTool(
      "task.get",
      "Get a task record by ID.",
      taskGetSchema,
      {
        isReadOnly: true,
        isConcurrencySafe: true,
        riskLevel: "none",
        idempotencyPolicy: "safe",
        errorCodes: [
          TOOL_ERROR_CODES.TASK_NOT_FOUND,
          TOOL_ERROR_CODES.INVALID_INPUT,
        ],
      },
    ),
    factory: () => createTaskGetTool(),
  },
  {
    definition: defineTool(
      "task.list",
      "List task records.",
      taskListSchema,
      {
        isReadOnly: true,
        isConcurrencySafe: true,
        riskLevel: "none",
        idempotencyPolicy: "safe",
        errorCodes: [
          TOOL_ERROR_CODES.TASK_NOT_FOUND,
          TOOL_ERROR_CODES.INVALID_INPUT,
        ],
      },
    ),
    factory: () => createTaskListTool(),
  },
  {
    definition: defineTool(
      "task.stop",
      "Stop a task record.",
      taskStopSchema,
      {
        isReadOnly: false,
        isConcurrencySafe: false,
        riskLevel: "medium",
        idempotencyPolicy: "conflict",
        errorCodes: [
          TOOL_ERROR_CODES.TASK_NOT_FOUND,
          TOOL_ERROR_CODES.INVALID_INPUT,
          TOOL_ERROR_CODES.PERMISSION_DENIED,
        ],
        auditFields: [...WRITE_AUDIT_FIELDS],
      },
    ),
    factory: () => createTaskStopTool(),
  },
  {
    definition: defineTool(
      "task.output",
      "Attach output to a task record.",
      taskOutputSchema,
      {
        isReadOnly: false,
        isConcurrencySafe: false,
        riskLevel: "medium",
        idempotencyPolicy: "conflict",
        errorCodes: [
          TOOL_ERROR_CODES.TASK_NOT_FOUND,
          TOOL_ERROR_CODES.INVALID_INPUT,
          TOOL_ERROR_CODES.PERMISSION_DENIED,
        ],
        auditFields: [...WRITE_AUDIT_FIELDS],
      },
    ),
    factory: () => createTaskOutputTool(),
  },
  {
    definition: defineTool(
      "web.fetch",
      "Fetch a web page and return its text content.",
      webFetchSchema,
      {
        isReadOnly: true,
        isConcurrencySafe: true,
        riskLevel: "medium",
        idempotencyPolicy: "safe",
        errorCodes: [
          TOOL_ERROR_CODES.NETWORK_ERROR,
          TOOL_ERROR_CODES.INVALID_INPUT,
          TOOL_ERROR_CODES.OUTPUT_TRUNCATED,
        ],
        auditFields: [...CACHED_AUDIT_FIELDS],
      },
    ),
    factory: () => createWebFetchTool(),
  },
  {
    definition: defineTool(
      "web.search",
      "Search the web and return top results.",
      webSearchSchema,
      {
        isReadOnly: true,
        isConcurrencySafe: true,
        riskLevel: "medium",
        idempotencyPolicy: "safe",
        errorCodes: [
          TOOL_ERROR_CODES.NETWORK_ERROR,
          TOOL_ERROR_CODES.INVALID_INPUT,
          TOOL_ERROR_CODES.SEARCH_ERROR,
        ],
        auditFields: [...CACHED_AUDIT_FIELDS],
      },
    ),
    factory: () => createWebSearchTool(),
  },
  {
    definition: defineTool(
      "tool.search",
      "Search registered tools by name or description.",
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
  {
    definition: defineTool(
      "ask_user",
      "Ask the user a clarifying question.",
      askUserSchema,
      {
        isReadOnly: true,
        isConcurrencySafe: true,
        riskLevel: "low",
        idempotencyPolicy: "safe",
        errorCodes: [TOOL_ERROR_CODES.INVALID_INPUT],
      },
    ),
    factory: () => createAskUserTool(),
  },
  {
    definition: defineTool(
      "todo.write",
      "Write/replace the TODO list to track work items, their status, and priority.",
      todoWriteSchema,
      {
        isReadOnly: false,
        isConcurrencySafe: false,
        riskLevel: "low",
        idempotencyPolicy: "conflict",
        errorCodes: [TOOL_ERROR_CODES.INVALID_INPUT],
        auditFields: [...WRITE_AUDIT_FIELDS],
      },
    ),
    factory: () => createTodoWriteTool(),
  },
  {
    definition: defineTool(
      "todo.read",
      "Read the current TODO list.",
      todoReadSchema,
      {
        isReadOnly: true,
        isConcurrencySafe: true,
        riskLevel: "none",
        idempotencyPolicy: "safe",
        errorCodes: [TOOL_ERROR_CODES.INVALID_INPUT],
      },
    ),
    factory: () => createTodoReadTool(),
  },
  {
    definition: defineTool(
      "config.read",
      "Read runtime configuration settings.",
      configReadSchema,
      {
        isReadOnly: true,
        isConcurrencySafe: true,
        riskLevel: "none",
        idempotencyPolicy: "safe",
        errorCodes: [TOOL_ERROR_CODES.INVALID_INPUT],
      },
    ),
    factory: () => createConfigReadTool(),
  },
  {
    definition: defineTool(
      "config.write",
      "Set a runtime configuration value.",
      configWriteSchema,
      {
        isReadOnly: false,
        isConcurrencySafe: false,
        riskLevel: "medium",
        idempotencyPolicy: "conflict",
        errorCodes: [TOOL_ERROR_CODES.INVALID_INPUT],
        auditFields: [...WRITE_AUDIT_FIELDS],
      },
    ),
    factory: () => createConfigWriteTool(),
  },
  {
    definition: defineTool(
      "discover_skills",
      "Search for available built-in skills, bundled prompts, and MCP-injected skills.",
      discoverSkillsToolSchema,
      {
        isReadOnly: true,
        isConcurrencySafe: true,
        riskLevel: "none",
        idempotencyPolicy: "safe",
        errorCodes: [TOOL_ERROR_CODES.INVALID_INPUT],
      },
    ),
    factory: (cwd) => createDiscoverSkillsTool({
      workspaceRootFactory: () => cwd,
      searchSkills: async (workspaceRoot, query) => {
        const fn = getSearchSkillsRuntime();
        if (!fn) {
          throw new Error("Search skills runtime is unavailable.");
        }
        return fn(workspaceRoot, query);
      }
    }),
  },
  {
    definition: defineTool(
      "bash_background",
      "Execute a bash command in the background. Returns a jobId that can be used with the monitor tool.",
      bashBackgroundSchema,
      {
        isReadOnly: false,
        isConcurrencySafe: false,
        riskLevel: "high",
        idempotencyPolicy: "none",
        errorCodes: [
          TOOL_ERROR_CODES.COMMAND_FAILED,
          TOOL_ERROR_CODES.INVALID_COMMAND,
          TOOL_ERROR_CODES.PERMISSION_DENIED,
        ],
        auditFields: [...WRITE_AUDIT_FIELDS],
      },
    ),
    factory: (cwd) => createBashBackgroundTool(cwd),
  },
  {
    definition: defineTool(
      "monitor",
      "Monitor the status and fetch the latest output (tail) of a background job.",
      monitorSchema,
      {
        isReadOnly: true,
        isConcurrencySafe: true,
        riskLevel: "low",
        idempotencyPolicy: "safe",
        errorCodes: [TOOL_ERROR_CODES.INVALID_INPUT],
        auditFields: [...READ_AUDIT_FIELDS],
      },
    ),
    factory: () => createMonitorTool(),
  },
  {
    definition: defineTool(
      "team.create",
      "Create a Multi-Agent Swarm team by spawning multiple parallel subagents and recording the context.",
      teamCreateSchema,
      {
        isReadOnly: false,
        isConcurrencySafe: false,
        riskLevel: "medium",
        idempotencyPolicy: "conflict",
        errorCodes: [TOOL_ERROR_CODES.TASK_FAILED, TOOL_ERROR_CODES.INVALID_INPUT],
        auditFields: [...WRITE_AUDIT_FIELDS],
      },
    ),
    factory: (cwd) => createTeamCreateTool(cwd, () => getSubAgentClientRuntime()),
  },
  {
    definition: defineTool(
      "team.delete",
      "Delete a Multi-Agent Swarm team, gracefully closing all its bound subagents.",
      teamDeleteSchema,
      {
        isReadOnly: false,
        isConcurrencySafe: false,
        riskLevel: "medium",
        idempotencyPolicy: "conflict",
        errorCodes: [TOOL_ERROR_CODES.TASK_FAILED, TOOL_ERROR_CODES.INVALID_INPUT],
        auditFields: [...WRITE_AUDIT_FIELDS],
      },
    ),
    factory: (cwd) => createTeamDeleteTool(cwd, () => getSubAgentClientRuntime()),
  },
  {
    definition: defineTool(
      "web.browser",
      "Launch a headless browser (Playwright) to navigate to a URL and perform an action.",
      browserSchema,
      {
        isReadOnly: false,
        isConcurrencySafe: false,
        riskLevel: "medium",
        idempotencyPolicy: "conflict",
        errorCodes: [TOOL_ERROR_CODES.NETWORK_ERROR, TOOL_ERROR_CODES.INVALID_INPUT],
        auditFields: [...WRITE_AUDIT_FIELDS],
      },
    ),
    factory: (cwd) => createWebBrowserTool(cwd),
  },
];

function createUnavailableMcpRegistry() {
  const missingError = () => {
    throw new Error("MCP registry runtime is not configured");
  };

  return {
    getResources: missingError,
    getAllResources: missingError,
    getServer: missingError,
    readResourceByUri: async (_uri: string) => missingError(),
  } as never;
}

// ============================================================================
// Registry Initialization
// ============================================================================

let builtInRegistry: ToolRegistry | null = null;

export function getBuiltInToolRegistry(): ToolRegistry {
  if (!builtInRegistry) {
    const registry = createToolRegistry();
    for (const entry of ENTRIES) {
      registry.register(entry);
    }
    builtInRegistry = registry;
    setGlobalRegistry(registry);
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
  if (!normalized) {
    return [];
  }

  return getBuiltInToolDefinitions().filter((definition) => {
    return (
      definition.name.toLowerCase().includes(normalized) ||
      definition.description.toLowerCase().includes(normalized)
    );
  });
}

export function createBuiltInToolMap(cwd: string): Record<string, AgentTool> {
  return getBuiltInToolRegistry().createMap(cwd);
}
