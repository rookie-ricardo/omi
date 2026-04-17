/**
 * Skill Frontmatter Schema
 *
 * Defines the schema for SKILL.md frontmatter with extended properties:
 * - when_to_use: Conditions for skill activation
 * - allowed_tools: Tool whitelist for skill scope
 * - model: Model constraints for skill execution
 * - effort: Estimated complexity level
 * - context: Context requirements and budget
 */

import { z } from "zod";

// ============================================================================
// Frontmatter Schema
// ============================================================================

/**
 * Tool permission rule for skill scope.
 * Supports glob patterns for tool names.
 */
export const toolRuleSchema = z.object({
  tool: z.string(),
  allow: z.array(z.string()).optional(),
  deny: z.array(z.string()).optional(),
  maxCalls: z.number().optional(),
});

/**
 * Skill activation condition schema.
 */
export const activationConditionSchema = z.object({
  /** Glob patterns for file paths that trigger this skill */
  paths: z.array(z.string()).optional(),
  /** Regex patterns for matching prompts */
  promptPatterns: z.array(z.string()).optional(),
  /** Environment variables that must be set */
  envVars: z.record(z.string(), z.string()).optional(),
  /** Git state conditions */
  gitState: z.object({
    branch: z.string().optional(),
    dirty: z.boolean().optional(),
    hasConflicts: z.boolean().optional(),
  }).optional(),
});

/**
 * Skill execution mode.
 * - inline: Execute within current context
 * - fork: Spawn isolated context for skill execution
 */
export const executionModeSchema = z.enum(["inline", "fork"]);

/**
 * Model constraints for skill execution.
 */
export const modelConstraintsSchema = z.object({
  /** Preferred model for this skill */
  model: z.string().optional(),
  /** Fallback models if preferred is unavailable */
  fallbackModels: z.array(z.string()).optional(),
  /** Maximum tokens allowed for skill context */
  maxTokens: z.number().optional(),
  /** Reasoning effort level */
  effort: z.enum(["off", "low", "medium", "high"]).optional(),
  /** Custom system prompt override */
  systemPrompt: z.string().optional(),
});

/**
 * Effort level for skill complexity estimation.
 */
export const effortLevelSchema = z.enum(["trivial", "simple", "moderate", "complex", "epic"]);

/**
 * Context budget configuration for skill.
 */
export const contextBudgetSchema = z.object({
  /** Maximum tokens for skill-injected context */
  maxTokens: z.number().optional(),
  /** Priority weight for context budget allocation (higher = more budget) */
  priority: z.number().optional(),
  /** Whether to compress skill context if over budget */
  compressOnBudget: z.boolean().optional(),
  /** Resources to include in skill context */
  includeReferences: z.boolean().optional(),
  includeAssets: z.boolean().optional(),
  includeScripts: z.boolean().optional(),
});

/**
 * Complete skill frontmatter schema.
 * Extends base skill properties with advanced features.
 */
