/**
 * SubAgent Tools
 *
 * Tool implementations for sub-agent spawning and management.
 */

import type { Tool, ToolInput, ToolResult } from "@omi/tools";
import { createId, nowIso } from "@omi/core";
import { SubAgentManager, createSpawnConfig } from "../subagent-manager";
import { TaskMailbox } from "../task-mailbox";

/**
 * Create spawn subagent tool.
 */
export function createSpawnTool(
  workspaceRoot: string,
  ownerId: string,
): Tool {
  const manager = new SubAgentManager(workspaceRoot);
  const mailbox = new TaskMailbox();

  return {
    name: "spawn_subagent",
    description: "Spawn a sub-agent to execute a task in parallel",
    inputSchema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "Task description for the sub-agent",
        },
        background: {
          type: "boolean",
          description: "Run in background (default: false)",
          default: false,
        },
        deadline: {
          type: "number",
          description: "Maximum execution time in milliseconds",
        },
        writeScope: {
          type: "string",
          enum: ["shared", "isolated", "worktree"],
          description: "Workspace isolation level",
          default: "shared",
        },
      },
      required: ["task"],
    },
    async execute(input: ToolInput): Promise<ToolResult> {
      try {
        const args = input.args as {
          task: string;
          background?: boolean;
          deadline?: number;
          writeScope?: "shared" | "isolated" | "worktree";
        };

        const config = createSpawnConfig(ownerId, args.task, {
          background: args.background,
          deadline: args.deadline,
          writeScope: args.writeScope,
        });

        const agentId = await manager.spawn(config);

        // Publish event
        mailbox.publishTaskNotification("submitted", ownerId, agentId, {
          task: args.task,
        });

        if (args.background) {
          return {
            success: true,
            output: JSON.stringify({ agentId, status: "spawned" }),
          };
        }

        // Wait for completion if not background
        await manager.start(agentId);
        const output = await manager.wait(agentId, args.deadline);

        return {
          success: output.success,
          output: output.text,
          error: output.error,
        };
      } catch (error) {
        return {
          success: false,
          output: "",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

/**
 * Create send-to-subagent tool.
 */
export function createSendTool(
  workspaceRoot: string,
  ownerId: string,
): Tool {
  const manager = new SubAgentManager(workspaceRoot);
  const mailbox = new TaskMailbox();

  return {
    name: "send_to_subagent",
    description: "Send a message to a running sub-agent",
    inputSchema: {
      type: "object",
      properties: {
        agentId: {
          type: "string",
          description: "Sub-agent ID to send message to",
        },
        message: {
          type: "string",
          description: "Message content",
        },
      },
      required: ["agentId", "message"],
    },
    async execute(input: ToolInput): Promise<ToolResult> {
      try {
        const args = input.args as { agentId: string; message: string };

        await manager.send(args.agentId, args.message);

        mailbox.sendMessage(ownerId, args.agentId, args.message);

        return {
          success: true,
          output: `Message sent to ${args.agentId}`,
        };
      } catch (error) {
        return {
          success: false,
          output: "",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

/**
 * Create wait-for-subagent tool.
 */
export function createWaitTool(
  workspaceRoot: string,
  ownerId: string,
): Tool {
  const manager = new SubAgentManager(workspaceRoot);

  return {
    name: "wait_subagent",
    description: "Wait for a sub-agent to complete",
    inputSchema: {
      type: "object",
      properties: {
        agentId: {
          type: "string",
          description: "Sub-agent ID to wait for",
        },
        timeout: {
          type: "number",
          description: "Maximum wait time in milliseconds",
          default: 300000,
        },
      },
      required: ["agentId"],
    },
    async execute(input: ToolInput): Promise<ToolResult> {
      try {
        const args = input.args as { agentId: string; timeout?: number };

        const output = await manager.wait(args.agentId, args.timeout);

        return {
          success: output.success,
          output: output.text,
          error: output.error,
        };
      } catch (error) {
        return {
          success: false,
          output: "",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

/**
 * Create close-subagent tool.
 */
export function createCloseTool(
  workspaceRoot: string,
  ownerId: string,
): Tool {
  const manager = new SubAgentManager(workspaceRoot);

  return {
    name: "close_subagent",
    description: "Close and cleanup a sub-agent",
    inputSchema: {
      type: "object",
      properties: {
        agentId: {
          type: "string",
          description: "Sub-agent ID to close",
        },
      },
      required: ["agentId"],
    },
    async execute(input: ToolInput): Promise<ToolResult> {
      try {
        const args = input.args as { agentId: string };

        await manager.close(args.agentId);

        return {
          success: true,
          output: `Sub-agent ${args.agentId} closed`,
        };
      } catch (error) {
        return {
          success: false,
          output: "",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
