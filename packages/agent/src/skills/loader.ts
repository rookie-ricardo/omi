/**
 * Skill Loader with Budget Control
 *
 * Handles skill loading with context budget management:
 * - Token budget allocation based on context window
 * - Skill context compression when over budget
 * - Priority-based budget distribution
 */

import type { ProviderConfig } from "@omi/core";
import {
  type ResolvedSkill,
  type SkillDescriptor,
} from "@omi/core";

import { isBuiltInTool } from "@omi/tools";

import {
  type SkillFrontmatter,
  type ContextBudget,
  type ModelConstraints,
  type ToolRule,
  type ExecutionMode,
  type EffortLevel,
  getEffortScore,
} from "./frontmatter";
import { discoverSkills, type DiscoveredSkill, type DiscoveryOptions } from "./discovery";
import { createModelFromConfig } from "@omi/provider";

// ============================================================================
// Types
// ============================================================================

export interface SkillBudgetConfig {
  /** Total context window size */
  contextWindow: number;
  /** Reserved tokens for output and system */
  reservedTokens: number;
  /** Maximum percentage of context for skills */
  maxSkillBudgetPercent: number;
  /** Default priority for skills without explicit priority */
  defaultPriority: number;
}

export interface LoadedSkill {
  skill: DiscoveredSkill;
  injectedPrompt: string;
  enabledToolNames: string[];
  referencedFiles: string[];
  contextTokens: number;
  diagnostics: string[];
}

export interface LoadResult {
  skills: LoadedSkill[];
  totalContextTokens: number;
  remainingBudgetTokens: number;
  diagnostics: string[];
  exceeded: boolean;
}

export interface LoaderOptions extends DiscoveryOptions {
  /** Provider config for budget calculation */
  providerConfig?: ProviderConfig;
  /** Custom budget configuration */
  budgetConfig?: Partial<SkillBudgetConfig>;
  /** Maximum number of skills to load */
  maxSkills?: number;
}

// ============================================================================
// Default Budget Configuration
// ============================================================================

const DEFAULT_BUDGET_CONFIG: SkillBudgetConfig = {
  contextWindow: 200_000,
  reservedTokens: 30_000,
  maxSkillBudgetPercent: 0.25, // 25% of context for skills
  defaultPriority: 3,
};

/**
 * Estimate tokens for a string (rough approximation).
 */
