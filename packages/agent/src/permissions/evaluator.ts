/**
 * Permission Policy Engine - Evaluator
 *
 * Core evaluation engine that resolves permission decisions by:
 * 1. Collecting rules from all sources
 * 2. Resolving by source priority + same-source rule order
 * 3. Applying the winning rule decision
 * 4. Enforcing plan-mode read-only constraints
 */

import {
  type PermissionContext,
  type PermissionDecision,
  type PermissionEvalResult,
  type PermissionRule,
  type PermissionRuleSource,
  SOURCE_PRIORITY,
  DEFAULT_RULES,
  ruleMatchesContext,
  WRITE_TOOLS,
} from "./rules";

import type { DenialTracker } from "./tracking";

// ============================================================================
// Evaluator Configuration
// ============================================================================

export interface PermissionEvaluatorConfig {
  /** Rules from the session (highest priority). */
  sessionRules?: PermissionRule[];
  /** Rules from the project (.omi/permissions.json). */
  projectRules?: PermissionRule[];
  /** Rules from the user (~/.omi/permissions.json). */
  userRules?: PermissionRule[];
  /** Rules from managed/enterprise policies. */
  managedRules?: PermissionRule[];
  /** Custom default rules (merged with built-in defaults). */
  extraDefaultRules?: PermissionRule[];
  /** Maximum consecutive denials before escalating to error. */
  maxConsecutiveDenials?: number;
  /** Whether plan mode restrictions are enforced. */
  enforcePlanMode?: boolean;
}

export interface PermissionPreflightResult {
  decision: PermissionDecision;
  reason: string | null;
  matchedRule: PermissionRule | null;
}

// ============================================================================
// Evaluator
// ============================================================================

export class PermissionEvaluator {
  private readonly config: Required<PermissionEvaluatorConfig>;

