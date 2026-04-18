import { beforeEach, describe, expect, it } from "vitest";
import {
  PlanStateManager,
  canExecuteTool,
  isReadOnlyTool,
  validateAllowedPrompt,
  type AllowedPrompt,
} from "../src/modes/plan-mode";

describe("PlanStateManager", () => {
  let planMode: PlanStateManager;

  beforeEach(() => {
    planMode = new PlanStateManager();
  });

  it("enters and exits plan mode with approval context", () => {
    const events: Array<{
      type: string;
      allowedPrompts?: AllowedPrompt[];
      planFilePath?: string;
      planWasEdited?: boolean;
    }> = [];

    planMode.onEvent((event) => {
      events.push(event);
    });

    const enterContext = planMode.enterPlanMode("manual");

    expect(enterContext).toEqual({
      mode: "plan",
      previousMode: "manual",
      allowedPrompts: [],
    });

    const prompts: AllowedPrompt[] = [
      { tool: "Bash", prompt: "Read-only verification command" },
      { tool: "Edit", prompt: "Approved plan edit" },
    ];

    planMode.setPlanContent("# plan", "/tmp/plan.md");
    planMode.setAllowedPrompts(prompts);
    planMode.markPlanEdited();

    expect(planMode.getPermissionContext()).toEqual({
      mode: "plan",
      previousMode: "manual",
      allowedPrompts: prompts,
    });

    const exitResult = planMode.exitPlanMode();

    expect(exitResult).toEqual({
      previousMode: "manual",
      allowedPrompts: prompts,
    });
    expect(planMode.getApprovedPrompts()).toEqual(prompts);
    expect(planMode.isInPlanMode()).toBe(false);
    expect(planMode.getState()).toMatchObject({
      isInPlanMode: false,
      allowedPrompts: [],
      planWasEdited: false,
      planContent: undefined,
      planFilePath: undefined,
      previousMode: undefined,
    });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: "enter_plan",
      allowedPrompts: [],
      planFilePath: undefined,
      planWasEdited: false,
    });
    expect(events[1]).toMatchObject({
      type: "exit_plan",
      allowedPrompts: prompts,
      planFilePath: "/tmp/plan.md",
      planWasEdited: true,
    });
  });

  it("clears approved prompts when entering a new plan round", () => {
    planMode.enterPlanMode();
    planMode.setAllowedPrompts([{ tool: "Bash", prompt: "echo approved" }]);
    planMode.exitPlanMode();
    expect(planMode.getApprovedPrompts()).toHaveLength(1);

    planMode.enterPlanMode();
    expect(planMode.getApprovedPrompts()).toEqual([]);
  });

  it("enforces read-only tool execution in plan mode", () => {
    const context = planMode.enterPlanMode();

    // Standard tools (read, ls, grep, glob, edit, write, bash) are now
    // provided by the SDK's claude_code preset. OMI's READ_TOOLS only
    // contains OMI-registered read-only tools (currently just "skill").
    // Plan mode enforcement for SDK tools is handled by the SDK runtime.
    expect(isReadOnlyTool("skill")).toBe(true);
    expect(isReadOnlyTool("read")).toBe(false);
    expect(isReadOnlyTool("ls")).toBe(false);
    expect(isReadOnlyTool("grep")).toBe(false);
    expect(isReadOnlyTool("glob")).toBe(false);
    expect(isReadOnlyTool("edit")).toBe(false);
    expect(isReadOnlyTool("write")).toBe(false);
    expect(isReadOnlyTool("bash")).toBe(false);

    expect(canExecuteTool("skill", "plan")).toBe(true);
    expect(canExecuteTool("skill", context)).toBe(true);
    // SDK tools are not tracked in OMI's READ_TOOLS, so canExecuteTool returns false
    expect(canExecuteTool("read", "plan")).toBe(false);
    expect(canExecuteTool("edit", "plan")).toBe(false);
    expect(canExecuteTool("write", context)).toBe(false);
    expect(canExecuteTool("bash", context)).toBe(false);
  });

  it("validates allowed prompts by shape and length", () => {
    expect(
      validateAllowedPrompt({
        tool: "Bash",
        prompt: "Run a read-only check",
      }),
    ).toBe(true);

    expect(
      validateAllowedPrompt({
        tool: "Bash",
        prompt: "no",
      }),
    ).toBe(false);

    expect(
      validateAllowedPrompt({
        tool: "",
        prompt: "Valid length but empty tool",
      }),
    ).toBe(false);
  });
});