function estimateTokens(text: string): number {
  if (!text.trim()) return 0;
  // Rough estimate: 4 characters per token
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * Estimate tokens for skill context.
 */
function estimateSkillTokens(skill: DiscoveredSkill, includeReferences: boolean): number {
  let tokens = 0;

  // Base tokens from descriptor
  tokens += estimateTokens(skill.descriptor.name);
  tokens += estimateTokens(skill.descriptor.description);
  tokens += estimateTokens(skill.descriptor.body);

  // Reference tokens
  if (includeReferences !== false) {
    tokens += skill.descriptor.references.length * 50; // ~50 tokens per reference path
    tokens += skill.descriptor.assets.length * 30;
    tokens += skill.descriptor.scripts.length * 40;
  }

  // Frontmatter tokens
  if (skill.frontmatter?.when_to_use) {
    tokens += estimateTokens(skill.frontmatter.when_to_use);
  }

  // Tool names
  tokens += skill.descriptor.allowedTools.length * 10;

  // Add overhead for formatting
  tokens = Math.ceil(tokens * 1.1);

  return tokens;
}

// ============================================================================
// Skill Loader
// ============================================================================

/**
 * Load skills with budget control.
 * Allocates context budget to skills based on priority and effort.
 */
export async function loadSkillsWithBudget(options: LoaderOptions): Promise<LoadResult> {
  const {
    providerConfig,
    budgetConfig,
    maxSkills = 5,
    ...discoveryOptions
  } = options;

  // Calculate effective budget
  const config = buildBudgetConfig(providerConfig, budgetConfig);
  const skillBudgetTokens = Math.floor(
    (config.contextWindow - config.reservedTokens) * config.maxSkillBudgetPercent,
  );

  // Discover available skills
  const discovered = await discoverSkills(discoveryOptions);

  if (discovered.length === 0) {
    return {
      skills: [],
      totalContextTokens: 0,
      remainingBudgetTokens: skillBudgetTokens,
      diagnostics: [],
      exceeded: false,
    };
  }

  // Sort by priority (higher first) and effort (lower first)
  const sorted = [...discovered].sort((a, b) => {
    if (b.priority !== a.priority) {
      return b.priority - a.priority;
    }
    return getEffortScore(a.effort) - getEffortScore(b.effort);
  });

  // Load skills within budget
  const loaded: LoadedSkill[] = [];
  let usedTokens = 0;
  const diagnostics: string[] = [];

  for (const skill of sorted) {
    if (loaded.length >= maxSkills) {
      break;
    }

    // Check context budget
    const contextBudget = skill.frontmatter?.context;
    const includeResources = contextBudget?.includeReferences ?? contextBudget?.includeAssets ?? true;

    const skillTokens = estimateSkillTokens(skill, includeResources);
    const maxTokens = contextBudget?.maxTokens ?? skillTokens;

    // Skip if single skill exceeds remaining budget
    if (skillTokens > skillBudgetTokens - usedTokens && loaded.length > 0) {
      diagnostics.push(`Skipped skill "${skill.descriptor.name}" - exceeds remaining budget`);
      continue;
    }

    // Build injected prompt
    const injectedPrompt = buildSkillPrompt(skill);
    const actualTokens = estimateTokens(injectedPrompt);

    // Check tool support
    const enabledToolNames = skill.descriptor.allowedTools.filter((toolName) => isBuiltInTool(toolName));
    const ignoredTools = skill.descriptor.allowedTools.filter((toolName) => !isBuiltInTool(toolName));

    if (ignoredTools.length > 0) {
      diagnostics.push(`Skill "${skill.descriptor.name}": ignored unsupported tools: ${ignoredTools.join(", ")}`);
    }

    // Add to loaded skills
    loaded.push({
      skill,
      injectedPrompt,
      enabledToolNames,
      referencedFiles: [...skill.descriptor.references, ...skill.descriptor.assets, ...skill.descriptor.scripts],
      contextTokens: actualTokens,
      diagnostics: [],
    });

    usedTokens += actualTokens;

    // Stop if budget exceeded
    if (usedTokens >= skillBudgetTokens) {
      break;
    }
  }

  const exceeded = usedTokens > skillBudgetTokens;

  return {
    skills: loaded,
    totalContextTokens: usedTokens,
    remainingBudgetTokens: Math.max(0, skillBudgetTokens - usedTokens),
    diagnostics,
    exceeded,
  };
}

/**
 * Load a single skill with budget check.
 */
export async function loadSingleSkill(
  workspaceRoot: string,
  skillName: string,
  options?: Partial<LoaderOptions>,
): Promise<LoadedSkill | null> {
  const discovered = await discoverSkills({
    workspaceRoot,
    ...options,
  });

  const skill = discovered.find(
    (s) =>
      s.descriptor.name.toLowerCase() === skillName.toLowerCase() ||
      s.descriptor.id.includes(skillName),
  );

  if (!skill) {
    return null;
  }

  const injectedPrompt = buildSkillPrompt(skill);
  const enabledToolNames = skill.descriptor.allowedTools.filter((toolName) => isBuiltInTool(toolName));

  return {
    skill,
    injectedPrompt,
    enabledToolNames,
    referencedFiles: [...skill.descriptor.references, ...skill.descriptor.assets, ...skill.descriptor.scripts],
    contextTokens: estimateTokens(injectedPrompt),
    diagnostics: [],
  };
}

// ============================================================================
// Budget Configuration
// ============================================================================

function buildBudgetConfig(
  providerConfig: ProviderConfig | undefined,
  overrides: Partial<SkillBudgetConfig> | undefined,
): SkillBudgetConfig {
  const baseConfig = { ...DEFAULT_BUDGET_CONFIG };

  if (providerConfig) {
    try {
      const model = createModelFromConfig(providerConfig);
      baseConfig.contextWindow = model.contextWindow ?? 200_000;
    } catch {
      // Use default context window
    }
  }

  return { ...baseConfig, ...overrides };
}

// ============================================================================
// Prompt Building
// ============================================================================

function buildSkillPrompt(skill: DiscoveredSkill): string {
  const { descriptor, frontmatter } = skill;
  const sections: string[] = [];

  // Skill header
  sections.push(`# Skill: ${descriptor.name}`);
  sections.push(`\n**Description:** ${descriptor.description}`);

  // When to use guidance
  if (frontmatter?.when_to_use) {
    sections.push(`\n**When to Use:** ${frontmatter.when_to_use}`);
  }

  // Effort level
  if (frontmatter?.effort) {
    sections.push(`\n**Effort Level:** ${frontmatter.effort}`);
  }

  // Skill body
  sections.push(`\n---\n\n${descriptor.body}`);

  // Available resources
  const resources: string[] = [];
  if (descriptor.references.length > 0) {
    resources.push(`References: ${descriptor.references.join(", ")}`);
  }
  if (descriptor.assets.length > 0) {
    resources.push(`Assets: ${descriptor.assets.join(", ")}`);
  }
  if (descriptor.scripts.length > 0) {
    resources.push(`Scripts: ${descriptor.scripts.join(", ")}`);
  }
  if (resources.length > 0) {
    sections.push(`\n---\n\n**Available Resources:**\n${resources.join("\n")}`);
  }

  // Suggested tools
  if (descriptor.allowedTools.length > 0) {
    const supportedTools = descriptor.allowedTools.filter((t) => isBuiltInTool(t));
    if (supportedTools.length > 0) {
      sections.push(`\n**Suggested Tools:** ${supportedTools.join(", ")}`);
    }
  }

  return sections.filter(Boolean).join("\n");
}

// ============================================================================
// Model Constraints
// ============================================================================

/**
 * Extract model constraints from skill frontmatter.
 */
export function getModelConstraints(skill: DiscoveredSkill): ModelConstraints | null {
  return skill.frontmatter?.model ?? null;
}

/**
 * Check if skill requires specific model.
 */
export function requiresSpecificModel(skill: DiscoveredSkill): boolean {
  return skill.frontmatter?.model?.model !== undefined;
}

/**
 * Get execution mode for skill.
 */
export function getExecutionMode(skill: DiscoveredSkill): ExecutionMode {
  return skill.executionMode ?? "inline";
}

/**
 * Check if skill should run in fork mode.
 */
export function shouldFork(skill: DiscoveredSkill): boolean {
  return skill.executionMode === "fork";
}

// ============================================================================
// Tool Permission Rules
// ============================================================================

/**
 * Get tool permission rules for skill.
 */
export function getToolRules(skill: DiscoveredSkill): ToolRule[] {
  return skill.frontmatter?.tool_rules ?? [];
}

/**
 * Check if a command is allowed by skill's tool rules.
 */
export function isCommandAllowed(skill: DiscoveredSkill, command: string): boolean {
  const rules = getToolRules(skill);
  if (rules.length === 0) return true;

  for (const rule of rules) {
    if (rule.tool === "bash" || rule.tool === "*") {
      if (rule.allow) {
        return rule.allow.some((pattern) => commandMatchesPattern(command, pattern));
      }
      if (rule.deny) {
        return !rule.deny.some((pattern) => commandMatchesPattern(command, pattern));
      }
    }
  }

  return true;
}

function commandMatchesPattern(command: string, pattern: string): boolean {
  try {
    const regex = new RegExp(pattern);
    return regex.test(command);
  } catch {
    // If not a valid regex, treat as literal substring
    return command.includes(pattern);
  }
}
