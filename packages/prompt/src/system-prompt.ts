import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { ResolvedSkill } from "@omi/core";

export interface ProjectContextFile {
  path: string;
  content: string;
}

export interface BuildSystemPromptOptions {
  projectContextFiles?: ProjectContextFile[];
  resolvedSkill?: ResolvedSkill | null;
}

export function loadProjectContextFiles(workspaceRoot: string, agentDir?: string): ProjectContextFile[] {
  const files: ProjectContextFile[] = [];
  const seenPaths = new Set<string>();

  const appendContextFile = (directory: string): void => {
    for (const filename of ["AGENTS.md", "CLAUDE.md"]) {
      const filePath = join(directory, filename);
      if (!existsSync(filePath) || seenPaths.has(filePath)) {
        continue;
      }

      seenPaths.add(filePath);
      files.push({
        path: filePath,
        content: readFileSync(filePath, "utf-8"),
      });
      break;
    }
  };

  if (agentDir) {
    appendContextFile(agentDir);
  }

  let currentDir = resolve(workspaceRoot);
  const rootDir = resolve("/");

  while (true) {
    appendContextFile(currentDir);
    if (currentDir === rootDir) {
      break;
    }

    currentDir = resolve(currentDir, "..");
  }

  return files;
}

export function buildSystemPrompt(options: BuildSystemPromptOptions = {}): string {
  const sections: string[] = [];
  const projectContextFiles = options.projectContextFiles ?? [];
  const resolvedSkill = options.resolvedSkill ?? null;

  if (projectContextFiles.length > 0) {
    sections.push(formatProjectContext(projectContextFiles));
  }

  if (resolvedSkill) {
    sections.push(
      [
        `The following skill is active: ${resolvedSkill.skill.name}.`,
        resolvedSkill.injectedPrompt,
      ].join("\n\n"),
    );
  }

  return sections.join("\n\n");
}

function formatProjectContext(projectContextFiles: ProjectContextFile[]): string {
  const sections = [
    "# Project Context",
    "Project-specific instructions and guidelines:",
    ...projectContextFiles.map(
      ({ path: filePath, content }) => `## ${filePath}\n\n${content}`,
    ),
  ];

  return sections.join("\n\n");
}
