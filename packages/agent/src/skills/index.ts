/**
 * Skills Module
 *
 * OMI keeps this as a thin adapter layer over Claude Agent SDK concepts.
 *
 * The SDK owns runtime execution semantics; this package only exposes
 * discovery, matching, and frontmatter parsing for OMI-specific adaptation.
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
  type DiscoveryOptions,
  type DiscoveredSkill,
} from "./discovery";
