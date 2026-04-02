/**
 * Plan Mode
 *
 * Provides a read-only planning mode where:
 * - Write tools are denied (edit, write, bash)
 * - Users can review proposed changes before execution
 * - Mode switching is explicit (EnterPlan / ExitPlan)
 */

import { createId, nowIso } from "@omi/core";

// ============================================================================
// Types
// ============================================================================

export type PlanModeStatus = "inactive" | "planning" | "reviewing" | "approved" | "rejected";

export interface PlanStep {
  id: string;
  description: string;
  tool?: string;
  params?: Record<string, unknown>;
  status: "pending" | "approved" | "rejected" | "executed";
  reason?: string;
}

export interface PlanModeState {
  status: PlanModeStatus;
  startedAt?: string;
  reviewStartedAt?: string;
  approvedAt?: string;
  rejectedAt?: string;
  steps: PlanStep[];
  totalSteps: number;
  summary?: string;
}

export interface PlanModeConfig {
  /** Whether to auto-approve safe operations */
  allowSafeAutoApprove?: boolean;
  /** Custom approval rules */
  approvalRules?: ApprovalRule[];
}

export interface ApprovalRule {
  /** Tool name pattern (supports * wildcard) */
  toolPattern: string;
  /** Whether to auto-approve */
  autoApprove: boolean;
  /** Reason for the rule */
  reason?: string;
}

// ============================================================================
// Plan Mode Manager
// ============================================================================

export class PlanMode {
  private state: PlanModeState = {
    status: "inactive",
    steps: [],
    totalSteps: 0,
  };
  private config: Required<PlanModeConfig>;

  constructor(config: PlanModeConfig = {}) {
    this.config = {
      allowSafeAutoApprove: config.allowSafeAutoApprove ?? false,
      approvalRules: config.approvalRules ?? [],
    };
  }

  // ==========================================================================
  // Mode Lifecycle
  // ==========================================================================

  /**
   * Enter plan mode.
   */
  enter(): PlanModeState {
    if (this.state.status !== "inactive") {
      throw new Error(`Cannot enter plan mode: already in ${this.state.status} status`);
    }

    this.state = {
      status: "planning",
      startedAt: nowIso(),
      steps: [],
      totalSteps: 0,
    };

    return this.state;
  }

  /**
   * Exit plan mode without approval.
   */
  exit(): PlanModeState {
    if (this.state.status === "inactive") {
      return this.state;
    }

    this.state.status = "rejected";
    this.state.rejectedAt = nowIso();

    const result = { ...this.state };
    this.reset();
    return result;
  }

  /**
   * Start review phase.
   */
  startReview(): PlanModeState {
    if (this.state.status !== "planning") {
      throw new Error(`Cannot start review: not in planning status`);
    }

    this.state.status = "reviewing";
    this.state.reviewStartedAt = nowIso();

    return this.state;
  }

  /**
   * Approve the plan.
   */
  approve(): PlanModeState {
    if (this.state.status !== "reviewing") {
      throw new Error(`Cannot approve: not in reviewing status`);
    }

    this.state.status = "approved";
    this.state.approvedAt = nowIso();

    return this.state;
  }

  /**
   * Reject the plan.
   */
  reject(): PlanModeState {
    if (this.state.status !== "reviewing") {
      throw new Error(`Cannot reject: not in reviewing status`);
    }

    this.state.status = "rejected";
    this.state.rejectedAt = nowIso();

    return this.state;
  }

  // ==========================================================================
  // Step Management
  // ==========================================================================

  /**
   * Add a step to the plan.
   */
  addStep(description: string, tool?: string, params?: Record<string, unknown>): PlanStep {
    if (this.state.status !== "planning") {
      throw new Error(`Cannot add step: not in planning status`);
    }

    const step: PlanStep = {
      id: createId("step"),
      description,
      tool,
      params,
      status: "pending",
    };

    this.state.steps.push(step);
    this.state.totalSteps++;

    return step;
  }

  /**
   * Approve a specific step.
   */
  approveStep(stepId: string, reason?: string): PlanStep {
    const step = this.state.steps.find((s) => s.id === stepId);
    if (!step) {
      throw new Error(`Step not found: ${stepId}`);
    }

    step.status = "approved";
    step.reason = reason;

    return step;
  }

  /**
   * Reject a specific step.
   */
  rejectStep(stepId: string, reason?: string): PlanStep {
    const step = this.state.steps.find((s) => s.id === stepId);
    if (!step) {
      throw new Error(`Step not found: ${stepId}`);
    }

    step.status = "rejected";
    step.reason = reason;

    return step;
  }

