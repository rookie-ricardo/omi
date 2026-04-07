import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@mariozechner/pi-ai";
import { parseToolInput } from "./input-parse";
import type { McpRegistry } from "@omi/provider";

export const mcpPromptListSchema = Type.Object({});

export const mcpPromptEvalSchema = Type.Object({
  serverId: Type.String({ description: "The ID of the MCP server" }),
  promptName: Type.String({ description: "The name of the prompt to evaluate" }),
  args: Type.Optional(Type.Record(Type.String(), Type.String(), { description: "Arguments for the prompt" })),
});

export interface McpPromptEvalInput {
  serverId: string;
  promptName: string;
  args?: Record<string, string>;
}

export interface McpPromptToolsDependencies {
  registry: McpRegistry;
}

export function createMcpPromptListTool(deps: McpPromptToolsDependencies): AgentTool<any> {
  return {
    name: "mcp.prompt.list",
    label: "mcp.prompt.list",
    description: "List available MCP prompts across all connected servers.",
    parameters: mcpPromptListSchema,
    execute: async (_toolCallId: string, params: any) => {
      parseToolInput("mcp.prompt.list", mcpPromptListSchema, params);

      const prompts = deps.registry.getAllPrompts();
      if (prompts.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No MCP prompts available." }],
          details: { resultsText: "No results" },
        };
      }

      const lines = prompts.map(
        ({ serverId, prompt }) =>
          `- [${serverId}] ${prompt.name}: ${prompt.description ?? "No description"}`
      );

      const text = `Available Prompts:\n${lines.join("\n")}`;

      return {
        content: [{ type: "text" as const, text }],
        details: { resultsText: text },
      };
    },
  };
}

export function createMcpPromptEvalTool(deps: McpPromptToolsDependencies): AgentTool<any> {
  return {
    name: "mcp.prompt.eval",
    label: "mcp.prompt.eval",
    description: "Evaluate an MCP prompt and return the result messages.",
    parameters: mcpPromptEvalSchema,
    execute: async (_toolCallId: string, params: any) => {
      const { serverId, promptName, args } = parseToolInput("mcp.prompt.eval", mcpPromptEvalSchema, params);

      try {
        const result = await deps.registry.getPrompt(serverId, promptName, args);

        const lines = result.messages.map((msg) => {
          if (msg.content.type === "text") {
            return `[${msg.role}]: ${msg.content.text}`;
          } else if (msg.content.type === "resource") {
            return `[${msg.role}]: (Resource: ${msg.content.resource.uri})`;
          }
          return `[${msg.role}]: (Unknown content type)`;
        });

        const text = `Prompt Evaluation Result:\n${result.description ? `Description: ${result.description}\n\n` : ""}${lines.join("\n")}`;

        return {
          content: [{ type: "text" as const, text }],
          details: { serverId, promptName, args, resultsText: text },
        };
      } catch (e: any) {
        throw new Error(`Failed to evaluate prompt '${promptName}' on server '${serverId}': ${e.message}`);
      }
    },
  };
}
