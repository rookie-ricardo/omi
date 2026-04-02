/**
 * Skill Executor
 *
 * Handles skill execution with dual mode support:
 * - Inline: Execute within current context
 * - Fork: Spawn isolated context for skill execution
 */

import type { ProviderConfig, Session } from "@omi/core";
import type { ToolName } from "@omi/tools";

import {
  type ExecutionMode,
  type ModelConstraints,
  type ToolRule,
  getEffortScore,
} from "./frontmatter";
import {
  type DiscoveredSkill,
  type DiscoveryOptions,
} from "./discovery";
import {
  type LoadedSkill,
  type LoadResult,
  shouldFork,
  getModelConstraints,
  getToolRules,
  loadSkillsWithBudget,
} from "./loader";

// ============================================================================
// Types
// ============================================================================

export interface ExecutionContext {
  sessionId: string;
  workspaceRoot: string;
  prompt: string;
  providerConfig: ProviderConfig;
  enabledTools: ToolName[];
}

export interface ExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  tokensUsed: number;
  mode: ExecutionMode;
  skillName: string;
}

export interface ExecutionPlan {
  skills: LoadedSkill[];
  mode: ExecutionMode;
  contextTokens: number;
  modelOverride?: ModelConstraints;
  toolRestrictions?: ToolRule[];
}

/**
 * Skill executor for managing skill execution lifecycle.
 */
export class SkillExecutor {
  private readonly workspaceRoot: string;
  private readonly providerConfig: ProviderConfig;
  private activeForks: Map<string, ForkContext> = new Map();

  constructor(
    workspaceRoot: string,
    providerConfig: ProviderConfig,
  ) {
    this.workspaceRoot = workspaceRoot;
    this.providerConfig = providerConfig;
  }

  /**
   * Prepare execution plan from discovery results.
   */
  prepareExecutionPlan(loadResult: LoadResult): ExecutionPlan {
    const { skills, totalContextTokens } = loadResult;

    if (skills.length === 0) {
      return {
        skills: [],
        mode: "inline",
        contextTokens: 0,
      };
    }

    // Determine execution mode based on skills
    const hasForkSkill = skills.some((s) => shouldFork(s.skill));
    const mode: ExecutionMode = hasForkSkill ? "fork" : "inline";

    // Collect model overrides
    const modelConstraints = skills
      .map((s) => getModelConstraints(s.skill))
      .filter((c): c is ModelConstraints => c !== null);

    // Collect tool restrictions
    const toolRestrictions = skills
      .flatMap((s) => getToolRules(s.skill));

    return {
      skills,
      mode,
      contextTokens: totalContextTokens,
      modelOverride: modelConstraints[0] ?? undefined,
      toolRestrictions: toolRestrictions.length > 0 ? toolRestrictions : undefined,
    };
  }

  /**
   * Execute skills according to plan.
   */
  async executeSkills(
    plan: ExecutionPlan,
    context: ExecutionContext,
  ): Promise<ExecutionResult[]> {
    const results: ExecutionResult[] = [];

    if (plan.mode === "fork") {
      // Fork mode: execute each skill in isolation
      for (const skill of plan.skills) {
        if (shouldFork(skill.skill)) {
          const result = await this.executeInFork(skill, context);
          results.push(result);
        } else {
          // Execute non-fork skills inline
          const result = await this.executeInline(skill, context);
          results.push(result);
        }
      }
    } else {
      // Inline mode: execute all skills inline
      for (const skill of plan.skills) {
        const result = await this.executeInline(skill, context);
        results.push(result);
      }
    }

    return results;
  }

  /**
   * Execute a skill inline within current context.
   */
  async executeInline(skill: LoadedSkill, context: ExecutionContext): Promise<ExecutionResult> {
    try {
      const modelConstraints = getModelConstraints(skill.skill);

      // Apply model constraints if specified
      let effectiveProviderConfig = context.providerConfig;
      if (modelConstraints?.model) {
        effectiveProviderConfig = {
          ...context.providerConfig,
          model: modelConstraints.model,
        };
      }

      // Apply tool restrictions
      let effectiveTools = context.enabledTools;
      const toolRules = getToolRules(skill.skill);
      if (toolRules.length > 0) {
        effectiveTools = this.applyToolRestrictions(context.enabledTools, toolRules);
      }

      // Build enhanced prompt with skill context
      const enhancedPrompt = this.enhancePromptWithSkill(context.prompt, skill);

      return {
        success: true,
        output: enhancedPrompt,
        tokensUsed: skill.contextTokens,
        mode: "inline",
        skillName: skill.skill.descriptor.name,
      };
    } catch (error) {
      return {
        success: false,
        output: "",
        error: error instanceof Error ? error.message : String(error),
        tokensUsed: skill.contextTokens,
        mode: "inline",
        skillName: skill.skill.descriptor.name,
      };
    }
  }

