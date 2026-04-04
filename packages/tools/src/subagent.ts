/**
 * SubAgent Tools - Tools for spawning and managing SubAgents
 *
 * Provides tools for creating sub-agents that can execute tasks
 * in parallel with the main agent. SubAgents share the main
 * workspace by default, with worktree isolation only when
 * explicitly enabled or multi-session is active.
 */

import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { TextContent, Static, TSchema } from "@mariozechner/pi-ai";
import { Type } from "@mariozechner/pi-ai";

// ============================================================================
// Tool Schemas
// ============================================================================

/**
 * Schema for spawning a new SubAgent.
 */
export const subagentSpawnSchema: TSchema = Type.Object({
  name: Type.Optional(Type.String({
    description: "Human-readable name for the subagent (e.g., 'code-reviewer', 'test-writer')",
  })),
  task: Type.String({
    description: "The task description for the subagent to execute. Be specific about what needs to be done.",
  }),
  workspaceRoot: Type.Optional(Type.String({
    description: "Working directory for the subagent. Defaults to the parent's workspace.",
  })),
  isolated: Type.Optional(Type.Boolean({
    description: "Whether to use git worktree for isolation. Default: false (share workspace)",
  })),
  model: Type.Optional(Type.String({
    description: "Model to use for the subagent. If not specified, inherits from parent.",
  })),
  provider: Type.Optional(Type.String({
    description: "Provider to use for the subagent. If not specified, inherits from parent.",
  })),
  allowedTools: Type.Optional(Type.Array(Type.String())),
  blockedTools: Type.Optional(Type.Array(Type.String())),
});

export type SubagentSpawnInput = Static<typeof subagentSpawnSchema>;

/**
 * Schema for sending a message to a SubAgent.
 */
export const subagentSendSchema: TSchema = Type.Object({
  subAgentId: Type.String({
    description: "The ID of the subagent to send the message to",
  }),
  message: Type.String({
    description: "The message content to send to the subagent",
  }),
  topic: Type.Optional(Type.String({
    description: "Message topic (default: 'task/delegate')",
  })),
});

export type SubagentSendInput = Static<typeof subagentSendSchema>;

/**
 * Schema for waiting for a SubAgent to complete.
 */
export const subagentWaitSchema: TSchema = Type.Object({
  subAgentId: Type.String({
    description: "The ID of the subagent to wait for",
  }),
  timeout: Type.Optional(Type.Number({
    description: "Timeout in milliseconds. If the subagent doesn't complete within this time, returns with timeout status. No default timeout.",
  })),
});

export type SubagentWaitInput = Static<typeof subagentWaitSchema>;

/**
 * Schema for closing a SubAgent.
 */
export const subagentCloseSchema: TSchema = Type.Object({
  subAgentId: Type.String({
    description: "The ID of the subagent to close",
  }),
  force: Type.Optional(Type.Boolean({
    description: "Force close without waiting for current task to complete. Default: false",
  })),
});

export type SubagentCloseInput = Static<typeof subagentCloseSchema>;

/**
 * Schema for listing SubAgents.
 */
export const subagentListSchema: TSchema = Type.Object({
  status: Type.Optional(Type.String({
    description: "Filter by status: 'pending', 'running', 'waiting', 'completed', 'failed', 'closed'",
  })),
  parentId: Type.Optional(Type.String({
    description: "Filter by parent agent ID",
  })),
});

export type SubagentListInput = Static<typeof subagentListSchema>;

/**
 * Schema for getting SubAgent details.
 */
export const subagentGetSchema: TSchema = Type.Object({
  subAgentId: Type.String({
    description: "The ID of the subagent to get details for",
  }),
});

export type SubagentGetInput = Static<typeof subagentGetSchema>;

/**
 * Schema for delegating work to a SubAgent (combined spawn and send).
 */
export const subagentDelegateSchema: TSchema = Type.Object({
  name: Type.Optional(Type.String({
    description: "Human-readable name for the subagent",
  })),
  task: Type.String({
    description: "The task description for the subagent to execute",
  }),
  waitForCompletion: Type.Optional(Type.Boolean({
    description: "Whether to wait for the subagent to complete before returning. Default: false",
  })),
  timeout: Type.Optional(Type.Number({
    description: "Timeout in milliseconds if waitForCompletion is true",
  })),
  workspaceRoot: Type.Optional(Type.String({
    description: "Working directory for the subagent",
  })),
  isolated: Type.Optional(Type.Boolean({
    description: "Whether to use git worktree for isolation",
  })),
  allowedTools: Type.Optional(Type.Array(Type.String())),
  blockedTools: Type.Optional(Type.Array(Type.String())),
});

export type SubagentDelegateInput = Static<typeof subagentDelegateSchema>;

// ============================================================================
// Tool Name Constants
// ============================================================================

