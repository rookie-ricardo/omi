/**
 * Cost Tracker — Token usage and cost estimation
 *
 * Tracks accumulated token usage across multiple turns/runs and
 * calculates estimated costs based on model pricing data.
 * Supports budget limits (maxBudgetUsd) for automatic turn stopping.
 *
 * Aligned with claude-code's cost tracking integrated in QueryEngine.
 */

// ============================================================================
// Model Pricing Data (USD per 1M tokens)
// ============================================================================

export interface ModelPricing {
	inputPerMillion: number;
	outputPerMillion: number;
	cacheReadPerMillion: number;
	cacheWritePerMillion: number;
}

/**
 * Known model pricing data.
 * Updated periodically — can be overridden via `registerModelPricing()`.
 */
const MODEL_PRICING: Record<string, ModelPricing> = {
	// Claude 4
	"claude-sonnet-4-6": {
		inputPerMillion: 3.0,
		outputPerMillion: 15.0,
		cacheReadPerMillion: 0.3,
		cacheWritePerMillion: 3.75,
	},
	"claude-sonnet-4-20250514": {
		inputPerMillion: 3.0,
		outputPerMillion: 15.0,
		cacheReadPerMillion: 0.3,
		cacheWritePerMillion: 3.75,
	},
	"claude-opus-4-0": {
		inputPerMillion: 15.0,
		outputPerMillion: 75.0,
		cacheReadPerMillion: 1.5,
		cacheWritePerMillion: 18.75,
	},
	// Claude 3.5/3.7
	"claude-3-5-sonnet-latest": {
		inputPerMillion: 3.0,
		outputPerMillion: 15.0,
		cacheReadPerMillion: 0.3,
		cacheWritePerMillion: 3.75,
	},
	"claude-3-7-sonnet-latest": {
		inputPerMillion: 3.0,
		outputPerMillion: 15.0,
		cacheReadPerMillion: 0.3,
		cacheWritePerMillion: 3.75,
	},
	// Claude 3 Haiku
	"claude-3-5-haiku-latest": {
		inputPerMillion: 0.8,
		outputPerMillion: 4.0,
		cacheReadPerMillion: 0.08,
		cacheWritePerMillion: 1.0,
	},
	// Claude 3 Opus
	"claude-3-opus-latest": {
		inputPerMillion: 15.0,
		outputPerMillion: 75.0,
		cacheReadPerMillion: 1.5,
		cacheWritePerMillion: 18.75,
	},
};

// Aliases
const MODEL_ALIASES: Record<string, string> = {
	"sonnet": "claude-sonnet-4-6",
	"claude-sonnet": "claude-sonnet-4-6",
	"opus": "claude-opus-4-0",
	"claude-opus": "claude-opus-4-0",
	"haiku": "claude-3-5-haiku-latest",
	"claude-haiku": "claude-3-5-haiku-latest",
};

/**
 * Register custom model pricing.
 */
export function registerModelPricing(modelId: string, pricing: ModelPricing): void {
	MODEL_PRICING[modelId] = pricing;
}

/**
 * Get pricing for a model (returns null if unknown).
 */
export function getModelPricing(modelId: string): ModelPricing | null {
	// Direct lookup
	if (MODEL_PRICING[modelId]) {
		return MODEL_PRICING[modelId];
	}

	// Alias lookup
	const alias = MODEL_ALIASES[modelId];
	if (alias && MODEL_PRICING[alias]) {
		return MODEL_PRICING[alias];
	}

	// Fuzzy match — check if any known model ID is a prefix/suffix
	for (const [knownId, pricing] of Object.entries(MODEL_PRICING)) {
		if (modelId.includes(knownId) || knownId.includes(modelId)) {
			return pricing;
		}
	}

	return null;
}

// ============================================================================
// Token Usage Record
// ============================================================================

export interface TokenUsageRecord {
	inputTokens: number;
	outputTokens: number;
	cacheCreationInputTokens: number;
	cacheReadInputTokens: number;
}

function emptyUsage(): TokenUsageRecord {
	return {
		inputTokens: 0,
		outputTokens: 0,
		cacheCreationInputTokens: 0,
		cacheReadInputTokens: 0,
	};
}

// ============================================================================
// Cost Tracker
// ============================================================================

export interface CostSnapshot {
	/** Total tokens used. */
	totalTokens: number;
	/** Detailed usage breakdown. */
	usage: TokenUsageRecord;
	/** Estimated cost in USD (null if model pricing unknown). */
	totalCostUsd: number | null;
	/** Number of API calls tracked. */
	apiCalls: number;
	/** Whether budget has been exceeded. */
	budgetExceeded: boolean;
	/** Budget limit in USD (null if no limit). */
	maxBudgetUsd: number | null;
	/** Remaining budget in USD (null if no limit or pricing unknown). */
	remainingBudgetUsd: number | null;
}

