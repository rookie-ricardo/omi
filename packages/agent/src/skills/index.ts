/**
 * Skills Module
 *
 * Skill system with the following capabilities:
 * - Skill discovery and matching
 * - Frontmatter schema validation
 * - Budget-controlled loading
 * - Dual execution modes (inline/fork)
 * - Tool permission rules
 */

// Frontmatter types and parsing
export {
  parseSkillFrontmatter,
  matchesActivationConditions,
  getEffortScore,
  type SkillFrontmatter,
  type ToolRule,
  type ActivationCondition,
  type ExecutionMode,
  type ModelConstraints,
  type EffortLevel,
  type ContextBudget,
} from "./frontmatter";

// Discovery and matching
export {
  discoverSkills,
  searchSkills,
  resolveSkillForPrompt,
  listSkills,
  legacySearchSkills,
  type DiscoveryOptions,
  type DiscoveredSkill,
} from "./discovery";

// Loading with budget control
export {
  loadSkillsWithBudget,
  loadSingleSkill,
  getModelConstraints,
  requiresSpecificModel,
  getExecutionMode,
  shouldFork,
  getToolRules,
  isCommandAllowed,
  type SkillBudgetConfig,
  type LoadedSkill,
  type LoadResult,
  type LoaderOptions,
} from "./loader";

// Execution
export {
  SkillExecutor,
  shouldDeferExecution,
  getExecutionPriority,
  canExecuteSkill,
  mergeSkillOutputs,
  type ExecutionContext,
  type ExecutionResult,
  type ExecutionPlan,
} from "./executor";