export const SUBAGENT_SPAWN_TOOL = "subagent.spawn";
export const SUBAGENT_SEND_TOOL = "subagent.send";
export const SUBAGENT_WAIT_TOOL = "subagent.wait";
export const SUBAGENT_CLOSE_TOOL = "subagent.close";
export const SUBAGENT_LIST_TOOL = "subagent.list";
export const SUBAGENT_GET_TOOL = "subagent.get";
export const SUBAGENT_DELEGATE_TOOL = "subagent.delegate";

// ============================================================================
// SubAgent Manager Interface (for tools to use)
// ============================================================================

/**
 * SubAgent state returned by tools.
 */
export interface SubAgentToolState {
  id: string;
  name: string;
  status: "pending" | "initializing" | "running" | "waiting" | "completed" | "failed" | "closed";
  task: string;
  workspaceRoot: string;
  parentId: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: string;
  error?: string;
  progress?: number;
  messages: number;
  toolCalls: number;
}

/**
 * Interface for SubAgent manager operations.
 * Tools use this interface to interact with the SubAgent system.
 */
export interface SubAgentManagerClient {
  /** Spawn a new SubAgent */
  spawn(input: SubagentSpawnInput): Promise<{ subAgentId: string; name: string }>;
  /** Send a message to a SubAgent */
  send(input: SubagentSendInput): Promise<{ success: boolean; messageId?: string }>;
  /** Wait for a SubAgent to complete */
  wait(input: SubagentWaitInput): Promise<{ status: string; result?: string; error?: string; timedOut?: boolean }>;
  /** Close a SubAgent */
  close(input: SubagentCloseInput): Promise<{ success: boolean }>;
  /** List SubAgents */
  list(input?: SubagentListInput): Promise<{ subAgents: SubAgentToolState[] }>;
  /** Get SubAgent details */
  get(input: SubagentGetInput): Promise<{ subAgent?: SubAgentToolState }>;
}

// ============================================================================
// Tool Factories
// ============================================================================

function makeTextContent(text: string): TextContent {
  return { type: "text", text };
}

/**
 * Create a SubAgent spawn tool.
 */
export function createSubagentSpawnTool(
  getClient: () => SubAgentManagerClient | null,
): AgentTool {
  return {
    name: SUBAGENT_SPAWN_TOOL,
    label: SUBAGENT_SPAWN_TOOL,
    description: "Spawn a new SubAgent to execute a task in parallel. The SubAgent will start working immediately after spawning. Use subagent.wait to wait for completion or subagent.list to monitor progress.",
    parameters: subagentSpawnSchema,
    execute: async (_toolCallId, params: unknown) => {
      const typedParams: any = params ?? {};
      const client = getClient();
      if (!client) {
        throw new Error("SubAgent runtime is not configured");
      }

      try {
        const result = await client.spawn(typedParams);
        return {
          content: [makeTextContent(
            `SubAgent spawned successfully:\n- ID: ${result.subAgentId}\n- Name: ${result.name}\n- Task: ${typedParams.task}`
          )],
          details: { subAgentId: result.subAgentId },
        };
      } catch (error) {
        return {
          content: [makeTextContent(
            `Failed to spawn SubAgent: ${error instanceof Error ? error.message : String(error)}`
          )],
          details: {},
        };
      }
    },
  };
}

/**
 * Create a SubAgent send tool.
 */
export function createSubagentSendTool(
  getClient: () => SubAgentManagerClient | null,
): AgentTool {
  return {
    name: SUBAGENT_SEND_TOOL,
    label: SUBAGENT_SEND_TOOL,
    description: "Send a message to a running SubAgent. Use this to provide additional instructions or context to the subagent.",
    parameters: subagentSendSchema,
    execute: async (_toolCallId, params: unknown) => {
      const typedParams: any = params ?? {};
      const client = getClient();
      if (!client) {
        throw new Error("SubAgent runtime is not configured");
      }

      try {
        const result = await client.send(typedParams);
        if (!result.success) {
          return {
            content: [makeTextContent(
              `Failed to send message: SubAgent ${typedParams.subAgentId} not found or not running`
            )],
            details: {},
          };
        }

        return {
          content: [makeTextContent(
            `Message sent to SubAgent ${typedParams.subAgentId}${result.messageId ? ` (ID: ${result.messageId})` : ""}`
          )],
          details: { subAgentId: typedParams.subAgentId },
        };
      } catch (error) {
        return {
          content: [makeTextContent(
            `Failed to send message: ${error instanceof Error ? error.message : String(error)}`
          )],
          details: {},
        };
      }
    },
  };
}

/**
 * Create a SubAgent wait tool.
 */