  /**
   * Execute a skill in a forked (isolated) context.
   */
  async executeInFork(skill: LoadedSkill, context: ExecutionContext): Promise<ExecutionResult> {
    const forkId = `skill-fork-${Date.now()}`;

    try {
      const forkContext: ForkContext = {
        id: forkId,
        skillName: skill.skill.descriptor.name,
        startedAt: Date.now(),
        parentContext: context,
        isolated: true,
      };

      this.activeForks.set(forkId, forkContext);

      // In a real implementation, this would spawn an isolated agent
      // For now, we simulate the fork execution
      const modelConstraints = getModelConstraints(skill.skill);

      return {
        success: true,
        output: `[Fork execution: ${skill.skill.descriptor.name}]\n\nSkill context:\n${skill.injectedPrompt}`,
        tokensUsed: skill.contextTokens,
        mode: "fork",
        skillName: skill.skill.descriptor.name,
      };
    } catch (error) {
      return {
        success: false,
        output: "",
        error: error instanceof Error ? error.message : String(error),
        tokensUsed: skill.contextTokens,
        mode: "fork",
        skillName: skill.skill.descriptor.name,
      };
    } finally {
      this.activeForks.delete(forkId);
    }
  }

  /**
   * Enhance prompt with skill context.
   */
  private enhancePromptWithSkill(prompt: string, skill: LoadedSkill): string {
    return `${skill.injectedPrompt}\n\n---\n\n## Current Task\n\n${prompt}`;
  }

  /**
   * Apply tool restrictions based on skill rules.
   */
  private applyToolRestrictions(enabledTools: ToolName[], rules: ToolRule[]): ToolName[] {
    let result = [...enabledTools];

    for (const rule of rules) {
      if (rule.tool === "*") {
        // Apply to all tools
        if (rule.allow) {
          // Only allow matching tools
          result = result.filter((tool) =>
            rule.allow!.some((pattern) => toolMatchesPattern(tool, pattern)),
          );
        }
        if (rule.deny) {
          // Remove denied tools
          result = result.filter((tool) =>
            !rule.deny!.some((pattern) => toolMatchesPattern(tool, pattern)),
          );
        }
      } else {
        // Apply to specific tool
        if (rule.deny) {
          result = result.filter((tool) => tool !== rule.tool);
        }
      }
    }

    return result;
  }

  /**
   * Get active fork contexts.
   */
  getActiveForks(): string[] {
    return [...this.activeForks.keys()];
  }

  /**
   * Check if a fork is still active.
   */
  isForkActive(forkId: string): boolean {
    return this.activeForks.has(forkId);
  }

  /**
   * Terminate an active fork.
   */
  terminateFork(forkId: string): boolean {
    return this.activeForks.delete(forkId);
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

interface ForkContext {
  id: string;
  skillName: string;
  startedAt: number;
  parentContext: ExecutionContext;
  isolated: boolean;
}

function toolMatchesPattern(tool: string, pattern: string): boolean {
  try {
    const regex = new RegExp(pattern);
    return regex.test(tool);
  } catch {
    return tool.includes(pattern);
  }
}

/**
 * Check if skill execution should be deferred.
 */
export function shouldDeferExecution(skill: DiscoveredSkill): boolean {
  // Defer if skill has explicit activation conditions not yet met
  return skill.activationConditions !== null;
}

/**
 * Get execution priority for a skill.
 */
export function getExecutionPriority(skill: DiscoveredSkill): number {
  let priority = skill.priority;

  // Boost priority for fork skills (they need more resources)
  if (skill.executionMode === "fork") {
    priority += 5;
  }

  return priority;
}

/**
 * Validate skill can be executed in current context.
 */
export function canExecuteSkill(
  skill: DiscoveredSkill,
  context: {
    hasSession: boolean;
    hasWorkspace: boolean;
    availableTokens: number;
  },
): { canExecute: boolean; reason?: string } {
  // Check context requirements
  if (!context.hasWorkspace) {
    return { canExecute: false, reason: "No workspace available" };
  }

  // Check token budget
  const effortTokens = getEffortScore(skill.effort) * 1000;
  if (context.availableTokens < effortTokens) {
    return { canExecute: false, reason: "Insufficient context budget" };
  }

  return { canExecute: true };
}

/**
 * Merge skill outputs into unified result.
 */
export function mergeSkillOutputs(results: ExecutionResult[]): {
  success: boolean;
  combinedOutput: string;
  totalTokens: number;
  errors: string[];
} {
  const errors: string[] = [];
  const outputs: string[] = [];

  for (const result of results) {
    if (!result.success && result.error) {
      errors.push(`[${result.skillName}] ${result.error}`);
    } else {
      outputs.push(result.output);
    }
  }

  return {
    success: errors.length === 0,
    combinedOutput: outputs.join("\n\n---\n\n"),
    totalTokens: results.reduce((sum, r) => sum + r.tokensUsed, 0),
    errors,
  };
}
