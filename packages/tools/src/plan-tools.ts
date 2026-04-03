/**
 * Plan Mode Tools
 *
 * Tools for entering/exiting plan mode and managing plan approval.
 * Note: These tools depend on external PlanMode implementation.
 */

import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@mariozechner/pi-ai";
import type { TextContent } from "@mariozechner/pi-ai";

// ============================================================================
// Tool Names
// ============================================================================

export const ENTER_PLAN_TOOL = "plan.enter";
export const EXIT_PLAN_TOOL = "plan.exit";
export const APPROVE_PLAN_TOOL = "approve_plan";
export const REJECT_PLAN_TOOL = "reject_plan";
export const LIST_PLAN_STEPS_TOOL = "list_plan_steps";

// ============================================================================
// Tool Schemas
// ============================================================================

export const enterPlanSchema = Type.Object({
  reason: Type.Optional(
    Type.String({ description: "Reason for entering plan mode" })
  ),
});

export const exitPlanSchema = Type.Object({
  discard: Type.Optional(
    Type.Boolean({
      description: "Whether to discard the current plan (default: true)",
    })
  ),
});

export const approvePlanSchema = Type.Object({
  stepIds: Type.Optional(
    Type.Array(Type.String(), {
      description: "Specific step IDs to approve (default: all pending)",
    })
  ),
  reason: Type.Optional(
    Type.String({ description: "Reason for approval" })
  ),
});

export const rejectPlanSchema = Type.Object({
  stepIds: Type.Optional(
    Type.Array(Type.String(), {
      description: "Specific step IDs to reject (default: all)",
    })
  ),
  reason: Type.Optional(
    Type.String({ description: "Reason for rejection" })
  ),
});

export const listPlanStepsSchema = Type.Object({
  filter: Type.Optional(
    Type.Union([
      Type.Literal("all"),
      Type.Literal("pending"),
      Type.Literal("approved"),
      Type.Literal("rejected"),
    ], { description: "Filter by step status" })
  ),
});

// ============================================================================
// Tool Implementations
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface PlanToolsConfig {
  /** Plan mode instance */
  planMode: any;
  /** Default config for new plan mode */
  defaultConfig?: any;
}

/**
 * Create Enter Plan tool.
 */
export function createEnterPlanTool(config: PlanToolsConfig): AgentTool<typeof enterPlanSchema> {
  return {
    name: ENTER_PLAN_TOOL,
    label: ENTER_PLAN_TOOL,
    description: "Enter plan mode. In plan mode, write operations are read-only and changes must be approved by the user before execution.",
    parameters: enterPlanSchema,
    execute: async (toolCallId: string, params: unknown) => {
      const { reason } = params as { reason?: string };

      try {
        if (config.planMode.isActive()) {
          return {
            content: [{
              type: "text" as const,
              text: "Already in plan mode.",
            } as TextContent],
            details: { status: config.planMode.getStatus() },
          };
        }

        config.planMode.enter();

        const state = config.planMode.getState();
        return {
          content: [{
            type: "text" as const,
            text: `Entered plan mode. ${reason ? `Reason: ${reason}` : ""}\nStatus: ${state.status}`,
          } as TextContent],
          details: state,
        };
      } catch (error) {
        return {
          content: [{
            type: "text" as const,
            text: `Error entering plan mode: ${error instanceof Error ? error.message : String(error)}`,
          } as TextContent],
          details: { error: String(error) },
        };
      }
    },
  };
}

/**
 * Create Exit Plan tool.
 */
export function createExitPlanTool(config: PlanToolsConfig): AgentTool<typeof exitPlanSchema> {
  return {
    name: EXIT_PLAN_TOOL,
    label: EXIT_PLAN_TOOL,
    description: "Exit plan mode. Discards the current plan and returns to normal execution.",
    parameters: exitPlanSchema,
    execute: async (toolCallId: string, params: unknown) => {
      const { discard = true } = params as { discard?: boolean };

      try {
        if (!config.planMode.isActive()) {
          return {
            content: [{
              type: "text" as const,
              text: "Not in plan mode.",
            } as TextContent],
            details: { status: "inactive" },
          };
        }

        if (discard) {
          const state = config.planMode.exit();
          return {
            content: [{
              type: "text" as const,
              text: `Plan mode exited. Plan was discarded.\nTotal steps: ${state.totalSteps}`,
            } as TextContent],
            details: state,
          };
        } else {
          // Just exit without discarding
          const state = config.planMode.getState();
          return {
            content: [{
              type: "text" as const,
              text: `Plan mode status: ${state.status}`,
            } as TextContent],
            details: state,
          };
        }
      } catch (error) {
        return {
          content: [{
            type: "text" as const,
            text: `Error exiting plan mode: ${error instanceof Error ? error.message : String(error)}`,
          } as TextContent],
          details: { error: String(error) },
        };
      }
    },
  };
}

/**
 * Create Approve Plan tool.
 */