export const skillFrontmatterSchema = z.object({
  /** Skill name (required) */
  name: z.string().min(1),
  /** Skill description (required) */
  description: z.string().min(1),
  /** When to use this skill (optional guidance) */
  when_to_use: z.string().optional(),
  /** Tool whitelist for this skill scope */
  allowed_tools: z.array(z.string()).optional(),
  /** Tool permission rules with command-level allow rules */
  tool_rules: z.array(toolRuleSchema).optional(),
  /** Model constraints for skill execution */
  model: modelConstraintsSchema.optional(),
  /** Effort level estimation */
  effort: effortLevelSchema.optional(),
  /** Context budget configuration */
  context: contextBudgetSchema.optional(),
  /** Activation conditions for automatic triggering */
  activation: activationConditionSchema.optional(),
  /** Execution mode: inline or fork */
  execution_mode: executionModeSchema.optional(),
  /** Legacy compatibility field */
  compatibility: z.string().optional(),
  /** License information */
  license: z.string().optional(),
  /** Custom metadata */
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export type ToolRule = z.infer<typeof toolRuleSchema>;
export type ActivationCondition = z.infer<typeof activationConditionSchema>;
export type ExecutionMode = z.infer<typeof executionModeSchema>;
export type ModelConstraints = z.infer<typeof modelConstraintsSchema>;
export type EffortLevel = z.infer<typeof effortLevelSchema>;
export type ContextBudget = z.infer<typeof contextBudgetSchema>;
export type SkillFrontmatter = z.infer<typeof skillFrontmatterSchema>;

// ============================================================================
// Parsing Utilities
// ============================================================================

import YAML from "yaml";

const FRONTMATTER_PATTERN = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/;

/**
 * Parse SKILL.md frontmatter and body.
 */
export function parseSkillFrontmatter(content: string): {
  frontmatter: SkillFrontmatter | null;
  body: string;
} {
  const match = content.match(FRONTMATTER_PATTERN);
  if (!match) {
    return { frontmatter: null, body: content };
  }

  const [, frontmatterText, body] = match;
  try {
    // Try JSON first
    const parsed = JSON.parse(frontmatterText);
    const result = skillFrontmatterSchema.safeParse(parsed);
    if (result.success) {
      return { frontmatter: result.data, body: body.trim() };
    }
  } catch {
    // Try YAML parsing if JSON fails
    try {
      const yaml = YAML.parse(frontmatterText);
      if (yaml && typeof yaml === "object") {
        const result = skillFrontmatterSchema.safeParse(yaml);
        if (result.success) {
          return { frontmatter: result.data, body: body.trim() };
        }
      }
    } catch {
      // Fall through to return null
    }
  }

  return { frontmatter: null, body: content };
}

// ============================================================================
// Validation Utilities
// ============================================================================

/**
 * Validate activation conditions against current context.
 */
export function matchesActivationConditions(
  conditions: ActivationCondition,
  context: {
    prompt: string;
    filePaths?: string[];
    envVars?: Record<string, string>;
    gitBranch?: string;
    gitDirty?: boolean;
    gitHasConflicts?: boolean;
  },
): boolean {
  // Check path patterns
  if (conditions.paths && conditions.paths.length > 0 && context.filePaths) {
    const matchesPath = context.filePaths.some((filePath) =>
      conditions.paths!.some((pattern) => matchGlobPattern(filePath, pattern)),
    );
    if (!matchesPath) return false;
  }

  // Check prompt patterns
  if (conditions.promptPatterns && conditions.promptPatterns.length > 0) {
    const matchesPrompt = conditions.promptPatterns.some((pattern) =>
      new RegExp(pattern, "i").test(context.prompt),
    );
    if (!matchesPrompt) return false;
  }

  // Check environment variables
  if (conditions.envVars && context.envVars) {
    for (const [key, expectedValue] of Object.entries(conditions.envVars)) {
      const actualValue = context.envVars[key];
      if (actualValue !== expectedValue) return false;
    }
  }

  // Check git state
  if (conditions.gitState) {
    if (conditions.gitState.branch && context.gitBranch !== conditions.gitState.branch) {
      return false;
    }
    if (conditions.gitState.dirty !== undefined && context.gitDirty !== conditions.gitState.dirty) {
      return false;
    }
    if (conditions.gitState.hasConflicts !== undefined && context.gitHasConflicts !== conditions.gitState.hasConflicts) {
      return false;
    }
  }

  return true;
}

/**
 * Match a glob pattern against a path.
 * Supports: *, **, ?, [abc], [a-z]
 */
function matchGlobPattern(path: string, pattern: string): boolean {
  // Convert glob pattern to regex
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // Escape special regex chars
    .replace(/\*\*/g, ".*") // ** matches anything
    .replace(/\*/g, "[^/]*") // * matches anything except /
    .replace(/\?/g, "."); // ? matches single char

  try {
    return new RegExp(`^${regexPattern}$`).test(path);
  } catch {
    return false;
  }
}

/**
 * Get effort level score for priority calculations.
 */
export function getEffortScore(effort: EffortLevel): number {
  const scores: Record<EffortLevel, number> = {
    trivial: 1,
    simple: 2,
    moderate: 3,
    complex: 5,
    epic: 8,
  };
  return scores[effort] ?? 3;
}