export function createSubagentWaitTool(
  getClient: () => SubAgentManagerClient | null,
): AgentTool {
  return {
    name: SUBAGENT_WAIT_TOOL,
    label: SUBAGENT_WAIT_TOOL,
    description: "Wait for a SubAgent to complete its task. Returns the result when the subagent finishes or reports back. Optionally accepts a timeout.",
    parameters: subagentWaitSchema,
    execute: async (_toolCallId, params: unknown) => {
      const typedParams: any = params ?? {};
      const client = getClient();
      if (!client) {
        throw new Error("SubAgent runtime is not configured");
      }

      try {
        const result = await client.wait(typedParams);
        let message = `SubAgent ${typedParams.subAgentId} finished with status: ${result.status}`;

        if (result.timedOut) {
          message += "\n\nNote: Wait timed out before subagent completion.";
        }

        if (result.result) {
          message += `\n\nResult:\n${result.result}`;
        }

        if (result.error) {
          message += `\n\nError:\n${result.error}`;
        }

        return {
          content: [makeTextContent(message)],
          details: { subAgentId: typedParams.subAgentId, timedOut: result.timedOut },
        };
      } catch (error) {
        return {
          content: [makeTextContent(
            `Failed to wait for SubAgent: ${error instanceof Error ? error.message : String(error)}`
          )],
          details: {},
        };
      }
    },
  };
}

/**
 * Create a SubAgent close tool.
 */
export function createSubagentCloseTool(
  getClient: () => SubAgentManagerClient | null,
): AgentTool {
  return {
    name: SUBAGENT_CLOSE_TOOL,
    label: SUBAGENT_CLOSE_TOOL,
    description: "Close a SubAgent, optionally forcing termination. Use force=true to immediately terminate without waiting for the current task to complete.",
    parameters: subagentCloseSchema,
    execute: async (_toolCallId, params: unknown) => {
      const typedParams: any = params ?? {};
      const client = getClient();
      if (!client) {
        throw new Error("SubAgent runtime is not configured");
      }

      try {
        const result = await client.close(typedParams);
        return {
          content: [makeTextContent(
            result.success
              ? `SubAgent ${typedParams.subAgentId} closed${typedParams.force ? " (forced)" : ""}`
              : `Failed to close SubAgent ${typedParams.subAgentId}: not found`
          )],
          details: { subAgentId: typedParams.subAgentId },
        };
      } catch (error) {
        return {
          content: [makeTextContent(
            `Failed to close SubAgent: ${error instanceof Error ? error.message : String(error)}`
          )],
          details: {},
        };
      }
    },
  };
}

/**
 * Create a SubAgent list tool.
 */
export function createSubagentListTool(
  getClient: () => SubAgentManagerClient | null,
): AgentTool {
  return {
    name: SUBAGENT_LIST_TOOL,
    label: SUBAGENT_LIST_TOOL,
    description: "List all SubAgents, optionally filtered by status or parent agent. Use this to monitor the status of spawned subagents.",
    parameters: subagentListSchema,
    execute: async (_toolCallId, params: unknown) => {
      const typedParams: any = params ?? {};
      const client = getClient();
      if (!client) {
        throw new Error("SubAgent runtime is not configured");
      }

      try {
        const result = await client.list(typedParams);

        if (result.subAgents.length === 0) {
          return {
            content: [makeTextContent("No SubAgents found matching the filter criteria.")],
            details: { subAgents: [] },
          };
        }

        const lines = result.subAgents.map((agent) => {
          const parts = [
            `## ${agent.name} (${agent.id})`,
            `- Status: ${agent.status}`,
            `- Task: ${agent.task.slice(0, 80)}${agent.task.length > 80 ? "..." : ""}`,
            `- Created: ${agent.createdAt}`,
          ];

          if (agent.startedAt) parts.push(`- Started: ${agent.startedAt}`);
          if (agent.completedAt) parts.push(`- Completed: ${agent.completedAt}`);
          if (agent.progress !== undefined) parts.push(`- Progress: ${agent.progress}%`);
          if (agent.error) parts.push(`- Error: ${agent.error}`);
          if (agent.result) parts.push(`- Result: ${agent.result.slice(0, 100)}${agent.result.length > 100 ? "..." : ""}`);

          parts.push(`- Messages: ${agent.messages}, Tool Calls: ${agent.toolCalls}`);

          return parts.join("\n");
        });

        return {
          content: [makeTextContent(lines.join("\n\n"))],
          details: { subAgents: result.subAgents },
        };
      } catch (error) {
        return {
          content: [makeTextContent(
            `Failed to list SubAgents: ${error instanceof Error ? error.message : String(error)}`
          )],
          details: { subAgents: [] },
        };
      }
    },
  };
}

/**
 * Create a SubAgent get tool.
 */
