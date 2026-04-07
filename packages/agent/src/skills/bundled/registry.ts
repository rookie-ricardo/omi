import {
  type SkillDescriptor,
} from "@omi/core";
import type { DiscoveredSkill } from "../discovery";
import type { SkillFrontmatter, ExecutionMode, EffortLevel } from "../frontmatter";

export type BundledSkillDefinition = {
  name: string;
  description: string;
  body: string;
  frontmatter?: Partial<SkillFrontmatter>;
  allowedTools?: string[];
  executionMode?: ExecutionMode;
  effort?: EffortLevel;
  priority?: number;
};

// Internal registry
const bundledSkills: DiscoveredSkill[] = [];

/**
 * Register a bundled skill that will be available to the agent.
 */
export function registerBundledSkill(definition: BundledSkillDefinition): void {
  const effort = definition.effort ?? "moderate";
  
  // Create a synthetic descriptor
  const descriptor: SkillDescriptor = {
    id: `bundled:agent:${definition.name}`,
    name: definition.name,
    description: definition.description,
    license: "MIT",
    compatibility: "*",
    metadata: definition.frontmatter?.metadata as Record<string, string> ?? {},
    allowedTools: definition.allowedTools ?? [],
    body: definition.body.trim(),
    source: {
      scope: "bundled",
      client: "agent",
      basePath: "memory://bundled",
      skillPath: `memory://bundled/${definition.name}.md`,
    },
    references: [],
    assets: [],
    scripts: [],
    disableModelInvocation: false,
  };

  const frontmatter: SkillFrontmatter = {
    name: definition.name,
    description: definition.description,
    ...definition.frontmatter,
  };

  const skill: DiscoveredSkill = {
    descriptor,
    frontmatter,
    activationConditions: frontmatter.activation ?? null,
    executionMode: definition.executionMode ?? "inline",
    effort,
    priority: definition.priority ?? 5, // high priority for bundled skills
    identity: descriptor.id,
  };

  bundledSkills.push(skill);
}

/**
 * Get all registered bundled skills.
 */
export function getBundledSkills(): DiscoveredSkill[] {
  return [...bundledSkills];
}

/**
 * Clear bundled skills registry (for testing).
 */
export function clearBundledSkills(): void {
  bundledSkills.length = 0;
}
