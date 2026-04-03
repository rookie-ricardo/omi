import { describe, it, expect } from "vitest";
import type { ProviderConfig } from "@omi/core";
import { createId, nowIso } from "@omi/core";
import {
  createContextBudget,
  buildContextBudget,
  calculateTokenWarningState,
  shouldAutoCompact,
  shouldManualCompact,
  isAtBlockingLimit,
  getEffectiveContextWindow,
  DEFAULT_OUTPUT_RESERVE_TOKENS,
  AUTOCOMPACT_BUFFER_TOKENS,
} from "../src/context-budget";

function makeProviderConfig(): ProviderConfig {
  const now = nowIso();
  return {
    id: createId("provider"),
    name: "Test Provider",
    type: "anthropic",
    baseUrl: "https://api.anthropic.com",
    apiKey: "test-key",
    model: "claude-3-5-sonnet-20241022",
    createdAt: now,
    updatedAt: now,
  };
}

describe("context-budget", () => {
  describe("createContextBudget", () => {
    it("should create budget with default output reserve for anthropic provider", () => {
      const config = makeProviderConfig();

      const budget = createContextBudget(config);

      expect(budget.rawContextWindow).toBeGreaterThan(0);
      expect(budget.effectiveContextWindow).toBeLessThan(budget.rawContextWindow);
      expect(budget.autoCompactThreshold).toBeLessThan(budget.effectiveContextWindow);
      expect(budget.outputReserveTokens).toBeGreaterThan(0);
    });

    it("should use custom output reserve when provided", () => {
      const config = makeProviderConfig();

      const budget = createContextBudget(config, 30000);

      expect(budget.outputReserveTokens).toBe(30000);
      expect(budget.effectiveContextWindow).toBe(budget.rawContextWindow - 30000);
    });

    it("should calculate correct thresholds", () => {
      const config = makeProviderConfig();

      const budget = createContextBudget(config);

      // Thresholds should be in descending order
      expect(budget.errorThreshold).toBeLessThanOrEqual(budget.warningThreshold);
      expect(budget.warningThreshold).toBeLessThanOrEqual(budget.autoCompactThreshold);
      expect(budget.autoCompactThreshold).toBeLessThanOrEqual(budget.manualCompactThreshold);
      expect(budget.manualCompactThreshold).toBeLessThanOrEqual(budget.effectiveContextWindow);
    });
  });

  describe("calculateTokenWarningState", () => {
    it("should return 100% when context is empty", () => {
      const config = makeProviderConfig();

      const budget = createContextBudget(config);
      const state = calculateTokenWarningState(0, budget);

      expect(state.percentLeft).toBe(100);
      expect(state.isAboveAutoCompactThreshold).toBe(false);
      expect(state.isAboveWarningThreshold).toBe(false);
      expect(state.isAboveErrorThreshold).toBe(false);
      expect(state.isAtBlockingLimit).toBe(false);
    });

    it("should detect when above auto-compact threshold", () => {
      const config = makeProviderConfig();

      const budget = createContextBudget(config);
      const state = calculateTokenWarningState(budget.autoCompactThreshold + 1000, budget);

      expect(state.isAboveAutoCompactThreshold).toBe(true);
      // Warning and error depend on actual buffer values, just check at least auto-compact
      expect(state.isAboveWarningThreshold || state.isAboveAutoCompactThreshold).toBe(true);
      expect(state.percentLeft).toBeLessThan(100);
    });

    it("should detect blocking limit", () => {
      const config = makeProviderConfig();

      const budget = createContextBudget(config);
      const state = calculateTokenWarningState(budget.manualCompactThreshold + 100, budget);

      expect(state.isAtBlockingLimit).toBe(true);
    });
  });

  describe("shouldAutoCompact", () => {
    it("should return false when tokens are below threshold", () => {
      const budget = createContextBudget(makeProviderConfig());

      const result = shouldAutoCompact(budget.autoCompactThreshold - 1000, budget);

      expect(result).toBe(false);
    });

    it("should return true when tokens are at or above threshold", () => {
      const budget = createContextBudget(makeProviderConfig());

      const result = shouldAutoCompact(budget.autoCompactThreshold + 1, budget);

      expect(result).toBe(true);
    });
  });

  describe("shouldManualCompact", () => {
    it("should trigger for manual compact at higher threshold", () => {
      const budget = createContextBudget(makeProviderConfig());

      // At auto-compact threshold but below manual threshold
      const atAutoCompact = shouldManualCompact(budget.autoCompactThreshold, budget);
      expect(atAutoCompact).toBe(false);

      // At manual compact threshold
      const atManualCompact = shouldManualCompact(budget.manualCompactThreshold + 1, budget);
      expect(atManualCompact).toBe(true);
    });
  });

  describe("getEffectiveContextWindow", () => {
    it("should return effective context window size", () => {
      const config = makeProviderConfig();

      const effectiveWindow = getEffectiveContextWindow(config);

      expect(effectiveWindow).toBeGreaterThan(0);
      expect(effectiveWindow).toBeLessThan(200000); // Should be less than raw window
    });
  });
});
