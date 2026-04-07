import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@mariozechner/pi-ai";
import { parseToolInput } from "./input-parse.js";
import type { SubAgentManagerClient } from "./subagent.js";
import { randomUUID } from "node:crypto";

export const teamCreateSchema = Type.Object({
  name: Type.String({ description: "Name of the team to create" }),
  description: Type.Optional(Type.String({ description: "Purpose of the team" })),
  roles: Type.Array(
    Type.Object({
      roleName: Type.String({ description: "Role identifier (e.g., researcher, reviewer)" }),
      task: Type.String({ description: "Specific task or system instructions for this role" }),
    }),
    { description: "List of roles/subagents to spawn for this team" }
  ),
});

export const teamDeleteSchema = Type.Object({
  name: Type.String({ description: "Name of the team to delete" }),
});

interface TeamFile {
  name: string;
  description?: string;
  createdAt: number;
  subAgents: Array<{
    roleName: string;
    subAgentId: string;
  }>;
}

function getTeamDir(cwd: string): string {
  const dir = join(cwd, ".omi_teams");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getTeamFilePath(cwd: string, teamName: string): string {
  const sanitized = teamName.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(getTeamDir(cwd), `${sanitized}.json`);
}

export function createTeamCreateTool(
  cwd: string,
  getClient: () => SubAgentManagerClient | null
): AgentTool<typeof teamCreateSchema, { teamName: string; file: string; subAgents: any[] }> {
  return {
    name: "team.create",
    label: "team.create",
    description: "Create a Multi-Agent Swarm team by spawning multiple parallel subagents and recording the team context to a configuration file.",
    parameters: teamCreateSchema,
    execute: async (_toolCallId: string, params: unknown) => {
      const { name, description, roles } = parseToolInput("team.create", teamCreateSchema, params);
      const client = getClient();
      if (!client) {
        throw new Error("SubAgent runtime is not configured. Team tools require SubAgent capabilities.");
      }

      const teamFilePath = getTeamFilePath(cwd, name);
      if (existsSync(teamFilePath)) {
        throw new Error(`Team '${name}' already exists at ${teamFilePath}. Please use team.delete first or use a different name.`);
      }

      const spawnResults = [];

      // Spawn subagents for each role
      for (const role of roles) {
        const result = await client.spawn({
          name: `${name}-${role.roleName}-${randomUUID().substring(0, 4)}`,
          task: role.task,
          workspaceRoot: cwd,
        });
        spawnResults.push({
          roleName: role.roleName,
          subAgentId: result.subAgentId,
        });
      }

      const teamFile: TeamFile = {
        name,
        description,
        createdAt: Date.now(),
        subAgents: spawnResults,
      };

      writeFileSync(teamFilePath, JSON.stringify(teamFile, null, 2), "utf8");

      return {
        content: [{ type: "text" as const, text: `Team '${name}' created successfully with ${roles.length} members. Team file written to ${teamFilePath}.\nStarted SubAgents: \n${spawnResults.map(r => `- ${r.roleName}: ${r.subAgentId}`).join("\n")}` }],
        details: { teamName: name, file: teamFilePath, subAgents: spawnResults },
      };
    },
  };
}

export function createTeamDeleteTool(
  cwd: string,
  getClient: () => SubAgentManagerClient | null
): AgentTool<typeof teamDeleteSchema, { teamName: string; closedCount: number }> {
  return {
    name: "team.delete",
    label: "team.delete",
    description: "Delete a Multi-Agent Swarm team, gracefully closing all its bound subagents.",
    parameters: teamDeleteSchema,
    execute: async (_toolCallId: string, params: unknown) => {
      const { name } = parseToolInput("team.delete", teamDeleteSchema, params);
      const client = getClient();
      if (!client) {
        throw new Error("SubAgent runtime is not configured.");
      }

      const teamFilePath = getTeamFilePath(cwd, name);
      if (!existsSync(teamFilePath)) {
        throw new Error(`Team '${name}' does not exist at ${teamFilePath}.`);
      }

      const content = readFileSync(teamFilePath, "utf8");
      let teamFile: TeamFile;
      try {
        teamFile = JSON.parse(content);
      } catch (e) {
        throw new Error(`Corrupted team file at ${teamFilePath}. Cannot parse JSON.`);
      }

      let closedCount = 0;
      for (const sa of teamFile.subAgents) {
        try {
          await client.close({ subAgentId: sa.subAgentId, force: true });
          closedCount++;
        } catch (e) {
          // Ignore failures to close individual subagents, they might have already terminated.
        }
      }

      rmSync(teamFilePath);

      return {
        content: [{ type: "text" as const, text: `Team '${name}' deleted successfully. Force-closed ${closedCount} associated subagents. Team file removed.` }],
        details: { teamName: name, closedCount },
      };
    },
  };
}
