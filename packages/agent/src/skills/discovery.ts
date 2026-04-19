/**
 * Skill Discovery and Matching
 *
 * Handles skill discovery, deduplication, and context-aware matching.
 * Supports:
 * - Realpath-based identity for deduplication
 * - Context-aware skill activation
 * - Priority-based skill selection
 */

import { homedir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { access, readdir, readFile, stat } from "node:fs/promises";
import { realpath } from "node:fs/promises";
import { existsSync } from "node:fs";

import {
  DEFAULT_SKILL_SETTING_SOURCES,
  SkillSettingSource,
  type ResolvedSkill,
  type SkillDescriptor,
  type SkillMatch,
  resolvedSkillSchema,
  skillDescriptorSchema,
  skillMatchSchema,
} from "@omi/core";

import { isBuiltInTool } from "@omi/tools";
import YAML from "yaml";

import {
  parseSkillFrontmatter,
  matchesActivationConditions,
  type SkillFrontmatter,
  type ActivationCondition,
  type ExecutionMode,
  type EffortLevel,
  getEffortScore,
} from "./frontmatter";
import { getBundledSkills } from "./bundled/registry";

// ============================================================================
// Types
// ============================================================================

export interface DiscoveryOptions {
  /** Workspace root directory */
  workspaceRoot: string;
  /** Current prompt for context-aware matching */
  prompt?: string;
  /** Current file paths for activation conditions */
  filePaths?: string[];
  /** Current environment variables */
  envVars?: Record<string, string>;
  /** Git branch name */
  gitBranch?: string;
  /** Whether git is dirty */
  gitDirty?: boolean;
  /** Whether git has conflicts */
  gitHasConflicts?: boolean;
  /** Include user-level skills */
  includeUserSkills?: boolean;
  /** Include workspace-level skills */
  includeWorkspaceSkills?: boolean;
  /** Shared skill setting source selector (project/local/user). */
  settingSources?: SkillSettingSource[];
}

export interface DiscoveredSkill {
  descriptor: SkillDescriptor;
  frontmatter: SkillFrontmatter | null;
  activationConditions: ActivationCondition | null;
  executionMode: ExecutionMode;
  effort: EffortLevel;
  priority: number;
  identity: string;
}

interface SkillRoot {
  scope: "workspace" | "user";
  client: "agent" | "claude";
  basePath: string;
  priority: number;
}

const FRONTMATTER_PATTERN = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/;

// ============================================================================
// Discovery
// ============================================================================

/**
 * Discover all available skills with deduplication based on realpath identity.
 */
export async function discoverSkills(options: DiscoveryOptions): Promise<DiscoveredSkill[]> {
  const settingSources = options.settingSources ?? DEFAULT_SKILL_SETTING_SOURCES;
  const includeWorkspaceFromSettings = settingSources.includes(SkillSettingSource.Project)
    || settingSources.includes(SkillSettingSource.Local);
  const includeUserFromSettings = settingSources.includes(SkillSettingSource.User);
  const roots = getSkillRoots(options.workspaceRoot, {
    includeUser: options.includeUserSkills ?? includeUserFromSettings,
    includeWorkspace: options.includeWorkspaceSkills ?? includeWorkspaceFromSettings,
  });

  const discovered = (
    await Promise.all(roots.map(async (root) => discoverSkillsInRoot(root, options)))
  ).flat();

  discovered.push(...getBundledSkills());

  // Deduplicate by realpath identity
  const deduped = new Map<string, DiscoveredSkill>();
  for (const skill of discovered) {
    const existing = deduped.get(skill.identity);
    if (!existing || skill.priority > existing.priority) {
      deduped.set(skill.identity, skill);
    }
  }

  return [...deduped.values()].sort((a, b) => {
    // Higher priority first
    if (b.priority !== a.priority) {
      return b.priority - a.priority;
    }
    // Then by effort (lower effort first)
    return getEffortScore(a.effort) - getEffortScore(b.effort);
  });
}

/**
 * Search skills by query with scoring.
 */
export async function searchSkills(
  workspaceRoot: string,
  query: string,
  options?: Partial<DiscoveryOptions>,
): Promise<SkillMatch[]> {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [];
  }

  const discovered = await discoverSkills({
    workspaceRoot,
    prompt: query,
    ...options,
  });

  const scored = discovered
    .map((skill) => ({ skill, score: scoreSkill(skill, normalizedQuery) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      // Higher score first
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      // Then by priority
      if (right.skill.priority !== left.skill.priority) {
        return right.skill.priority - left.skill.priority;
      }
      // Then by ID
      return left.skill.descriptor.id.localeCompare(right.skill.descriptor.id);
    });

  return scored.map(({ skill, score }) =>
    skillMatchSchema.parse({
      ...skill.descriptor,
      score,
    }),
  );
}

/**
 * Resolve skill for prompt with context-aware activation.
 */
export async function resolveSkillForPrompt(
  workspaceRoot: string,
  prompt: string,
  options?: Partial<DiscoveryOptions>,
): Promise<ResolvedSkill | null> {
  const discovered = await discoverSkills({
    workspaceRoot,
    prompt,
    ...options,
  });

  // First, try context-aware activation
  const contextMatch = discovered.find((skill) => {
    if (!skill.activationConditions) return false;
    return matchesActivationConditions(skill.activationConditions, {
      prompt,
      filePaths: options?.filePaths,
      envVars: options?.envVars,
      gitBranch: options?.gitBranch,
      gitDirty: options?.gitDirty,
      gitHasConflicts: options?.gitHasConflicts,
    });
  });

  const bestMatch = contextMatch
    ? toSkillMatch(contextMatch, scoreSkill(contextMatch, prompt.trim().toLowerCase()))
    : (await searchSkills(workspaceRoot, prompt, options))[0] ?? null;

  if (!bestMatch) {
    return null;
  }

  const enabledToolNames = bestMatch.allowedTools.filter((toolName) => isBuiltInTool(toolName));
  const ignoredToolNames = bestMatch.allowedTools.filter((toolName) => !isBuiltInTool(toolName));
  const diagnostics =
    ignoredToolNames.length > 0
      ? [`Ignored unsupported skill tools: ${ignoredToolNames.join(", ")}`]
      : [];
  const referencedFiles = [...bestMatch.references, ...bestMatch.assets, ...bestMatch.scripts];
  const injectedPrompt = buildSkillPrompt(bestMatch, enabledToolNames);

  return resolvedSkillSchema.parse({
    skill: bestMatch,
    score: bestMatch.score,
    injectedPrompt,
    enabledToolNames,
    referencedFiles,
    diagnostics,
  });
}

// ============================================================================
// Internal Helpers
// ============================================================================

function getSkillRoots(workspaceRoot: string, options: { includeUser: boolean; includeWorkspace: boolean }): SkillRoot[] {
  const roots: SkillRoot[] = [];

  if (options.includeWorkspace) {
    roots.push(
      {
        scope: "workspace",
        client: "agent",
        basePath: join(workspaceRoot, ".agent", "skills"),
        priority: 4,
      },
      {
        scope: "workspace",
        client: "claude",
        basePath: join(workspaceRoot, ".claude", "skills"),
        priority: 3,
      },
    );
  }

  if (options.includeUser) {
    roots.push(
      {
        scope: "user",
        client: "agent",
        basePath: join(homedir(), ".agent", "skills"),
        priority: 2,
      },
      {
        scope: "user",
        client: "claude",
        basePath: join(homedir(), ".claude", "skills"),
        priority: 1,
      },
    );
  }

  return roots;
}

async function discoverSkillsInRoot(root: SkillRoot, options: DiscoveryOptions): Promise<DiscoveredSkill[]> {
  if (!existsSync(root.basePath)) {
    return [];
  }

  const skillFiles = await findSkillFiles(root.basePath);
  const loaded = await Promise.all(
    skillFiles.map((skillFilePath) => loadSkill(skillFilePath, root, options)),
  );
  return loaded.filter((entry): entry is DiscoveredSkill => entry !== null);
}

async function findSkillFiles(basePath: string): Promise<string[]> {
  const skillFiles: string[] = [];

  try {
    const entries = await readdir(basePath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(basePath, entry.name);
      if (entry.isDirectory()) {
        const directSkillFile = join(fullPath, "SKILL.md");
        if (existsSync(directSkillFile)) {
          skillFiles.push(directSkillFile);
          continue;
        }

        skillFiles.push(...(await findSkillFiles(fullPath)));
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return skillFiles;
}

async function loadSkill(
  skillFilePath: string,
  root: SkillRoot,
  options: DiscoveryOptions,
): Promise<DiscoveredSkill | null> {
  try {
    const fileContent = await readFile(skillFilePath, "utf8");
    const { frontmatter, body } = parseSkillFrontmatter(fileContent);

    // Get realpath identity for deduplication
    let identity: string;
    try {
      const realPath = await realpath(skillFilePath);
      identity = realPath;
    } catch {
      identity = resolve(skillFilePath);
    }

    const name = frontmatter?.name ?? normalizeString((frontmatter as Record<string, unknown>)?.name);
    const description = frontmatter?.description ?? normalizeString((frontmatter as Record<string, unknown>)?.description);

    if (!name || !description) {
      return null;
    }

    const skillDir = basename(skillFilePath.replace(/\/SKILL\.md$/u, ""));
    const references = await collectResourcePaths(skillFilePath, "references");
    const assets = await collectResourcePaths(skillFilePath, "assets");
    const scripts = await collectResourcePaths(skillFilePath, "scripts");

    // Extract frontmatter fields
    const allowedTools = frontmatter?.allowed_tools
      ?? normalizeAllowedTools((frontmatter as Record<string, unknown>)?.["allowed-tools"]);

    // Parse execution mode
    const executionMode: ExecutionMode = frontmatter?.execution_mode ?? "inline";

    // Parse effort level
    const effort: EffortLevel = frontmatter?.effort ?? "moderate";

    // Calculate priority
    const basePriority = root.priority;
    const effortBonus = getEffortScore(effort);
    const activationBonus = frontmatter?.activation ? 10 : 0;
    const priority = basePriority + effortBonus + activationBonus;

    const descriptor = skillDescriptorSchema.parse({
      id: `${root.scope}:${root.client}:${relative(root.basePath, skillFilePath)}`,
      name,
      description,
      license: frontmatter?.license ?? null,
      compatibility: frontmatter?.compatibility ?? null,
      metadata: (frontmatter?.metadata as Record<string, string>) ?? {},
      allowedTools,
      body: body.trim(),
      source: {
        scope: root.scope,
        client: root.client,
        basePath: root.basePath,
        skillPath: skillFilePath,
      },
      references,
      assets,
      scripts,
      directoryName: skillDir,
    });

    return {
      descriptor,
      frontmatter,
      activationConditions: frontmatter?.activation ?? null,
      executionMode,
      effort,
      priority,
      identity,
    };
  } catch {
    return null;
  }
}

async function collectResourcePaths(skillFilePath: string, directoryName: string): Promise<string[]> {
  const resourceDir = join(skillFilePath.replace(/\/SKILL\.md$/u, ""), directoryName);
  if (!existsSync(resourceDir)) {
    return [];
  }

  const files = await walkFiles(resourceDir);
  return files.map((filePath) => relative(skillFilePath.replace(/\/SKILL\.md$/u, ""), filePath));
}

async function walkFiles(root: string): Promise<string[]> {
  const files: string[] = [];

  try {
    const entries = await readdir(root, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(root, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await walkFiles(fullPath)));
      } else {
        files.push(fullPath);
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return files;
}

function scoreSkill(skill: DiscoveredSkill, normalizedQuery: string): number {
  const { descriptor, frontmatter, effort } = skill;
  const effortScore = 6 - getEffortScore(effort); // Lower effort = higher score

  const tokens = normalizedQuery
    .split(/[\s/,_-]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const haystacks = {
    name: descriptor.name.toLowerCase(),
    description: descriptor.description.toLowerCase(),
    body: descriptor.body.toLowerCase(),
    directory: basename(descriptor.source.skillPath.replace(/\/SKILL\.md$/u, "")).toLowerCase(),
    when_to_use: frontmatter?.when_to_use?.toLowerCase() ?? "",
  };

  let score = 0;

  for (const token of tokens) {
    if (haystacks.name.includes(token)) {
      score += 10;
    }
    if (haystacks.directory.includes(token)) {
      score += 8;
    }
    if (haystacks.description.includes(token)) {
      score += 5;
    }
    if (haystacks.when_to_use.includes(token)) {
      score += 4;
    }
    if (haystacks.body.includes(token)) {
      score += 2;
    }
  }

  // Exact match bonuses
  if (haystacks.name.includes(normalizedQuery)) {
    score += 12;
  }
  if (haystacks.description.includes(normalizedQuery)) {
    score += 6;
  }

  // Context activation bonus
  if (frontmatter?.activation) {
    score += 5;
  }

  return score + effortScore;
}

function toSkillMatch(skill: DiscoveredSkill, score: number): SkillMatch {
  return skillMatchSchema.parse({
    ...skill.descriptor,
    score,
  });
}

function buildSkillPrompt(skill: SkillMatch, enabledToolNames: string[]): string {
  const sections = [
    `Activated skill: ${skill.name}`,
    `Description: ${skill.description}`,
    skill.body,
  ];

  const referencedFiles = [...skill.references, ...skill.assets, ...skill.scripts];
  if (referencedFiles.length > 0) {
    sections.push(`Available skill files: ${referencedFiles.join(", ")}`);
  }
  if (enabledToolNames.length > 0) {
    sections.push(`Suggested tools from skill: ${enabledToolNames.join(", ")}`);
  }

  return sections.filter(Boolean).join("\n\n");
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeAllowedTools(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[,\s]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

export async function listSkills(workspaceRoot: string): Promise<SkillDescriptor[]> {
  const discovered = await discoverSkills({ workspaceRoot });
  return discovered.map((s) => s.descriptor).sort((a, b) => a.name.localeCompare(b.name));
}
