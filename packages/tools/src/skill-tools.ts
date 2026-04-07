import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@mariozechner/pi-ai";
import { parseToolInput } from "./input-parse";

// Import removed because we will inject searchSkills to avoid circular dependency
// import { searchSkills } from "@omi/agent/skills";

export const discoverSkillsToolSchema = Type.Object({
  query: Type.String({ description: "The topic, task, or tool name you are looking for skills or predefined prompts about. Example: 'git commit' or 'test runner' or 'code review'." }),
});

export interface DiscoverSkillsInput {
  query: string;
}

export interface SkillMatchInfo {
  name: string;
  description: string;
  compatibility?: string | null;
  allowedTools?: string[];
  body: string;
  score: number;
}

export type SearchSkillsFn = (workspaceRoot: string, query: string) => Promise<SkillMatchInfo[]>;

export interface DiscoverSkillsDependencies {
  workspaceRootFactory: () => string;
  searchSkills: SearchSkillsFn;
}

export function createDiscoverSkillsTool(deps: DiscoverSkillsDependencies): AgentTool<any> {
  return {
    name: "discover_skills",
    label: "discover_skills",
    description: "Search for available built-in skills, bundled prompts, and MCP-injected skills. Use this when you need guidance on specific workflows, domain knowledge, or predefined tasks.",
    parameters: discoverSkillsToolSchema,
    execute: async (_toolCallId: string, params: unknown) => {
      const { query } = parseToolInput("discover_skills", discoverSkillsToolSchema, params);

      const workspaceRoot = deps.workspaceRootFactory();

      try {
        const skills = await deps.searchSkills(workspaceRoot, query);

        if (skills.length === 0) {
          return {
            content: [{ type: "text" as const, text: `No skills found matching the query: '${query}'. Proceed natively.` }],
            details: { query, resultsText: "No results" },
          };
        }

        // Format the discovered skills
        const results = skills.map((skill) => {
          let block = `### ${skill.name} (Priority: ${skill.score})\n`;
          block += `Description: ${skill.description}\n`;
          if (skill.compatibility) {
            block += `Compatibility: ${skill.compatibility}\n`;
          }
          if (skill.allowedTools && skill.allowedTools.length > 0) {
            block += `Suggested Tools: ${skill.allowedTools.join(", ")}\n`;
          }
          block += `\n${skill.body}\n`;
          return block;
        });

        const text = `Found ${skills.length} relevant skill(s) for your query.\n\n${results.join("\n---\n")}`;

        return {
          content: [{ type: "text" as const, text }],
          details: { query, resultsText: text },
        };
      } catch (e: any) {
        throw new Error(`Error discovering skills: ${e.message}`);
      }
    },
  };
}
