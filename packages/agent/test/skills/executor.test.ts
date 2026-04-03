import { describe, it, expect } from "vitest";
import {
  SkillExecutor,
  shouldDeferExecution,
  getExecutionPriority,
  canExecuteSkill,
  mergeSkillOutputs,
} from "../../src/skills/executor";

describe("executor", () => {
  describe("SkillExecutor", () => {
    const workspaceRoot = "/tmp/test";
    const now = new Date().toISOString();
    const providerConfig = {
      id: "provider-test",
      name: "Test Provider",
      type: "anthropic" as const,
      protocol: "anthropic-messages" as const,
      baseUrl: "https://api.anthropic.com",
      apiKey: "test-key",
      model: "claude-3-5-sonnet-20241022",
      createdAt: now,
      updatedAt: now,
    };

    it("should create executor instance", () => {
      const executor = new SkillExecutor(workspaceRoot, providerConfig);

      expect(executor).toBeDefined();
    });

    it("should return empty plan for empty skills", () => {
      const executor = new SkillExecutor(workspaceRoot, providerConfig);
      const plan = executor.prepareExecutionPlan({
        skills: [],
        totalContextTokens: 0,
        remainingBudgetTokens: 10000,
        diagnostics: [],
        exceeded: false,
      });

      expect(plan.skills).toEqual([]);
      expect(plan.mode).toBe("inline");
      expect(plan.contextTokens).toBe(0);
    });

    it("should detect fork mode when any skill requires forking", () => {
      const executor = new SkillExecutor(workspaceRoot, providerConfig);
      const plan = executor.prepareExecutionPlan({
        skills: [
          {
            skill: {
              descriptor: { name: "test" } as any,
              frontmatter: { execution_mode: "inline" } as any,
              activationConditions: null,
              executionMode: "inline",
              effort: "simple",
              priority: 3,
              identity: "1",
            },
            injectedPrompt: "test",
            enabledToolNames: [],
            referencedFiles: [],
            contextTokens: 100,
            diagnostics: [],
          },
        ],
        totalContextTokens: 100,
        remainingBudgetTokens: 10000,
        diagnostics: [],
        exceeded: false,
      });

      expect(plan.mode).toBe("inline");
    });

    it("should track active forks", () => {
      const executor = new SkillExecutor(workspaceRoot, providerConfig);

      expect(executor.getActiveForks()).toEqual([]);
      expect(executor.isForkActive("nonexistent")).toBe(false);
      expect(executor.terminateFork("nonexistent")).toBe(false);
    });
  });

  describe("shouldDeferExecution", () => {
    it("should return true for skills with activation conditions", () => {
      const skillWithConditions = {
        activationConditions: { paths: ["*.ts"] },
      } as any;

      expect(shouldDeferExecution(skillWithConditions)).toBe(true);
    });

    it("should return false for skills without activation conditions", () => {
      const skillWithoutConditions = {
        activationConditions: null,
      } as any;

      expect(shouldDeferExecution(skillWithoutConditions)).toBe(false);
    });
  });

  describe("getExecutionPriority", () => {
    it("should boost priority for fork skills", () => {
      const inlineSkill = { executionMode: "inline", priority: 5 } as any;
      const forkSkill = { executionMode: "fork", priority: 5 } as any;

      expect(getExecutionPriority(forkSkill)).toBeGreaterThan(getExecutionPriority(inlineSkill));
    });
  });

  describe("canExecuteSkill", () => {
    it("should reject execution without workspace", () => {
      const result = canExecuteSkill({} as any, {
        hasSession: true,
        hasWorkspace: false,
        availableTokens: 5000,
      });

      expect(result.canExecute).toBe(false);
      expect(result.reason).toContain("workspace");
    });

    it("should reject execution with insufficient budget", () => {
      const result = canExecuteSkill({ effort: "epic" } as any, {
        hasSession: true,
        hasWorkspace: true,
        availableTokens: 100,
      });

      expect(result.canExecute).toBe(false);
      expect(result.reason).toContain("budget");
    });

    it("should allow execution with sufficient resources", () => {
      const result = canExecuteSkill({ effort: "simple" } as any, {
        hasSession: true,
        hasWorkspace: true,
        availableTokens: 5000,
      });

      expect(result.canExecute).toBe(true);
    });
  });

  describe("mergeSkillOutputs", () => {
    it("should combine successful outputs", () => {
      const results = [
        { success: true, output: "First output", tokensUsed: 100, mode: "inline" as const, skillName: "skill1" },
        { success: true, output: "Second output", tokensUsed: 150, mode: "inline" as const, skillName: "skill2" },
      ];

      const merged = mergeSkillOutputs(results);

      expect(merged.success).toBe(true);
      expect(merged.combinedOutput).toContain("First output");
      expect(merged.combinedOutput).toContain("Second output");
      expect(merged.totalTokens).toBe(250);
      expect(merged.errors).toEqual([]);
    });

    it("should handle partial failures", () => {
      const results = [
        { success: true, output: "Success", tokensUsed: 100, mode: "inline" as const, skillName: "skill1" },
        { success: false, output: "", tokensUsed: 50, mode: "inline" as const, skillName: "skill2", error: "Failed" },
      ];

      const merged = mergeSkillOutputs(results);

      expect(merged.success).toBe(false);
      expect(merged.combinedOutput).toContain("Success");
      expect(merged.errors).toContain("[skill2] Failed");
    });
  });
});