  constructor(
    config: PermissionEvaluatorConfig,
    private readonly denialTracker?: DenialTracker,
  ) {
    this.config = {
      sessionRules: normalizeRules(config.sessionRules ?? [], "session"),
      projectRules: normalizeRules(config.projectRules ?? [], "project"),
      userRules: normalizeRules(config.userRules ?? [], "user"),
      managedRules: normalizeRules(config.managedRules ?? [], "managed"),
      extraDefaultRules: config.extraDefaultRules ?? [],
      maxConsecutiveDenials: config.maxConsecutiveDenials ?? 5,
      enforcePlanMode: config.enforcePlanMode ?? true,
    };
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Evaluate whether a tool should be allowed, asked, or denied.
   * Returns the resolved decision with matched rule information.
   */
  evaluate(context: PermissionContext): PermissionEvalResult {
    // Plan mode: force read-only
    if (this.config.enforcePlanMode && context.planMode) {
      return this.evaluatePlanMode(context);
    }

    // Collect all applicable rules
    const allRules = this.collectAllRules();
    const indexedRules = allRules.map((rule, index) => ({ rule, index }));

    // Find all matching rules.
    // Higher source priority wins; within the same source, later rules override earlier ones.
    const matched = indexedRules
      .filter(({ rule }) => ruleMatchesContext(rule, context))
      .sort((a, b) => {
        const priorityDiff = SOURCE_PRIORITY[b.rule.source] - SOURCE_PRIORITY[a.rule.source];
        if (priorityDiff !== 0) return priorityDiff;
        return b.index - a.index;
      })
      .map(({ rule }) => rule);

    if (matched.length === 0) {
      // No matching rule - use "ask" as safe default
      return {
        decision: "ask",
        matchedRule: null,
        matchedRules: [],
      };
    }

    // Check denial tracker for escalation
    const denialKey = this.buildDenialKey(context);
    const denialCount = this.denialTracker?.getDenialCount(denialKey) ?? 0;

    if (denialCount >= this.config.maxConsecutiveDenials) {
      // Escalate: deny with "too many denials" reason
      return {
        decision: "deny",
        matchedRule: matched[0] ?? null,
        matchedRules: matched,
      };
    }

    const winningRule = matched[0];
    if (winningRule.decision === "deny") {
      this.denialTracker?.recordDenial(denialKey, winningRule.description);
    }

    return {
      decision: winningRule.decision,
      matchedRule: winningRule,
      matchedRules: matched,
    };
  }

  /**
   * Pre-filter: determine which tools the model can even see.
   * Denied tools are hidden from the model to prevent it from requesting them.
   */
  filterVisibleTools(
    toolNames: string[],
    context: Omit<PermissionContext, "input">,
  ): string[] {
    return toolNames.filter((toolName) => {
      const result = this.evaluate({ ...context, toolName, input: {} });
      // Hide denied tools from model
      return result.decision !== "deny";
    });
  }

  /**
   * Pre-flight check: resolve execution-layer decision right before tool run.
   * ask/deny must be explicitly surfaced so callers can enforce approval or block execution.
   */
  preflightCheck(context: PermissionContext): PermissionPreflightResult {
    if (context.planMode && WRITE_TOOLS.has(context.toolName)) {
      return {
        decision: "deny",
        reason: `Tool '${context.toolName}' is not allowed in plan mode (read-only).`,
        matchedRule: null,
      };
    }

    const result = this.evaluate(context);

    if (result.decision === "deny") {
      return {
        decision: "deny",
        reason: `Tool '${context.toolName}' is denied by rule: ${result.matchedRule?.description ?? "unknown rule"}`,
        matchedRule: result.matchedRule,
      };
    }

    if (result.decision === "ask") {
      return {
        decision: "ask",
        reason: `Tool '${context.toolName}' requires approval before execution.`,
        matchedRule: result.matchedRule,
      };
    }

    return {
      decision: "allow",
      reason: null,
      matchedRule: result.matchedRule,
    };
  }

  // ============================================================================
  // Rule Management
  // ============================================================================

  /**
   * Add a session-scoped rule (e.g., user approved for this session).
   * Session rules take highest priority.
   */
  addSessionRule(rule: PermissionRule): void {
    this.config.sessionRules.push({ ...rule, source: "session" });
  }

  /**
   * Remove session-scoped rules for a specific tool.
   * Used when a session ends or when revoking session-level approvals.
   */
  clearSessionRules(toolName?: string): void {
    if (toolName === undefined) {
      this.config.sessionRules.length = 0;
      return;
    }
    const index = this.config.sessionRules.findIndex(
      (rule) => rule.matchers.some(
        (m) => m.type === "tool_name" && (m.pattern === toolName || m.pattern === "*"),
      ),
    );
    if (index !== -1) {
      this.config.sessionRules.splice(index, 1);
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private collectAllRules(): PermissionRule[] {
    return [
      ...this.config.sessionRules,
      ...this.config.projectRules,
      ...this.config.userRules,
      ...this.config.managedRules,
      ...DEFAULT_RULES,
      ...this.config.extraDefaultRules,
    ];
  }

  private evaluatePlanMode(context: PermissionContext): PermissionEvalResult {
    if (WRITE_TOOLS.has(context.toolName)) {
      const denyRule: PermissionRule = {
        id: "plan-mode:write-blocked",
        source: "default",
        decision: "deny",
        matchers: [{ type: "tool_name", pattern: context.toolName }],
        description: `Tool '${context.toolName}' is blocked in plan mode`,
        active: true,
      };
      return {
        decision: "deny",
        matchedRule: denyRule,
        matchedRules: [denyRule],
      };
    }

    // Read-only tools are allowed in plan mode
    return {
      decision: "allow",
      matchedRule: null,
      matchedRules: [],
    };
  }

  private buildDenialKey(context: PermissionContext): string {
    return `${context.sessionId}:${context.toolName}`;
  }
}

// ============================================================================
// Builder
// ============================================================================

export interface PermissionEvaluatorBuilder {
  withSessionRules(rules: PermissionRule[]): PermissionEvaluatorBuilder;
  withProjectRules(rules: PermissionRule[]): PermissionEvaluatorBuilder;
  withUserRules(rules: PermissionRule[]): PermissionEvaluatorBuilder;
  withManagedRules(rules: PermissionRule[]): PermissionEvaluatorBuilder;
  withDenialTracker(tracker: DenialTracker): PermissionEvaluatorBuilder;
  build(): PermissionEvaluator;
}

export function createPermissionEvaluator(
  initialConfig: PermissionEvaluatorConfig = {},
): PermissionEvaluatorBuilder {
  let config = { ...initialConfig };
  let tracker: DenialTracker | undefined;

  return {
    withSessionRules(rules) {
      config.sessionRules = normalizeRules(rules, "session");
      return this;
    },
    withProjectRules(rules) {
      config.projectRules = normalizeRules(rules, "project");
      return this;
    },
    withUserRules(rules) {
      config.userRules = normalizeRules(rules, "user");
      return this;
    },
    withManagedRules(rules) {
      config.managedRules = normalizeRules(rules, "managed");
      return this;
    },
    withDenialTracker(t: DenialTracker) {
      tracker = t;
      return this;
    },
    build() {
      return new PermissionEvaluator(config, tracker);
    },
  };
}

export type { PermissionContext, PermissionRule } from "./rules";

function normalizeRules(
  rules: PermissionRule[],
  source: PermissionRuleSource,
): PermissionRule[] {
  return rules.map((rule) => ({ ...rule, source }));
}