  /**
   * Mark a step as executed.
   */
  markExecuted(stepId: string): PlanStep {
    const step = this.state.steps.find((s) => s.id === stepId);
    if (!step) {
      throw new Error(`Step not found: ${stepId}`);
    }

    if (step.status !== "approved") {
      throw new Error(`Cannot execute step that is not approved`);
    }

    step.status = "executed";
    return step;
  }

  /**
   * Set plan summary.
   */
  setSummary(summary: string): void {
    this.state.summary = summary;
  }

  // ==========================================================================
  // Tool Permission Checks
  // ==========================================================================

  /**
   * Check if a tool is allowed in plan mode.
   */
  isToolAllowed(toolName: string): { allowed: boolean; reason?: string } {
    // Read-only tools are always allowed
    const readOnlyTools = ["read", "ls", "grep", "find", "glob", "list_dir"];
    if (readOnlyTools.includes(toolName)) {
      return { allowed: true };
    }

    // Write tools are denied in plan mode
    const writeTools = ["edit", "write", "bash", "execute", "delete", "move"];
    if (writeTools.includes(toolName)) {
      return { allowed: false, reason: "Write tools are denied in plan mode" };
    }

    // Check custom approval rules
    for (const rule of this.config.approvalRules) {
      if (this.matchesPattern(toolName, rule.toolPattern)) {
        return {
          allowed: rule.autoApprove,
          reason: rule.reason,
        };
      }
    }

    // Default: deny
    return { allowed: false, reason: `Tool ${toolName} is not allowed in plan mode` };
  }

  /**
   * Check if a tool should auto-approve.
   */
  shouldAutoApprove(toolName: string): boolean {
    if (!this.config.allowSafeAutoApprove) {
      return false;
    }

    const safeTools = ["read", "ls", "grep", "find", "glob", "list_dir"];
    return safeTools.includes(toolName);
  }

  private matchesPattern(toolName: string, pattern: string): boolean {
    if (pattern === "*") return true;
    if (pattern.endsWith("*")) {
      const prefix = pattern.slice(0, -1);
      return toolName.startsWith(prefix);
    }
    if (pattern.startsWith("*")) {
      const suffix = pattern.slice(1);
      return toolName.endsWith(suffix);
    }
    return toolName === pattern;
  }

  // ==========================================================================
  // State Queries
  // ==========================================================================

  /**
   * Get current state.
   */
  getState(): PlanModeState {
    return { ...this.state };
  }

  /**
   * Get current status.
   */
  getStatus(): PlanModeStatus {
    return this.state.status;
  }

  /**
   * Check if plan mode is active.
   */
  isActive(): boolean {
    return this.state.status !== "inactive";
  }

  /**
   * Check if plan is approved.
   */
  isApproved(): boolean {
    return this.state.status === "approved";
  }

  /**
   * Get pending steps.
   */
  getPendingSteps(): PlanStep[] {
    return this.state.steps.filter((s) => s.status === "pending");
  }

  /**
   * Get approved steps.
   */
  getApprovedSteps(): PlanStep[] {
    return this.state.steps.filter((s) => s.status === "approved" || s.status === "executed");
  }

  /**
   * Get rejected steps.
   */
  getRejectedSteps(): PlanStep[] {
    return this.state.steps.filter((s) => s.status === "rejected");
  }

  /**
   * Get executed steps.
   */
  getExecutedSteps(): PlanStep[] {
    return this.state.steps.filter((s) => s.status === "executed");
  }

  // ==========================================================================
  // Reset
  // ==========================================================================

  private reset(): void {
    this.state = {
      status: "inactive",
      steps: [],
      totalSteps: 0,
    };
  }

  /**
   * Reset plan mode.
   */
  resetMode(): void {
    this.reset();
  }
}

// ============================================================================
// Tool Denials in Plan Mode
// ============================================================================

export const PLAN_MODE_DENIAL_CODES = {
  WRITE_TOOL_DENIED: "WRITE_TOOL_DENIED",
  TOOL_NOT_ALLOWED: "TOOL_NOT_ALLOWED",
  PLAN_NOT_APPROVED: "PLAN_NOT_APPROVED",
} as const;

export interface ToolDenial {
  toolName: string;
  code: string;
  message: string;
  planStepId?: string;
}

/**
 * Create a tool denial for plan mode.
 */
export function createPlanModeDenial(
  toolName: string,
  reason: string,
  planStepId?: string
): ToolDenial {
  return {
    toolName,
    code: PLAN_MODE_DENIAL_CODES.WRITE_TOOL_DENIED,
    message: reason,
    planStepId,
  };
}

/**
 * Check if a denial is from plan mode.
 */
export function isPlanModeDenial(denial: ToolDenial): boolean {
  return denial.code === PLAN_MODE_DENIAL_CODES.WRITE_TOOL_DENIED ||
    denial.code === PLAN_MODE_DENIAL_CODES.TOOL_NOT_ALLOWED;
}