export function createApprovePlanTool(config: PlanToolsConfig): AgentTool<typeof approvePlanSchema> {
  return {
    name: APPROVE_PLAN_TOOL,
    label: APPROVE_PLAN_TOOL,
    description: "Approve the current plan or specific steps. After approval, write operations will be allowed.",
    parameters: approvePlanSchema,
    execute: async (toolCallId: string, params: unknown) => {
      const { stepIds, reason } = params as { stepIds?: string[]; reason?: string };

      try {
        const state = config.planMode.getState();

        if (state.status === "planning") {
          // Start review phase
          config.planMode.startReview();
        }

        if (state.status !== "reviewing") {
          return {
            content: [{
              type: "text" as const,
              text: `Cannot approve: plan is in ${state.status} status`,
            } as TextContent],
            details: { status: state.status },
          };
        }

        // Approve specific steps or all
        if (stepIds && stepIds.length > 0) {
          for (const stepId of stepIds) {
            config.planMode.approveStep(stepId, reason);
          }
        } else {
          config.planMode.approve();
        }

        const newState = config.planMode.getState();
        return {
          content: [{
            type: "text" as const,
            text: `Plan ${stepIds ? "steps" : "approved"}. Ready to execute.`,
          } as TextContent],
          details: newState,
        };
      } catch (error) {
        return {
          content: [{
            type: "text" as const,
            text: `Error approving plan: ${error instanceof Error ? error.message : String(error)}`,
          } as TextContent],
          details: { error: String(error) },
        };
      }
    },
  };
}

/**
 * Create Reject Plan tool.
 */
export function createRejectPlanTool(config: PlanToolsConfig): AgentTool<typeof rejectPlanSchema> {
  return {
    name: REJECT_PLAN_TOOL,
    label: REJECT_PLAN_TOOL,
    description: "Reject the current plan or specific steps.",
    parameters: rejectPlanSchema,
    execute: async (toolCallId: string, params: unknown) => {
      const { stepIds, reason } = params as { stepIds?: string[]; reason?: string };

      try {
        const state = config.planMode.getState();

        if (state.status !== "reviewing" && state.status !== "planning") {
          return {
            content: [{
              type: "text" as const,
              text: `Cannot reject: plan is in ${state.status} status`,
            } as TextContent],
            details: { status: state.status },
          };
        }

        // Reject specific steps or all
        if (stepIds && stepIds.length > 0) {
          for (const stepId of stepIds) {
            config.planMode.rejectStep(stepId, reason);
          }
          return {
            content: [{
              type: "text" as const,
              text: `${stepIds.length} step(s) rejected.`,
            } as TextContent],
            details: config.planMode.getState(),
          };
        } else {
          const finalState = config.planMode.reject();
          return {
            content: [{
              type: "text" as const,
              text: `Plan rejected and discarded.\n${reason ? `Reason: ${reason}` : ""}`,
            } as TextContent],
            details: finalState,
          };
        }
      } catch (error) {
        return {
          content: [{
            type: "text" as const,
            text: `Error rejecting plan: ${error instanceof Error ? error.message : String(error)}`,
          } as TextContent],
          details: { error: String(error) },
        };
      }
    },
  };
}

/**
 * Create List Plan Steps tool.
 */
export function createListPlanStepsTool(config: PlanToolsConfig): AgentTool<typeof listPlanStepsSchema> {
  return {
    name: LIST_PLAN_STEPS_TOOL,
    label: LIST_PLAN_STEPS_TOOL,
    description: "List the steps in the current plan.",
    parameters: listPlanStepsSchema,
    execute: async (toolCallId: string, params: unknown) => {
      const { filter = "all" } = params as { filter?: "all" | "pending" | "approved" | "rejected" };

      try {
        const state = config.planMode.getState();

        if (!config.planMode.isActive()) {
          return {
            content: [{
              type: "text" as const,
              text: "Not in plan mode.",
            } as TextContent],
            details: { status: "inactive" },
          };
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let steps: any[];
        switch (filter) {
          case "pending":
            steps = config.planMode.getPendingSteps?.() ?? [];
            break;
          case "approved":
            steps = config.planMode.getApprovedSteps?.() ?? [];
            break;
          case "rejected":
            steps = config.planMode.getRejectedSteps?.() ?? [];
            break;
          default:
            steps = state.steps ?? [];
        }

        const lines: string[] = [`Plan Status: ${state.status}`];
        lines.push(`Total Steps: ${state.totalSteps}`);
        lines.push("");

        for (const step of steps) {
          lines.push(`## ${step.id.slice(0, 8)} [${step.status}]`);
          lines.push(`- ${step.description}`);
          if (step.tool) {
            lines.push(`- Tool: ${step.tool}`);
          }
          if (step.reason) {
            lines.push(`- Reason: ${step.reason}`);
          }
          lines.push("");
        }

        return {
          content: [{
            type: "text" as const,
            text: lines.join("\n"),
          } as TextContent],
          details: { status: state.status, steps, totalSteps: state.totalSteps },
        };
      } catch (error) {
        return {
          content: [{
            type: "text" as const,
            text: `Error listing plan steps: ${error instanceof Error ? error.message : String(error)}`,
          } as TextContent],
          details: { error: String(error) },
        };
      }
    },
  };
}

/**
 * Create all plan mode tools.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createPlanTools(config: PlanToolsConfig): AgentTool<any>[] {
  return [
    createEnterPlanTool(config) as AgentTool<any>,
    createExitPlanTool(config) as AgentTool<any>,
    createApprovePlanTool(config) as AgentTool<any>,
    createRejectPlanTool(config) as AgentTool<any>,
    createListPlanStepsTool(config) as AgentTool<any>,
  ];
}
