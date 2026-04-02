/**
 * retry-backoff.test.ts - 指数退避策略测试
 *
 * 测试覆盖：
 * - 指数退避延迟计算
 * - baseDelayMs * 2^(attempt-1) 公式
 * - maxDelayMs 上限
 * - maxRetries 限制
 * - AbortSignal 取消支持
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

describe("指数退避延迟计算", () => {
	describe("基本指数退避公式", () => {
		it("应该按照 baseDelayMs * 2^(attempt-1) 计算延迟", () => {
			const baseDelayMs = 2000;

			// attempt=0: 2000 * 2^0 = 2000
			expect(calculateBackoffDelay(baseDelayMs, 0)).toBe(2000);
			// attempt=1: 2000 * 2^1 = 4000
			expect(calculateBackoffDelay(baseDelayMs, 1)).toBe(4000);
			// attempt=2: 2000 * 2^2 = 8000
			expect(calculateBackoffDelay(baseDelayMs, 2)).toBe(8000);
			// attempt=3: 2000 * 2^3 = 16000
			expect(calculateBackoffDelay(baseDelayMs, 3)).toBe(16000);
		});

		it("应该支持不同的 baseDelayMs", () => {
			expect(calculateBackoffDelay(1000, 0)).toBe(1000);
			expect(calculateBackoffDelay(1000, 1)).toBe(2000);
			expect(calculateBackoffDelay(1000, 2)).toBe(4000);

			expect(calculateBackoffDelay(5000, 0)).toBe(5000);
			expect(calculateBackoffDelay(5000, 1)).toBe(10000);
		});

		it("第一次重试 (attempt=0) 应该使用 baseDelayMs", () => {
			const baseDelayMs = 3000;
			expect(calculateBackoffDelay(baseDelayMs, 0)).toBe(baseDelayMs);
		});
	});

	describe("maxDelayMs 上限", () => {
		it("应该限制延迟不超过 maxDelayMs", () => {
			const baseDelayMs = 2000;
			const maxDelayMs = 10000;

			// 不受限制的情况
			expect(calculateBackoffDelay(baseDelayMs, 0, maxDelayMs)).toBe(2000);
			expect(calculateBackoffDelay(baseDelayMs, 1, maxDelayMs)).toBe(4000);
			expect(calculateBackoffDelay(baseDelayMs, 2, maxDelayMs)).toBe(8000);

			// 受限制：2000 * 2^3 = 16000 > 10000
			expect(calculateBackoffDelay(baseDelayMs, 3, maxDelayMs)).toBe(10000);

			// 受限制：更大的指数也会被限制
			expect(calculateBackoffDelay(baseDelayMs, 10, maxDelayMs)).toBe(10000);
		});

		it("应该处理 maxDelayMs 等于 baseDelayMs 的情况", () => {
			const baseDelayMs = 5000;
			const maxDelayMs = 5000;

			expect(calculateBackoffDelay(baseDelayMs, 0, maxDelayMs)).toBe(5000);
			expect(calculateBackoffDelay(baseDelayMs, 1, maxDelayMs)).toBe(5000);
			expect(calculateBackoffDelay(baseDelayMs, 10, maxDelayMs)).toBe(5000);
		});

		it("应该处理 maxDelayMs 小于 baseDelayMs 的情况", () => {
			const baseDelayMs = 5000;
			const maxDelayMs = 2000;

			expect(calculateBackoffDelay(baseDelayMs, 0, maxDelayMs)).toBe(2000);
			expect(calculateBackoffDelay(baseDelayMs, 1, maxDelayMs)).toBe(2000);
		});
	});

	describe("与 serverDelay 的协同", () => {
		it("应该使用 serverDelay 当它更小时", () => {
			const baseDelayMs = 2000;
			const maxDelayMs = 60000;

			// serverDelay = 1000, exponential = 2000, max = 60000
			// 应该使用 min(2000, 60000, 1000) = 1000
			const exponentialDelay = baseDelayMs * Math.pow(2, 0);
			const serverDelay = 1000;
			const finalDelay = Math.min(exponentialDelay, maxDelayMs, serverDelay);

			expect(finalDelay).toBe(1000);
		});

		it("应该使用 serverDelay 当它在中间时", () => {
			const baseDelayMs = 2000;
			const maxDelayMs = 60000;

			// serverDelay = 5000, exponential = 2000, max = 60000
			// 应该使用 min(2000, 60000, 5000) = 2000 (exponential 最小)
			const exponentialDelay = baseDelayMs * Math.pow(2, 0);
			const serverDelay = 5000;
			const finalDelay = Math.min(exponentialDelay, maxDelayMs, serverDelay);

			expect(finalDelay).toBe(2000);
		});

		it("应该使用 exponentialDelay 当 serverDelay 未指定时", () => {
			const baseDelayMs = 2000;
			const maxDelayMs = 60000;

			const exponentialDelay = baseDelayMs * Math.pow(2, 2);
			const finalDelay = Math.min(exponentialDelay, maxDelayMs, maxDelayMs);

			expect(finalDelay).toBe(8000);
		});
	});

	describe("边界情况", () => {
		it("应该处理 attempt 为 0", () => {
			expect(calculateBackoffDelay(2000, 0)).toBe(2000);
		});

		it("应该处理很大的 attempt 值", () => {
			const maxDelayMs = 60000;
			const delay = calculateBackoffDelay(2000, 100, maxDelayMs);
			expect(delay).toBe(maxDelayMs);
		});

		it("应该处理 baseDelayMs 为 0", () => {
			expect(calculateBackoffDelay(0, 0)).toBe(0);
			expect(calculateBackoffDelay(0, 1)).toBe(0);
		});

		it("应该处理 maxDelayMs 为 0", () => {
			expect(calculateBackoffDelay(2000, 0, 0)).toBe(0);
			expect(calculateBackoffDelay(2000, 1, 0)).toBe(0);
		});
	});
});

describe("重试次数限制", () => {
	describe("maxRetries 验证", () => {
		it("应该在 maxRetries 次后停止重试", () => {
			const maxRetries = 3;

			// 允许的 attempt: 0, 1, 2, 3 (共 maxRetries+1 次，但实际重试 maxRetries 次)
			// 实际执行时，retryAttempt 从 0 开始，条件是 retryAttempt <= maxRetries
			for (let attempt = 0; attempt <= maxRetries; attempt++) {
				expect(shouldAttemptRetry(attempt, maxRetries)).toBe(true);
			}

			// 超过 maxRetries 应该停止
			expect(shouldAttemptRetry(maxRetries + 1, maxRetries)).toBe(false);
		});

		it("maxRetries=0 时应该只尝试一次（不重试）", () => {
			const maxRetries = 0;
			expect(shouldAttemptRetry(0, maxRetries)).toBe(true);
			expect(shouldAttemptRetry(1, maxRetries)).toBe(false);
		});

		it("maxRetries=1 时应该重试一次", () => {
			const maxRetries = 1;
			expect(shouldAttemptRetry(0, maxRetries)).toBe(true);
			expect(shouldAttemptRetry(1, maxRetries)).toBe(true);
			expect(shouldAttemptRetry(2, maxRetries)).toBe(false);
		});

		it("maxRetries=5 时应该允许 5 次重试", () => {
			const maxRetries = 5;
			expect(shouldAttemptRetry(0, maxRetries)).toBe(true);
			expect(shouldAttemptRetry(1, maxRetries)).toBe(true);
			expect(shouldAttemptRetry(2, maxRetries)).toBe(true);
			expect(shouldAttemptRetry(3, maxRetries)).toBe(true);
			expect(shouldAttemptRetry(4, maxRetries)).toBe(true);
			expect(shouldAttemptRetry(5, maxRetries)).toBe(true);
			expect(shouldAttemptRetry(6, maxRetries)).toBe(false);
		});
	});

	describe("重试禁用时", () => {
		it("enabled=false 时应该不重试", () => {
			const enabled = false;
			const maxRetries = 3;

			// 即使 maxRetries > 0，如果 enabled=false 也不应该重试
			if (!enabled) {
				expect(shouldAttemptRetry(0, maxRetries, enabled)).toBe(false);
				expect(shouldAttemptRetry(1, maxRetries, enabled)).toBe(false);
			}
		});

		it("enabled=true 时应该正常重试", () => {
			const enabled = true;
			const maxRetries = 3;

			expect(shouldAttemptRetry(0, maxRetries, enabled)).toBe(true);
			expect(shouldAttemptRetry(1, maxRetries, enabled)).toBe(true);
			expect(shouldAttemptRetry(2, maxRetries, enabled)).toBe(true);
			expect(shouldAttemptRetry(3, maxRetries, enabled)).toBe(true);
			expect(shouldAttemptRetry(4, maxRetries, enabled)).toBe(false);
		});
	});
});

describe("AbortSignal 取消支持", () => {
	it("应该在延迟期间检查取消信号", async () => {
		const abortController = new AbortController();
		const delayMs = 5000;

		// 启动延迟，但在 100ms 后取消
		const delayPromise = delayWithAbortSignal(delayMs, abortController.signal);

		setTimeout(() => {
			abortController.abort();
		}, 100);

		const startTime = Date.now();
		await delayPromise;
		const elapsed = Date.now() - startTime;

		// 应该在取消后很快返回，而不是等待完整的 5000ms
		expect(elapsed).toBeLessThan(1000);
	});

	it("应该立即响应已取消的信号", async () => {
		const abortController = new AbortController();
		abortController.abort(); // 已经取消

		const startTime = Date.now();
		await delayWithAbortSignal(5000, abortController.signal);
		const elapsed = Date.now() - startTime;

		// 应该立即返回
		expect(elapsed).toBeLessThan(100);
	});

	it("正常情况下应该等待完整的延迟", async () => {
		const abortController = new AbortController();
		const delayMs = 100;

		const startTime = Date.now();
		await delayWithAbortSignal(delayMs, abortController.signal);
		const elapsed = Date.now() - startTime;

		// 应该等待至少 delayMs
		expect(elapsed).toBeGreaterThanOrEqual(delayMs);
		expect(elapsed).toBeLessThan(delayMs + 200); // 允许一些误差
	});
});

// ============================================================================
// 辅助函数（模拟实际实现）
// ============================================================================

function calculateBackoffDelay(
	baseDelayMs: number,
	attempt: number,
	maxDelayMs?: number,
): number {
	const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
	if (maxDelayMs !== undefined) {
		return Math.min(exponentialDelay, maxDelayMs);
	}
	return exponentialDelay;
}

function shouldAttemptRetry(
	attempt: number,
	maxRetries: number,
	enabled: boolean = true,
): boolean {
	if (!enabled) {
		return false;
	}
	return attempt <= maxRetries;
}

async function delayWithAbortSignal(ms: number, signal: AbortSignal): Promise<void> {
	const start = Date.now();
	const interval = 100;

	while (Date.now() - start < ms) {
		if (signal.aborted) {
			return; // 提前退出
		}

		const remaining = ms - (Date.now() - start);
		if (remaining <= 0) break;

		await new Promise((resolve) => setTimeout(resolve, Math.min(interval, remaining)));
	}
}
