import { homedir } from "node:os";
import { join } from "node:path";

import type { ResolvedSkill, SkillDescriptor, SkillMatch } from "@omi/core";
import { buildSystemPrompt, loadProjectContextFiles, type ProjectContextFile } from "@omi/prompt";

import { listSkills, resolveSkillForPrompt, searchSkills } from "./skills/index.js";

export interface ResourceCatalog<T> {
  items: T[];
  diagnostics: string[];
}

export interface ResourceLoader {
  readonly workspaceRoot: string;
  readonly agentDir: string;
  reload(): Promise<void>;
  getProjectContextFiles(): ProjectContextFile[];
  listSkills(): Promise<SkillDescriptor[]>;
  searchSkills(query: string): Promise<SkillMatch[]>;
  resolveSkillForPrompt(prompt: string): Promise<ResolvedSkill | null>;
  buildSystemPrompt(resolvedSkill: ResolvedSkill | null, cwd?: string): string;
  getPrompts(): ResourceCatalog<unknown>;
  getThemes(): ResourceCatalog<unknown>;
}

export class DefaultResourceLoader implements ResourceLoader {
  readonly agentDir: string;
  private projectContextFiles: ProjectContextFile[];

  constructor(readonly workspaceRoot: string, agentDir = join(homedir(), ".omi")) {
    this.agentDir = agentDir;
    this.projectContextFiles = loadProjectContextFiles(this.workspaceRoot, this.agentDir);
  }

  async reload(): Promise<void> {
    this.projectContextFiles = loadProjectContextFiles(this.workspaceRoot, this.agentDir);
  }

  getProjectContextFiles(): ProjectContextFile[] {
    return [...this.projectContextFiles];
  }

  listSkills(): Promise<SkillDescriptor[]> {
    return listSkills(this.workspaceRoot);
  }

  searchSkills(query: string): Promise<SkillMatch[]> {
    return searchSkills(this.workspaceRoot, query);
  }

  resolveSkillForPrompt(prompt: string): Promise<ResolvedSkill | null> {
    return resolveSkillForPrompt(this.workspaceRoot, prompt);
  }

  buildSystemPrompt(resolvedSkill: ResolvedSkill | null, cwd?: string): string {
    return buildSystemPrompt({
      projectContextFiles: this.projectContextFiles,
      resolvedSkill,
      cwd: cwd ?? this.workspaceRoot,
    });
  }

  getPrompts(): ResourceCatalog<unknown> {
    return { items: [], diagnostics: [] };
  }

  getThemes(): ResourceCatalog<unknown> {
    return { items: [], diagnostics: [] };
  }
}
