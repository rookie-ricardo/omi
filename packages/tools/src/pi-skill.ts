import type { OmiTool } from "@omi/core";
import { Type } from "@mariozechner/pi-ai";
import { parseToolInput } from "./input-parse";
import { getSkillExecutorRuntime } from "./runtime";

// ============================================================================
// Schemas
// ============================================================================

export const skillSchema = Type.Object({
  skill: Type.String({ description: "The skill name. E.g., 'commit', 'review-pr', or 'pdf'" }),
  args: Type.Optional(Type.String({ description: "Optional arguments for the skill" })),
});

export type SkillToolInput = { skill: string; args?: string };

// ============================================================================
// Tool Factory
// ============================================================================

export function createSkillTool(): OmiTool<typeof skillSchema, { skill: string; args?: string; content: string; details?: unknown }> {
  return {
    name: "skill",
    label: "skill",
    description: `Execute a skill within the main conversation.

When users ask you to perform tasks, check if any of the available skills match. Skills provide specialized capabilities and domain knowledge.

When users reference "/<something>" style workflows (e.g., "/commit", "/review-pr"), treat them as skill requests and use this tool.

How to invoke:
- Use this tool with the skill name and optional arguments
- Examples:
  - skill: "pdf" - invoke the pdf skill
  - skill: "commit", args: "-m 'Fix bug'" - invoke with arguments
  - skill: "review-pr", args: "123" - invoke with arguments

Important:
- Available skills are listed in system-reminder messages in the conversation
- When a skill matches the user's request, invoke the Skill tool BEFORE generating any other response about the task
- NEVER mention a skill without actually calling this tool
- Do not invoke a skill that is already running
- If you see a <command-name> tag in the current conversation turn, the skill has ALREADY been loaded - follow the instructions directly instead of calling this tool again`,
    parameters: skillSchema,
    execute: async (_toolCallId: string, params: unknown) => {
      const { skill, args } = parseToolInput("skill", skillSchema, params);
      const executor = getSkillExecutorRuntime();
      if (!executor) {
        throw new Error("Skill executor runtime is not configured");
      }
      const result = await executor(skill, args);
      return {
        content: [{ type: "text" as const, text: result.content }],
        details: { skill, args, content: result.content, details: result.details },
      };
    },
  };
}
