import { describe, it, expect, beforeEach } from "vitest";
import {
	CostTracker,
	createCostTracker,
	getModelPricing,
	registerModelPricing,
} from "../src/cost-tracker";

describe("CostTracker", () => {
	let tracker: CostTracker;

	beforeEach(() => {
		tracker = new CostTracker("claude-sonnet-4-6");
	});

	describe("usage tracking", () => {
		it("starts with zero usage", () => {
			const snap = tracker.snapshot();
			expect(snap.totalTokens).toBe(0);
			expect(snap.apiCalls).toBe(0);
		});

		it("accumulates usage across multiple calls", () => {
			tracker.addUsage({ inputTokens: 100, outputTokens: 50 });
			tracker.addUsage({ inputTokens: 200, outputTokens: 100 });

			const snap = tracker.snapshot();
			expect(snap.usage.inputTokens).toBe(300);
			expect(snap.usage.outputTokens).toBe(150);
			expect(snap.totalTokens).toBe(450);
			expect(snap.apiCalls).toBe(2);
		});

		it("tracks cache tokens", () => {
			tracker.addUsage({
				inputTokens: 100,
				outputTokens: 50,
				cacheReadInputTokens: 500,
				cacheCreationInputTokens: 200,
			});

			const snap = tracker.snapshot();
			expect(snap.usage.cacheReadInputTokens).toBe(500);
			expect(snap.usage.cacheCreationInputTokens).toBe(200);
		});

		it("handles partial usage (only input)", () => {
			tracker.addUsage({ inputTokens: 100 });

			const snap = tracker.snapshot();
			expect(snap.usage.inputTokens).toBe(100);
			expect(snap.usage.outputTokens).toBe(0);
		});

		it("resets usage", () => {
			tracker.addUsage({ inputTokens: 100, outputTokens: 50 });
			tracker.reset();

			const snap = tracker.snapshot();
			expect(snap.totalTokens).toBe(0);
			expect(snap.apiCalls).toBe(0);
		});
	});

	describe("cost calculation", () => {
		it("calculates cost for known model", () => {
			tracker.addUsage({
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
			});

			// claude-sonnet-4-6: $3/M in, $15/M out
			const cost = tracker.calculateCostUsd();
			expect(cost).toBe(18.0); // $3 + $15
		});

		it("includes cache costs", () => {
			tracker.addUsage({
				inputTokens: 0,
				outputTokens: 0,
				cacheReadInputTokens: 1_000_000,
				cacheCreationInputTokens: 1_000_000,
			});

			// claude-sonnet-4-6: $0.3/M cacheRead, $3.75/M cacheWrite
			const cost = tracker.calculateCostUsd();
			expect(cost).toBeCloseTo(4.05, 2);
		});

		it("returns null for unknown model", () => {
			const unknownTracker = new CostTracker("unknown-model-xyz");
			unknownTracker.addUsage({ inputTokens: 1000, outputTokens: 500 });
			expect(unknownTracker.calculateCostUsd()).toBeNull();
		});
	});

	describe("budget enforcement", () => {
		it("does not exceed budget when under limit", () => {
			tracker.setBudget(1.0);
			tracker.addUsage({ inputTokens: 1000, outputTokens: 500 });
			expect(tracker.isBudgetExceeded()).toBe(false);
		});

		it("detects budget exceeded", () => {
			tracker.setBudget(0.001);
			tracker.addUsage({ inputTokens: 1_000_000, outputTokens: 1_000_000 });
			expect(tracker.isBudgetExceeded()).toBe(true);
		});

		it("no budget means never exceeded", () => {
			tracker.addUsage({ inputTokens: 1_000_000, outputTokens: 1_000_000 });
			expect(tracker.isBudgetExceeded()).toBe(false);
		});

		it("snapshot includes remaining budget", () => {
			tracker.setBudget(20.0);
			tracker.addUsage({
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
			});

			const snap = tracker.snapshot();
			expect(snap.maxBudgetUsd).toBe(20.0);
			expect(snap.remainingBudgetUsd).toBeCloseTo(2.0, 1); // 20 - 18 = 2
			expect(snap.budgetExceeded).toBe(false);
		});
	});

	describe("model management", () => {
		it("switches model and recalculates cost", () => {
			tracker.addUsage({ inputTokens: 1_000_000, outputTokens: 1_000_000 });

			const sonnetCost = tracker.calculateCostUsd();
			expect(sonnetCost).toBe(18.0);

			// Switch to a cheaper model
			tracker.setModel("claude-3-5-haiku-latest");
			const haikuCost = tracker.calculateCostUsd();
			// Haiku: $0.8/M in, $4/M out
			expect(haikuCost).toBe(4.8);
		});
	});

	describe("format summary", () => {
		it("formats readable summary", () => {
			tracker.setBudget(25.0);
			tracker.addUsage({
				inputTokens: 1000,
				outputTokens: 500,
				cacheReadInputTokens: 200,
			});

			const summary = tracker.formatSummary();
			expect(summary).toContain("Tokens:");
			expect(summary).toContain("Cost:");
			expect(summary).toContain("Budget:");
		});
	});
});

describe("getModelPricing", () => {
	it("returns pricing for known model", () => {
		const pricing = getModelPricing("claude-sonnet-4-6");
		expect(pricing).not.toBeNull();
		expect(pricing!.inputPerMillion).toBe(3.0);
	});

	it("returns null for unknown model", () => {
		expect(getModelPricing("totally-unknown-model")).toBeNull();
	});

	it("supports fuzzy matching", () => {
		const pricing = getModelPricing("claude-sonnet-4-6-20250514");
		// Should fuzzy-match to claude-sonnet-4-6
		expect(pricing).not.toBeNull();
	});
});

describe("registerModelPricing", () => {
	it("allows custom model registration", () => {
		registerModelPricing("custom-model", {
			inputPerMillion: 1.0,
			outputPerMillion: 5.0,
			cacheReadPerMillion: 0.1,
			cacheWritePerMillion: 1.25,
		});

		const pricing = getModelPricing("custom-model");
		expect(pricing).not.toBeNull();
		expect(pricing!.inputPerMillion).toBe(1.0);
	});
});
