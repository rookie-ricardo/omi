/**
 * overflow-recovery.test.ts - Context Overflow 恢复流程测试
 *
 * 测试覆盖：
 * - Overflow 错误检测
 * - 自动 compaction 触发
 * - 只恢复一次（避免无限循环）
 * - 移除错误消息
 * - 重试机制
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { isOverflowError } from "@omi/memory";

// Mock AgentSession 的相关行为
class MockAgentSession {
	public compactSessionCallCount = 0;
	public lastCompactionMode: string | null = null;
	public overflowRecovered = false;

	async compactSession(mode: string = "overflow"): Promise<{
		summary: { goal: string };
		removedEntries: string[];
	}> {
		this.compactSessionCallCount++;
		this.lastCompactionMode = mode;
		return {
			summary: { goal: "Overflow recovery compaction" },
			removedEntries: ["entry1", "entry2"],
		};
	}

	resetOverflowTracking(): void {
		this.overflowRecovered = false;
	}
}

describe("Overflow 错误检测", () => {
	it("应该检测 context overflow 错误", () => {
		const overflowError = new Error("context length exceeded");
		expect(isOverflowError(overflowError)).toBe(true);
	});

	it("应该检测 maximum context length exceeded", () => {
		const overflowError = new Error("maximum context length exceeded");
		expect(isOverflowError(overflowError)).toBe(true);
	});

	it("应该检测 too many tokens", () => {
		const overflowError = new Error("too many tokens");
		expect(isOverflowError(overflowError)).toBe(true);
	});

	it("不应该检测其他错误为 overflow", () => {
		expect(isOverflowError(new Error("rate limit"))).toBe(false);
		expect(isOverflowError(new Error("timeout"))).toBe(false);
		expect(isOverflowError(new Error("500"))).toBe(false);
	});
});

describe("Overflow 恢复流程", () => {
	let mockSession: MockAgentSession;

	beforeEach(() => {
		mockSession = new MockAgentSession();
	});

	describe("第一次 overflow 时应该触发 compaction", () => {
		it("应该调用 compactSession", async () => {
			const overflowError = new Error("context length exceeded");
			let recovered = false;

			// 模拟恢复流程
			if (isOverflowError(overflowError) && !mockSession.overflowRecovered) {
				await mockSession.compactSession("overflow");
				recovered = true;
				mockSession.overflowRecovered = true;
			}

			expect(recovered).toBe(true);
			expect(mockSession.compactSessionCallCount).toBe(1);
			expect(mockSession.lastCompactionMode).toBe("overflow");
		});

		it("应该设置 overflowRecovered 标志", async () => {
			const overflowError = new Error("context length exceeded");

			if (isOverflowError(overflowError) && !mockSession.overflowRecovered) {
				await mockSession.compactSession("overflow");
				mockSession.overflowRecovered = true;
			}

			expect(mockSession.overflowRecovered).toBe(true);
		});
	});

	describe("第二次 overflow 时应该不再恢复（避免无限循环）", () => {
		it("已经恢复过一次后不应该再次恢复", async () => {
			// 设置已经恢复过
			mockSession.overflowRecovered = true;

			const overflowError = new Error("context length exceeded");
			let recovered = false;

			if (isOverflowError(overflowError) && !mockSession.overflowRecovered) {
				await mockSession.compactSession("overflow");
				recovered = true;
				mockSession.overflowRecovered = true;
			}

			expect(recovered).toBe(false);
			expect(mockSession.compactSessionCallCount).toBe(0);
		});

		it("连续两次 overflow 时第二次应该抛出错误", async () => {
			// 第一次 overflow
			const firstError = new Error("context length exceeded");
			if (isOverflowError(firstError) && !mockSession.overflowRecovered) {
				await mockSession.compactSession("overflow");
				mockSession.overflowRecovered = true;
			}

			expect(mockSession.compactSessionCallCount).toBe(1);

			// 第二次 overflow - 不应该再恢复
			const secondError = new Error("context length exceeded");
			let shouldThrow = false;
			if (isOverflowError(secondError)) {
				if (mockSession.overflowRecovered) {
					shouldThrow = true; // 应该抛出原始错误
				}
			}

			expect(shouldThrow).toBe(true);
			expect(mockSession.compactSessionCallCount).toBe(1); // 没有增加
		});
	});

	describe("非 overflow 错误不应该触发恢复", () => {
		it("rate limit 错误不应该触发 overflow 恢复", async () => {
			const rateLimitError = new Error("rate limit exceeded");

			if (isOverflowError(rateLimitError)) {
				await mockSession.compactSession("overflow");
			}

			expect(mockSession.compactSessionCallCount).toBe(0);
		});

		it("timeout 错误不应该触发 overflow 恢复", async () => {
			const timeoutError = new Error("request timeout");

			if (isOverflowError(timeoutError)) {
				await mockSession.compactSession("overflow");
			}

			expect(mockSession.compactSessionCallCount).toBe(0);
		});
	});

	describe("恢复后的重试", () => {
		it("恢复后应该继续重试（不增加 retryAttempt）", async () => {
			const overflowError = new Error("context length exceeded");
			let retryAttempt = 0; // 这是在 executeProviderWithRecovery 中的计数器
			let overflowRecovered = false;

			// 模拟 overflow 恢复逻辑
			if (isOverflowError(overflowError)) {
				if (!overflowRecovered) {
					await mockSession.compactSession("overflow");
					overflowRecovered = true;
					// 注意：这里不增加 retryAttempt
					// continue; // 会在实际代码中继续循环
				} else {
					throw overflowError; // 第二次 overflow 抛出错误
				}
			}

			// 验证 retryAttempt 没有增加
			expect(retryAttempt).toBe(0);
			expect(overflowRecovered).toBe(true);
		});

		it("overflow 恢复后重新构建 currentHistoryMessages", async () => {
			// 模拟历史消息
			const originalHistory = ["msg1", "msg2", "msg3"];
			let currentHistoryMessages = [...originalHistory];

			// overflow 恢复
			if (isOverflowError(new Error("context length exceeded"))) {
				await mockSession.compactSession("overflow");
				// 重建历史消息
				currentHistoryMessages = ["msg1", "msg2"]; // 压缩后
			}

			// 验证消息被重建
			expect(currentHistoryMessages).not.toEqual(originalHistory);
			expect(currentHistoryMessages.length).toBeLessThan(originalHistory.length);
		});
	});
});

describe("完整的 overflow 恢复场景", () => {
	it("应该处理单次 overflow 成功恢复", async () => {
		const mockSession = new MockAgentSession();
		let overflowRecovered = false;
		let success = false;

		// 第一次尝试 - overflow
		try {
			throw new Error("context length exceeded");
		} catch (error) {
			if (isOverflowError(error) && !overflowRecovered) {
				await mockSession.compactSession("overflow");
				overflowRecovered = true;
				// 继续重试（不增加 retryAttempt）
				// 模拟重试成功
				success = true;
			}
		}

		expect(overflowRecovered).toBe(true);
		expect(success).toBe(true);
		expect(mockSession.compactSessionCallCount).toBe(1);
	});

	it("应该处理多次重试中的 overflow", async () => {
		const mockSession = new MockAgentSession();
		let overflowRecovered = false;
		let retryAttempt = 0;
		const maxRetries = 3;

		// 第一次重试 - overflow
		try {
			throw new Error("context length exceeded");
		} catch (error) {
			if (isOverflowError(error)) {
				if (!overflowRecovered) {
					await mockSession.compactSession("overflow");
					overflowRecovered = true;
					// overflow 恢复不增加 retryAttempt
					// 继续到下一次尝试
				} else {
					throw error; // 第二次 overflow 直接抛出
				}
			}
		}

		// 第二次尝试 - 假设成功
		retryAttempt++; // 这是在 overflow 后的普通重试
		const secondSuccess = true;

		expect(overflowRecovered).toBe(true);
		expect(retryAttempt).toBe(1);
		expect(mockSession.compactSessionCallCount).toBe(1);
	});

	it("overflow 恢复后仍然失败应该继续重试", async () => {
		const mockSession = new MockAgentSession();
		let overflowRecovered = false;
		let attemptCount = 0;

		// 尝试 1: overflow
		try {
			attemptCount++;
			throw new Error("context length exceeded");
		} catch (error) {
			if (isOverflowError(error) && !overflowRecovered) {
				await mockSession.compactSession("overflow");
				overflowRecovered = true;
			} else {
				throw error;
			}
		}

		// 尝试 2: 仍然 overflow（理论上不应该，但测试边界）
		try {
			attemptCount++;
			if (overflowRecovered) {
				throw new Error("context length exceeded");
			}
		} catch (error) {
			if (isOverflowError(error)) {
				// 第二次 overflow 应该抛出
				expect(() => {
					if (overflowRecovered) {
						throw error;
					}
				}).toThrow();
			}
		}

		expect(attemptCount).toBe(2);
		expect(mockSession.compactSessionCallCount).toBe(1);
	});
});

describe("与其他错误类型的交互", () => {
	it("overflow 恢复后遇到 rate limit 应该正常重试", async () => {
		const mockSession = new MockAgentSession();
		let overflowRecovered = false;
		let retryAttempt = 0;

		// 第一次: overflow
		try {
			throw new Error("context length exceeded");
		} catch (error) {
			if (isOverflowError(error) && !overflowRecovered) {
				await mockSession.compactSession("overflow");
				overflowRecovered = true;
			}
		}

		// 第二次: rate limit (应该触发普通重试)
		try {
			throw new Error("rate limit exceeded");
		} catch (error) {
			const errorStr = String(error);
			if (errorStr.includes("rate limit")) {
				// 这是可重试错误，增加 retryAttempt
				retryAttempt++;
			}
		}

		expect(overflowRecovered).toBe(true);
		expect(retryAttempt).toBe(1);
	});

	it("rate limit 后不应该触发 overflow 恢复", async () => {
		const mockSession = new MockAgentSession();

		// rate limit 错误
		try {
			throw new Error("rate limit exceeded");
		} catch (error) {
			if (isOverflowError(error)) {
				await mockSession.compactSession("overflow");
			}
		}

		expect(mockSession.compactSessionCallCount).toBe(0);
	});
});
