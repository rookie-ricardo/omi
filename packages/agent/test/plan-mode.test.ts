/**
 * Plan Mode Tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  PlanMode,
  createPlanModeDenial,
  isPlanModeDenial,
  type PlanStep,
} from "../src/modes/plan-mode";

describe("PlanMode", () => {
  let planMode: PlanMode;

  beforeEach(() => {
    planMode = new PlanMode();
  });

  describe("enter/exit", () => {
    it("should enter plan mode", () => {
      const state = planMode.enter();

      expect(state.status).toBe("planning");
      expect(state.startedAt).toBeDefined();
      expect(state.steps).toEqual([]);
    });

    it("should throw when entering active mode", () => {
      planMode.enter();
      expect(() => planMode.enter()).toThrow();
    });

    it("should exit inactive mode without error", () => {
      const state = planMode.exit();
      expect(state.status).toBe("inactive");
    });

    it("should exit and reset state", () => {
      planMode.enter();
      planMode.addStep("Test step", "bash", { cmd: "echo test" });
      const state = planMode.exit();

      expect(state.status).toBe("rejected");
      expect(planMode.getStatus()).toBe("inactive");
    });
  });

  describe("steps", () => {
    beforeEach(() => {
      planMode.enter();
    });

    it("should add steps", () => {
      const step = planMode.addStep("Test step", "bash", { cmd: "echo test" });

      expect(step.id).toBeDefined();
      expect(step.description).toBe("Test step");
      expect(step.tool).toBe("bash");
      expect(step.params).toEqual({ cmd: "echo test" });
      expect(step.status).toBe("pending");
    });

    it("should approve steps", () => {
      const step = planMode.addStep("Test step");
      const approved = planMode.approveStep(step.id, "Looks good");

      expect(approved.status).toBe("approved");
      expect(approved.reason).toBe("Looks good");
    });

    it("should reject steps", () => {
      const step = planMode.addStep("Test step");
      const rejected = planMode.rejectStep(step.id, "Too risky");

      expect(rejected.status).toBe("rejected");
      expect(rejected.reason).toBe("Too risky");
    });

    it("should mark executed steps", () => {
      const step = planMode.addStep("Test step");
      planMode.approveStep(step.id);
      const executed = planMode.markExecuted(step.id);

      expect(executed.status).toBe("executed");
    });

    it("should not execute unapproved steps", () => {
      const step = planMode.addStep("Test step");
      expect(() => planMode.markExecuted(step.id)).toThrow();
    });

    it("should filter steps by status", () => {
      const step1 = planMode.addStep("Step 1");
      const step2 = planMode.addStep("Step 2");
      planMode.approveStep(step1.id);

      expect(planMode.getPendingSteps()).toHaveLength(1);
      expect(planMode.getApprovedSteps()).toHaveLength(1);
      expect(planMode.getRejectedSteps()).toHaveLength(0);
      expect(planMode.getExecutedSteps()).toHaveLength(0);
    });
  });

  describe("review", () => {
    beforeEach(() => {
      planMode.enter();
    });

    it("should start review phase", () => {
      planMode.startReview();
      expect(planMode.getStatus()).toBe("reviewing");
    });

    it("should approve plan in review", () => {
      planMode.startReview();
      planMode.approve();
      expect(planMode.getStatus()).toBe("approved");
      expect(planMode.isApproved()).toBe(true);
    });

    it("should reject plan in review", () => {
      planMode.startReview();
      planMode.reject();
      expect(planMode.getStatus()).toBe("rejected");
    });
  });

  describe("tool permission", () => {
    beforeEach(() => {
      planMode.enter();
    });

    it("should allow read-only tools", () => {
      expect(planMode.isToolAllowed("read")).toEqual({ allowed: true });
      expect(planMode.isToolAllowed("ls")).toEqual({ allowed: true });
      expect(planMode.isToolAllowed("grep")).toEqual({ allowed: true });
    });

    it("should deny write tools", () => {
      const result = planMode.isToolAllowed("edit");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("denied");
    });

    it("should deny bash", () => {
      const result = planMode.isToolAllowed("bash");
      expect(result.allowed).toBe(false);
    });

    it("should check custom rules", () => {
      const customMode = new PlanMode({
        approvalRules: [
          { toolPattern: "custom_tool", autoApprove: true, reason: "Safe tool" },
        ],
      });
      customMode.enter();

      expect(customMode.isToolAllowed("custom_tool")).toEqual({
        allowed: true,
        reason: "Safe tool",
      });
    });

    it("should support wildcard patterns", () => {
      const customMode = new PlanMode({
        approvalRules: [
          { toolPattern: "mcp_*", autoApprove: true },
        ],
      });
      customMode.enter();

      expect(customMode.isToolAllowed("mcp_read")).toEqual({ allowed: true });
      expect(customMode.isToolAllowed("mcp_write")).toEqual({ allowed: true });
      expect(customMode.isToolAllowed("other_tool")).toEqual({ allowed: false });
    });

    it("should not auto-approve by default", () => {
      expect(planMode.shouldAutoApprove("read")).toBe(false);
    });

    it("should auto-approve when enabled", () => {
      const customMode = new PlanMode({ allowSafeAutoApprove: true });
      customMode.enter();

      expect(customMode.shouldAutoApprove("read")).toBe(true);
    });
  });

  describe("isActive", () => {
    it("should be inactive initially", () => {
      expect(planMode.isActive()).toBe(false);
    });

    it("should be active after entering", () => {
      planMode.enter();
      expect(planMode.isActive()).toBe(true);
    });

    it("should be inactive after exiting", () => {
      planMode.enter();
      planMode.exit();
      expect(planMode.isActive()).toBe(false);
    });
  });
});

describe("createPlanModeDenial", () => {
  it("should create denial with correct code", () => {
    const denial = createPlanModeDenial("edit", "Not allowed in plan mode");

    expect(denial.toolName).toBe("edit");
    expect(denial.code).toBe("WRITE_TOOL_DENIED");
    expect(denial.message).toBe("Not allowed in plan mode");
  });

  it("should include plan step ID", () => {
    const denial = createPlanModeDenial("bash", "Risky", "step-123");

    expect(denial.planStepId).toBe("step-123");
  });
});

describe("isPlanModeDenial", () => {
  it("should identify plan mode denials", () => {
    const denial = createPlanModeDenial("bash", "Denied");
    expect(isPlanModeDenial(denial)).toBe(true);
  });

  it("should reject non-plan denials", () => {
    const denial = { toolName: "bash", code: "OTHER", message: "Error" };
    expect(isPlanModeDenial(denial)).toBe(false);
  });
});
