import type { OmiTool } from "@omi/core";
import { Type } from "@mariozechner/pi-ai";

import { parseToolInput } from "./input-parse";
import { getSubagentExecutorRuntime } from "./runtime";

export const subagentTaskItemSchema = Type.Object({
  agent: Type.String({ description: "Name of the subagent to invoke." }),
  task: Type.String({ description: "Task prompt for the subagent." }),
  cwd: Type.Optional(Type.String({ description: "Optional working directory for this subagent task." })),
});

export const subagentChainItemSchema = Type.Object({
  agent: Type.String({ description: "Name of the subagent to invoke." }),
  task: Type.String({ description: "Sequential task. Supports {previous} placeholder." }),
  cwd: Type.Optional(Type.String({ description: "Optional working directory for this subagent task." })),
});

export const subagentScopeSchema = Type.Union(
  [Type.Literal("user"), Type.Literal("project"), Type.Literal("both")],
  {
    description: "Agent discovery scope. Default is user.",
  },
);

export const subagentSchema = Type.Object({
  agent: Type.Optional(Type.String({ description: "Subagent name for single mode." })),
  task: Type.Optional(Type.String({ description: "Task for single mode." })),
  tasks: Type.Optional(Type.Array(subagentTaskItemSchema, { description: "Parallel mode task list." })),
  chain: Type.Optional(Type.Array(subagentChainItemSchema, { description: "Chain mode task list." })),
  agentScope: Type.Optional(subagentScopeSchema),
  cwd: Type.Optional(Type.String({ description: "Optional working directory for single mode." })),
});

export type SubagentScope = "user" | "project" | "both";

export interface SubagentTaskItem {
  agent: string;
  task: string;
  cwd?: string;
}

export interface SubagentChainItem {
  agent: string;
  task: string;
  cwd?: string;
}

export interface SubagentToolInput {
  agent?: string;
  task?: string;
  tasks?: SubagentTaskItem[];
  chain?: SubagentChainItem[];
  agentScope?: SubagentScope;
  cwd?: string;
}

export function createSubagentTool(): OmiTool<typeof subagentSchema, {
  input: SubagentToolInput;
  content: string;
  details?: unknown;
}> {
  return {
    name: "subagent",
    label: "subagent",
    description: [
      "Delegate work to specialized subagents with isolated context.",
      "Modes: single (agent + task), parallel (tasks[]), or chain (chain[] with {previous}).",
      "Use when task decomposition across specialized agent prompts is beneficial.",
    ].join(" "),
    parameters: subagentSchema,
    execute: async (_toolCallId: string, params: unknown, signal?: AbortSignal, onUpdate?: (result: unknown) => void) => {
      const input = parseToolInput("subagent", subagentSchema, params) as SubagentToolInput;
      const executor = getSubagentExecutorRuntime();
      if (!executor) {
        throw new Error("Subagent executor runtime is not configured");
      }
      const result = await executor(input as Record<string, unknown>, signal, onUpdate);
      return {
        content: [{ type: "text" as const, text: result.content }],
        details: {
          input,
          content: result.content,
          details: result.details,
        },
      };
    },
  };
}