export function createSubagentGetTool(
  getClient: () => SubAgentManagerClient | null,
): AgentTool {
  return {
    name: SUBAGENT_GET_TOOL,
    label: SUBAGENT_GET_TOOL,
    description: "Get detailed information about a specific SubAgent by its ID.",
    parameters: subagentGetSchema,
    execute: async (_toolCallId, params: unknown) => {
      const typedParams: any = params ?? {};
      const client = getClient();
      if (!client) {
        throw new Error("SubAgent runtime is not configured");
      }

      try {
        const result = await client.get(typedParams);

        if (!result.subAgent) {
          return {
            content: [makeTextContent(`SubAgent ${typedParams.subAgentId} not found.`)],
            details: {},
          };
        }

        const agent = result.subAgent;
        const lines = [
          `## ${agent.name} (${agent.id})`,
          `- Status: ${agent.status}`,
          `- Task: ${agent.task}`,
          `- Workspace: ${agent.workspaceRoot}`,
          `- Parent ID: ${agent.parentId}`,
          `- Created: ${agent.createdAt}`,
        ];

        if (agent.startedAt) lines.push(`- Started: ${agent.startedAt}`);
        if (agent.completedAt) lines.push(`- Completed: ${agent.completedAt}`);
        if (agent.progress !== undefined) lines.push(`- Progress: ${agent.progress}%`);
        if (agent.error) lines.push(`- Error: ${agent.error}`);
        if (agent.result) lines.push(`\n## Result\n${agent.result}`);
        lines.push(`\n## Statistics`);
        lines.push(`- Messages: ${agent.messages}`);
        lines.push(`- Tool Calls: ${agent.toolCalls}`);

        return {
          content: [makeTextContent(lines.join("\n"))],
          details: { subAgent: agent },
        };
      } catch (error) {
        return {
          content: [makeTextContent(
            `Failed to get SubAgent: ${error instanceof Error ? error.message : String(error)}`
          )],
          details: {},
        };
      }
    },
  };
}

/**
 * Create a SubAgent delegate tool (combined spawn and wait).
 */
export function createSubagentDelegateTool(
  getClient: () => SubAgentManagerClient | null,
): AgentTool {
  return {
    name: SUBAGENT_DELEGATE_TOOL,
    label: SUBAGENT_DELEGATE_TOOL,
    description: "Delegate a task to a SubAgent and optionally wait for completion. This is a convenience tool that combines spawn and wait into a single operation. Returns the subagent's result when complete or on timeout.",
    parameters: subagentDelegateSchema,
    execute: async (_toolCallId, params: unknown) => {
      const typedParams: any = params ?? {};
      const client = getClient();
      if (!client) {
        throw new Error("SubAgent runtime is not configured");
      }

      try {
        // Spawn the subagent
        const spawnResult = await client.spawn({
          task: typedParams.task,
          name: typedParams.name,
          workspaceRoot: typedParams.workspaceRoot,
          isolated: typedParams.isolated,
          allowedTools: typedParams.allowedTools,
          blockedTools: typedParams.blockedTools,
        });

        // Wait for completion if requested
        if (typedParams.waitForCompletion) {
          const waitResult = await client.wait({
            subAgentId: spawnResult.subAgentId,
            timeout: typedParams.timeout,
          });

          let message = `Task delegated to SubAgent ${spawnResult.name} (${spawnResult.subAgentId})\n`;
          message += `Status: ${waitResult.status}`;

          if (waitResult.timedOut) {
            message += "\n\nNote: Wait timed out before completion.";
          }

          if (waitResult.result) {
            message += `\n\nResult:\n${waitResult.result}`;
          }

          if (waitResult.error) {
            message += `\n\nError:\n${waitResult.error}`;
          }

          return {
            content: [makeTextContent(message)],
            details: { subAgentId: spawnResult.subAgentId, completed: !waitResult.timedOut, timedOut: waitResult.timedOut },
          };
        }

        return {
          content: [makeTextContent(
            `Task delegated to SubAgent ${spawnResult.name} (${spawnResult.subAgentId}). Use subagent.wait to wait for completion or subagent.list to monitor progress.`
          )],
          details: { subAgentId: spawnResult.subAgentId, completed: false },
        };
      } catch (error) {
        return {
          content: [makeTextContent(
            `Failed to delegate task: ${error instanceof Error ? error.message : String(error)}`
          )],
          details: {},
        };
      }
    },
  };
}

/**
 * Create all SubAgent tools.
 */
export function createSubagentTools(
  getClient: () => SubAgentManagerClient | null,
): AgentTool[] {
  return [
    createSubagentSpawnTool(getClient),
    createSubagentSendTool(getClient),
    createSubagentWaitTool(getClient),
    createSubagentCloseTool(getClient),
    createSubagentListTool(getClient),
    createSubagentGetTool(getClient),
    createSubagentDelegateTool(getClient),
  ];
}
