/**
 * MCP Resource Tools - Tools for accessing MCP resources
 *
 * Provides Read and List tools for MCP resources that can be used
 * by the agent. These tools integrate with the MCP registry.
 */

import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { TextContent, Static, TSchema } from "@mariozechner/pi-ai";
import { Type } from "@mariozechner/pi-ai";
import type { McpRegistry } from "@omi/provider";

// ============================================================================
// Types
// ============================================================================

/**
 * MCP Resource Tools configuration.
 */
export interface McpResourceToolsConfig {
  /** MCP Registry instance */
  registry: McpRegistry;
  /** Whether to include resource content in list results */
  includeContentInList?: boolean;
  /** Maximum content length to return */
  maxContentLength?: number;
}

/**
 * Details for MCP resource tools.
 */
export interface McpResourceToolDetails {
  serverId?: string;
  uri?: string;
}

// ============================================================================
// Tool Schemas
// ============================================================================

/**
 * Tool name constants.
 */
export const MCP_RESOURCE_LIST_TOOL = "mcp.resource.list";
export const MCP_RESOURCE_READ_TOOL = "mcp.resource.read";

/**
 * Schema for MCP resource list tool.
 */
export const mcpResourceListSchema: TSchema = Type.Object({
  pattern: Type.Optional(Type.String({
    description: "Optional glob pattern to filter resources by URI (e.g., 'file://**/*.md')",
  })),
  serverId: Type.Optional(Type.String({
    description: "Optional server ID to list resources from a specific MCP server",
  })),
});

type McpResourceListInput = { pattern?: string; serverId?: string };

/**
 * Schema for MCP resource read tool.
 */
export const mcpResourceReadSchema: TSchema = Type.Object({
  uri: Type.String({
    description: "The URI of the resource to read (e.g., 'file:///path/to/file.txt')",
  }),
  maxLength: Type.Optional(Type.Number({
    description: "Maximum number of characters to return (default: 50000)",
  })),
});

type McpResourceReadInput = { uri: string; maxLength?: number };

// ============================================================================
// Tool Implementations
// ============================================================================

const DEFAULT_MAX_CONTENT_LENGTH = 50000;

/**
 * Create MCP resource list tool.
 */
export function createMcpResourceListTool(
  config: McpResourceToolsConfig
): AgentTool<typeof mcpResourceListSchema, McpResourceToolDetails> {
  return {
    name: MCP_RESOURCE_LIST_TOOL,
    label: MCP_RESOURCE_LIST_TOOL,
    description: "List available MCP resources. MCP resources are provided by MCP servers and can contain data, files, or API responses.",
    parameters: mcpResourceListSchema,
    execute: async (
      _toolCallId: string,
      params: unknown,
    ) => {
      const { pattern, serverId } = params as { pattern?: string; serverId?: string };

      try {
        type ResourceItem = { serverId: string; serverName: string; resource: { uri: string; name?: string; description?: string; mimeType?: string } };
        let resources: ResourceItem[];

        if (serverId) {
          // List from specific server
          const serverResources = config.registry.getResources(serverId);
          const serverName = config.registry.getServer(serverId)?.config.name ?? serverId;
          resources = serverResources.map((r) => ({
            serverId,
            serverName,
            resource: r,
          }));
        } else {
          // List from all servers
          resources = config.registry.getAllResources();
        }

        // Filter by pattern if provided
        let filtered = resources;
        if (pattern) {
          // Simple glob matching
          const regex = globToRegex(pattern);
          filtered = resources.filter((r) => regex.test(r.resource.uri));
        }

        // Format output
        const lines: string[] = [];
        for (const item of filtered) {
          const resource = item.resource;
          const sId = item.serverId;
          const serverName = item.serverName;
          lines.push(`## ${resource.name || resource.uri}`);
          lines.push(`- URI: ${resource.uri}`);
          lines.push(`- Server: ${serverName} (${sId})`);
          if (resource.description) {
            lines.push(`- Description: ${resource.description}`);
          }
          if (resource.mimeType) {
            lines.push(`- MIME Type: ${resource.mimeType}`);
          }
          lines.push("");
        }

        const output = lines.join("\n");
        return {
          content: [{ type: "text", text: output || "No resources found." } as TextContent],
          details: { items: filtered.map((item) => item.resource), serverId } as McpResourceToolDetails & { items: typeof filtered[number]["resource"][] },
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error listing MCP resources: ${error instanceof Error ? error.message : String(error)}`,
          } as TextContent],
          details: {} as McpResourceToolDetails,
        };
      }
    },
  };
}

/**
 * Create MCP resource read tool.
 */
export function createMcpResourceReadTool(
  config: McpResourceToolsConfig
): AgentTool<typeof mcpResourceReadSchema, McpResourceToolDetails> {
  return {
    name: MCP_RESOURCE_READ_TOOL,
    label: MCP_RESOURCE_READ_TOOL,
    description: "Read the content of an MCP resource by its URI.",
    parameters: mcpResourceReadSchema,
    execute: async (
      _toolCallId: string,
      params: unknown,
    ) => {
      const { uri, maxLength } = params as { uri: string; maxLength?: number };
      const limit = maxLength ?? config.maxContentLength ?? DEFAULT_MAX_CONTENT_LENGTH;

      try {
        const { serverId, content } = await config.registry.readResourceByUri(uri);

        // Format content
        let text: string;
        if (content.text) {
          text = content.text;
        } else if (content.blob) {
          text = `[Binary content (base64, ${content.blob.length} bytes)]`;
        } else {
          text = "[Empty content]";
        }

        // Truncate if needed
        const truncated = text.length > limit;
        if (truncated) {
          text = text.slice(0, limit) + `\n\n[Truncated at ${limit} characters]`;
        }

        return {
          content: [{ type: "text", text } as TextContent],
          details: { serverId, uri, contentType: content.text ? "text" : "binary", truncated } as McpResourceToolDetails & { contentType: string; truncated: boolean },
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error reading MCP resource ${uri}: ${error instanceof Error ? error.message : String(error)}`,
          } as TextContent],
          details: { uri } as McpResourceToolDetails,
        };
      }
    },
  };
}

/**
 * Create both MCP resource tools.
 */
export function createMcpResourceTools(
  config: McpResourceToolsConfig
): AgentTool<typeof mcpResourceListSchema | typeof mcpResourceReadSchema, McpResourceToolDetails>[] {
  return [
    createMcpResourceListTool(config),
    createMcpResourceReadTool(config),
  ];
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Convert a glob pattern to a RegExp.
 */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // Escape special regex chars except * and ?
    .replace(/\*/g, ".*") // * -> .*
    .replace(/\?/g, "."); // ? -> .

  return new RegExp(`^${escaped}$`);
}

// ============================================================================
// Exports
// ============================================================================

export { createMcpResourceTools as createMcpTools };