export class CostTracker {
	private usage: TokenUsageRecord = emptyUsage();
	private apiCalls = 0;
	private modelId: string;
	private maxBudgetUsd: number | null;

	constructor(modelId: string, maxBudgetUsd?: number | null) {
		this.modelId = modelId;
		this.maxBudgetUsd = maxBudgetUsd ?? null;
	}

	/**
	 * Record token usage from a single API call.
	 */
	addUsage(usage: Partial<TokenUsageRecord>): void {
		this.usage.inputTokens += usage.inputTokens ?? 0;
		this.usage.outputTokens += usage.outputTokens ?? 0;
		this.usage.cacheCreationInputTokens += usage.cacheCreationInputTokens ?? 0;
		this.usage.cacheReadInputTokens += usage.cacheReadInputTokens ?? 0;
		this.apiCalls++;
	}

	/**
	 * Calculate estimated cost in USD.
	 */
	calculateCostUsd(): number | null {
		const pricing = getModelPricing(this.modelId);
		if (!pricing) {
			return null;
		}

		return (
			(this.usage.inputTokens * pricing.inputPerMillion) / 1_000_000 +
			(this.usage.outputTokens * pricing.outputPerMillion) / 1_000_000 +
			(this.usage.cacheReadInputTokens * pricing.cacheReadPerMillion) / 1_000_000 +
			(this.usage.cacheCreationInputTokens * pricing.cacheWritePerMillion) / 1_000_000
		);
	}

	/**
	 * Check if the budget has been exceeded.
	 */
	isBudgetExceeded(): boolean {
		if (this.maxBudgetUsd === null) {
			return false;
		}
		const cost = this.calculateCostUsd();
		if (cost === null) {
			return false; // Can't check budget without pricing
		}
		return cost >= this.maxBudgetUsd;
	}

	/**
	 * Get a snapshot of current cost state.
	 */
	snapshot(): CostSnapshot {
		const costUsd = this.calculateCostUsd();
		const budgetExceeded = this.isBudgetExceeded();
		const remainingBudgetUsd =
			this.maxBudgetUsd !== null && costUsd !== null ? Math.max(0, this.maxBudgetUsd - costUsd) : null;

		return {
			totalTokens: this.usage.inputTokens + this.usage.outputTokens,
			usage: { ...this.usage },
			totalCostUsd: costUsd,
			apiCalls: this.apiCalls,
			budgetExceeded,
			maxBudgetUsd: this.maxBudgetUsd,
			remainingBudgetUsd,
		};
	}

	/**
	 * Get accumulated usage.
	 */
	getUsage(): TokenUsageRecord {
		return { ...this.usage };
	}

	/**
	 * Get total token count (input + output).
	 */
	getTotalTokens(): number {
		return this.usage.inputTokens + this.usage.outputTokens;
	}

	/**
	 * Update the model ID (e.g., after model switch).
	 */
	setModel(modelId: string): void {
		this.modelId = modelId;
	}

	/**
	 * Update the budget limit.
	 */
	setBudget(maxBudgetUsd: number | null): void {
		this.maxBudgetUsd = maxBudgetUsd;
	}

	/**
	 * Reset all tracking.
	 */
	reset(): void {
		this.usage = emptyUsage();
		this.apiCalls = 0;
	}

	/**
	 * Format a human-readable cost summary.
	 */
	formatSummary(): string {
		const snap = this.snapshot();
		const parts: string[] = [];

		parts.push(`Tokens: ${snap.totalTokens.toLocaleString()} (in: ${snap.usage.inputTokens.toLocaleString()}, out: ${snap.usage.outputTokens.toLocaleString()})`);

		if (snap.usage.cacheReadInputTokens > 0 || snap.usage.cacheCreationInputTokens > 0) {
			parts.push(
				`Cache: read=${snap.usage.cacheReadInputTokens.toLocaleString()}, write=${snap.usage.cacheCreationInputTokens.toLocaleString()}`,
			);
		}

		if (snap.totalCostUsd !== null) {
			parts.push(`Cost: $${snap.totalCostUsd.toFixed(4)}`);
		}

		if (snap.maxBudgetUsd !== null) {
			parts.push(`Budget: $${snap.remainingBudgetUsd?.toFixed(4) ?? "?"} remaining of $${snap.maxBudgetUsd.toFixed(2)}`);
			if (snap.budgetExceeded) {
				parts.push("⚠️ BUDGET EXCEEDED");
			}
		}

		return parts.join(" | ");
	}
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a new CostTracker.
 *
 * @param modelId - Current model ID (for pricing lookup)
 * @param maxBudgetUsd - Optional budget limit in USD
 */
export function createCostTracker(modelId: string, maxBudgetUsd?: number): CostTracker {
	return new CostTracker(modelId, maxBudgetUsd);
}
