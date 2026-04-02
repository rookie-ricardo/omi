import { homedir } from "node:os";
import { basename, join, relative } from "node:path";
import { access, readdir, readFile, stat } from "node:fs/promises";

import {
  type ResolvedSkill,
  type SkillDescriptor,
  type SkillMatch,
  resolvedSkillSchema,
  skillDescriptorSchema,
  skillMatchSchema,
} from "@omi/core";

import { isBuiltInTool } from "@omi/tools";
import YAML from "yaml";

interface SkillRoot {
  scope: "workspace" | "user";
  client: "agent" | "claude";
  basePath: string;
  priority: number;
}

const FRONTMATTER_PATTERN = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/;

export async function listSkills(workspaceRoot: string): Promise<SkillDescriptor[]> {
  const roots = getSkillRoots(workspaceRoot);
  const discovered = (
    await Promise.all(roots.map(async (root) => discoverSkillsInRoot(root)))
  ).flat();

  const deduped = new Map<string, { descriptor: SkillDescriptor; priority: number }>();
  for (const skill of discovered) {
    const key = skill.name.toLowerCase();
    const current = deduped.get(key);
    const priority = computeSourcePriority(skill);
    if (!current || priority > current.priority) {
      deduped.set(key, { descriptor: skill, priority });
    }
  }

  return [...deduped.values()]
    .map((entry) => entry.descriptor)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function searchSkills(
  workspaceRoot: string,
  query: string,
): Promise<SkillMatch[]> {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [];
  }

  const skills = await listSkills(workspaceRoot);
  const matches = skills
    .map((skill) => ({ skill, score: scoreSkill(skill, normalizedQuery) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      const sourceDelta = computeSourcePriority(left.skill) - computeSourcePriority(right.skill);
      if (sourceDelta !== 0) {
        return -sourceDelta;
      }
      return left.skill.id.localeCompare(right.skill.id);
    })
    .map(({ skill, score }) =>
      skillMatchSchema.parse({
        ...skill,
        score,
      }),
    );

  return matches;
}

export async function resolveSkillForPrompt(
  workspaceRoot: string,
  prompt: string,
): Promise<ResolvedSkill | null> {
  const [bestMatch] = await searchSkills(workspaceRoot, prompt);
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

function getSkillRoots(workspaceRoot: string): SkillRoot[] {
  return [
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
  ];
}

async function discoverSkillsInRoot(root: SkillRoot): Promise<SkillDescriptor[]> {
  if (!(await exists(root.basePath))) {
    return [];
  }

  const skillFiles = await findSkillFiles(root.basePath);
  const loaded = await Promise.all(skillFiles.map((skillFilePath) => loadSkill(skillFilePath, root)));
  return loaded.filter((entry): entry is SkillDescriptor => entry !== null);
}

async function findSkillFiles(basePath: string): Promise<string[]> {
  const entries = await readdir(basePath, { withFileTypes: true });
  const skillFiles: string[] = [];

  for (const entry of entries) {
    const fullPath = join(basePath, entry.name);
    if (entry.isDirectory()) {
      const directSkillFile = join(fullPath, "SKILL.md");
      if (await exists(directSkillFile)) {
        skillFiles.push(directSkillFile);
        continue;
      }

      skillFiles.push(...(await findSkillFiles(fullPath)));
    }
  }

  return skillFiles;
}

async function loadSkill(skillFilePath: string, root: SkillRoot): Promise<SkillDescriptor | null> {
  const fileContent = await readFile(skillFilePath, "utf8");
  const match = fileContent.match(FRONTMATTER_PATTERN);
  if (!match) {
    return null;
  }

  const [, frontmatterText, body] = match;
  const frontmatter = YAML.parse(frontmatterText ?? "");
  if (!frontmatter || typeof frontmatter !== "object") {
    return null;
  }

  const name = normalizeString(frontmatter.name);
  const description = normalizeString(frontmatter.description);
  if (!name || !description) {
    return null;
  }

  const skillDir = basename(skillFilePath.replace(/\/SKILL\.md$/u, ""));
  const references = await collectResourcePaths(skillFilePath, "references");
  const assets = await collectResourcePaths(skillFilePath, "assets");
  const scripts = await collectResourcePaths(skillFilePath, "scripts");

  return skillDescriptorSchema.parse({
    id: `${root.scope}:${root.client}:${relative(root.basePath, skillFilePath)}`,
    name,
    description,
    license: normalizeNullableString(frontmatter.license),
    compatibility: normalizeNullableString(frontmatter.compatibility),
    metadata: collectMetadata(frontmatter),
    allowedTools: normalizeAllowedTools(frontmatter["allowed-tools"]),
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
}

async function collectResourcePaths(skillFilePath: string, directoryName: string): Promise<string[]> {
  const resourceDir = join(skillFilePath.replace(/\/SKILL\.md$/u, ""), directoryName);
  if (!(await exists(resourceDir))) {
    return [];
  }

  const files = await walkFiles(resourceDir);
  return files.map((filePath) => relative(skillFilePath.replace(/\/SKILL\.md$/u, ""), filePath));
}

async function walkFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(fullPath)));
      continue;
    }
    files.push(fullPath);
  }

  return files;
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

function scoreSkill(skill: SkillDescriptor, normalizedQuery: string): number {
  const tokens = normalizedQuery
    .split(/[\s/,_-]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const haystacks = {
    name: skill.name.toLowerCase(),
    description: skill.description.toLowerCase(),
    body: skill.body.toLowerCase(),
    directory: basename(skill.source.skillPath.replace(/\/SKILL\.md$/u, "")).toLowerCase(),
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
    if (haystacks.body.includes(token)) {
      score += 2;
    }
  }

  if (haystacks.name.includes(normalizedQuery)) {
    score += 12;
  }
  if (haystacks.description.includes(normalizedQuery)) {
    score += 6;
  }

  return score;
}

function computeSourcePriority(skill: SkillDescriptor): number {
  return skill.source.scope === "workspace"
    ? skill.source.client === "agent"
      ? 4
      : 3
    : skill.source.client === "agent"
      ? 2
      : 1;
}

function collectMetadata(frontmatter: Record<string, unknown>): Record<string, string> {
  const metadata: Record<string, string> = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    if (["name", "description", "license", "compatibility", "allowed-tools"].includes(key)) {
      continue;
    }
    if (typeof value === "string") {
      metadata[key] = value;
    }
  }
  return metadata;
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

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNullableString(value: unknown): string | null {
  const normalized = normalizeString(value);
  return normalized || null;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
