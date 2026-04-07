import {
  validateToolArguments,
  type Tool,
  type ToolCall,
  type Static,
  type TSchema,
} from "@mariozechner/pi-ai";

function normalizeToolArguments(toolName: string, params: unknown): Record<string, unknown> {
  if (params === undefined) {
    return {};
  }
  if (params === null || typeof params !== "object" || Array.isArray(params)) {
    throw new Error(`Validation failed for tool \"${toolName}\": arguments must be an object`);
  }
  return params as Record<string, unknown>;
}

export function parseToolInput<TInputSchema extends TSchema>(
  toolName: string,
  schema: TInputSchema,
  params: unknown,
): Static<TInputSchema> {
  const tool: Tool = {
    name: toolName,
    description: toolName,
    parameters: schema,
  };

  const call: ToolCall = {
    type: "toolCall",
    id: `${toolName}:input`,
    name: toolName,
    arguments: normalizeToolArguments(toolName, params),
  };

  return validateToolArguments(tool, call) as Static<TInputSchema>;
}
