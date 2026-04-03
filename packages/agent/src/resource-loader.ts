import { homedir } from "node:os";
import { join } from "node:path";

import type { ResolvedSkill, SkillDescriptor, SkillMatch } from "@omi/core";
import { loadExtensions } from "@omi/extensions";
import type { ExtensionDefinition } from "@omi/extensions";
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
  buildSystemPrompt(resolvedSkill: ResolvedSkill | null): string;
  getPrompts(): ResourceCatalog<unknown>;
  getThemes(): ResourceCatalog<unknown>;
  getExtensions(): ResourceCatalog<ExtensionDefinition>;
}

export class DefaultResourceLoader implements ResourceLoader {
  readonly agentDir: string;
  private projectContextFiles: ProjectContextFile[];
  private extensions: ResourceCatalog<ExtensionDefinition>;

  constructor(readonly workspaceRoot: string, agentDir = join(homedir(), ".omi")) {
    this.agentDir = agentDir;
    this.projectContextFiles = loadProjectContextFiles(this.workspaceRoot, this.agentDir);
    this.extensions = { items: [], diagnostics: [] };
  }

  async reload(): Promise<void> {
    this.projectContextFiles = loadProjectContextFiles(this.workspaceRoot, this.agentDir);
    const loadedExtensions = await loadExtensions({
      workspaceRoot: this.workspaceRoot,
      agentDir: this.agentDir,
    });
    this.extensions = {
      items: loadedExtensions.extensions,
      diagnostics: loadedExtensions.diagnostics,
    };
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

  buildSystemPrompt(resolvedSkill: ResolvedSkill | null): string {
    return buildSystemPrompt({
      projectContextFiles: this.projectContextFiles,
      resolvedSkill,
    });
  }

  getPrompts(): ResourceCatalog<unknown> {
    return { items: [], diagnostics: [] };
  }

  getThemes(): ResourceCatalog<unknown> {
    return { items: [], diagnostics: [] };
  }

  getExtensions(): ResourceCatalog<ExtensionDefinition> {
    return {
      items: [...this.extensions.items],
      diagnostics: [...this.extensions.diagnostics],
    };
  }
}
