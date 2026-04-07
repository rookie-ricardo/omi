import { describe, it, expect } from "vitest";
import {
  buildContextBudget,
  calculateTokenWarningState,
  shouldAutoCompact,
  shouldManualCompact,
  getEffectiveContextWindow,
  DEFAULT_OUTPUT_RESERVE_TOKENS,
  AUTOCOMPACT_BUFFER_TOKENS,
} from "../src/context-budget";

/**
 * Create a minimal mock Model object for testing.
 * Only contextWindow is needed by buildContextBudget.
 */
function makeMockModel(contextWindow = 200000) {
  return { contextWindow } as any;
}

describe("context-budget", () => {
  describe("buildContextBudget", () => {
    it("should create budget with default output reserve", () => {
      const model = makeMockModel();

      const budget = buildContextBudget(model);

      expect(budget.rawContextWindow).toBe(200000);
      expect(budget.effectiveContextWindow).toBeLessThan(budget.rawContextWindow);
      expect(budget.autoCompactThreshold).toBeLessThan(budget.effectiveContextWindow);
      expect(budget.outputReserveTokens).toBeGreaterThan(0);
    });

    it("should use custom output reserve when provided", () => {
      const model = makeMockModel();

      const budget = buildContextBudget(model, 30000);

      expect(budget.outputReserveTokens).toBe(30000);
      expect(budget.effectiveContextWindow).toBe(budget.rawContextWindow - 30000);
    });

    it("should calculate correct thresholds", () => {
      const model = makeMockModel();

      const budget = buildContextBudget(model);

      // Thresholds should be in descending order
      expect(budget.errorThreshold).toBeLessThanOrEqual(budget.warningThreshold);
      expect(budget.warningThreshold).toBeLessThanOrEqual(budget.autoCompactThreshold);
      expect(budget.autoCompactThreshold).toBeLessThanOrEqual(budget.manualCompactThreshold);
      expect(budget.manualCompactThreshold).toBeLessThanOrEqual(budget.effectiveContextWindow);
    });
  });

  describe("calculateTokenWarningState", () => {
    it("should return 100% when context is empty", () => {
      const budget = buildContextBudget(makeMockModel());
      const state = calculateTokenWarningState(0, budget);

      expect(state.percentLeft).toBe(100);
      expect(state.isAboveAutoCompactThreshold).toBe(false);
      expect(state.isAboveWarningThreshold).toBe(false);
      expect(state.isAboveErrorThreshold).toBe(false);
      expect(state.isAtBlockingLimit).toBe(false);
    });

    it("should detect when above auto-compact threshold", () => {
      const budget = buildContextBudget(makeMockModel());
      const state = calculateTokenWarningState(budget.autoCompactThreshold + 1000, budget);

      expect(state.isAboveAutoCompactThreshold).toBe(true);
      expect(state.isAboveWarningThreshold || state.isAboveAutoCompactThreshold).toBe(true);
      expect(state.percentLeft).toBeLessThan(100);
    });

    it("should detect blocking limit", () => {
      const budget = buildContextBudget(makeMockModel());
      const state = calculateTokenWarningState(budget.manualCompactThreshold + 100, budget);

      expect(state.isAtBlockingLimit).toBe(true);
    });
  });

  describe("shouldAutoCompact", () => {
    it("should return false when tokens are below threshold", () => {
      const budget = buildContextBudget(makeMockModel());

      const result = shouldAutoCompact(budget.autoCompactThreshold - 1000, budget);

      expect(result).toBe(false);
    });

    it("should return true when tokens are at or above threshold", () => {
      const budget = buildContextBudget(makeMockModel());

      const result = shouldAutoCompact(budget.autoCompactThreshold + 1, budget);

      expect(result).toBe(true);
    });
  });

  describe("shouldManualCompact", () => {
    it("should trigger for manual compact at higher threshold", () => {
      const budget = buildContextBudget(makeMockModel());

      const atAutoCompact = shouldManualCompact(budget.autoCompactThreshold, budget);
      expect(atAutoCompact).toBe(false);

      const atManualCompact = shouldManualCompact(budget.manualCompactThreshold + 1, budget);
      expect(atManualCompact).toBe(true);
    });
  });

  describe("getEffectiveContextWindow", () => {
    it("should return effective context window size", () => {
      const model = makeMockModel();

      const effectiveWindow = getEffectiveContextWindow(model);

      expect(effectiveWindow).toBeGreaterThan(0);
      expect(effectiveWindow).toBeLessThan(200000);
    });
  });
});
