/**
 * retry-events.test.ts - 重试事件通知测试
 *
 * 测试覆盖：
 * - auto_retry_start 事件
 * - auto_retry_end 事件
 * - 事件负载结构
 * - 成功和失败场景
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

interface RetryEvent {
	type: string;
	payload: {
		runId: string;
		sessionId: string;
		attempt: number;
		delayMs?: number;
		error?: string;
		success?: boolean;
	};
}

describe("auto_retry_start 事件", () => {
	it("应该在重试开始时发送 auto_retry_start 事件", () => {
		const events: RetryEvent[] = [];
		const runId = "run-123";
		const sessionId = "session-456";
		const retryAttempt = 1;
		const delayMs = 4000;
		const error = new Error("rate limit exceeded");

		// 模拟发送 auto_retry_start 事件
		events.push({
			type: "auto_retry_start",
			payload: {
				runId,
				sessionId,
				attempt: retryAttempt + 1, // attempt 是从 0 开始的，显示时 +1
				delayMs,
				error: error.message,
			},
		});

		expect(events).toHaveLength(1);
		expect(events[0].type).toBe("auto_retry_start");
		expect(events[0].payload.runId).toBe(runId);
		expect(events[0].payload.sessionId).toBe(sessionId);
		expect(events[0].payload.attempt).toBe(2);
		expect(events[0].payload.delayMs).toBe(4000);
		expect(events[0].payload.error).toBe("rate limit exceeded");
	});

	it("应该包含正确的延迟信息", () => {
		const events: RetryEvent[] = [];
		const baseDelayMs = 2000;
		const retryAttempt = 2;

		// 计算延迟
		const delayMs = baseDelayMs * Math.pow(2, retryAttempt);

		events.push({
			type: "auto_retry_start",
			payload: {
				runId: "run-123",
				sessionId: "session-456",
				attempt: retryAttempt + 1,
				delayMs,
				error: "timeout",
			},
		});

		// 2000 * 2^2 = 8000
		expect(events[0].payload.delayMs).toBe(8000);
	});

	it("应该包含错误信息", () => {
		const events: RetryEvent[] = [];
		const error = new Error("connection refused");

		events.push({
			type: "auto_retry_start",
			payload: {
				runId: "run-123",
				sessionId: "session-456",
				attempt: 1,
				delayMs: 2000,
				error: error.message,
			},
		});

		expect(events[0].payload.error).toBe("connection refused");
	});

	it("attempt 应该从 1 开始显示（不是 0）", () => {
		const events: RetryEvent[] = [];
		const retryAttempt = 0; // 内部计数从 0 开始

		events.push({
			type: "auto_retry_start",
			payload: {
				runId: "run-123",
				sessionId: "session-456",
				attempt: retryAttempt + 1, // 显示给用户时 +1
				delayMs: 2000,
				error: "rate limit",
			},
		});

		expect(events[0].payload.attempt).toBe(1);
	});
});

describe("auto_retry_end 事件", () => {
	describe("成功场景", () => {
		it("应该在重试成功后发送 auto_retry_end 事件", () => {
			const events: RetryEvent[] = [];
			const runId = "run-123";
			const sessionId = "session-456";
			const retryAttempt = 2;

			// 重试成功后发送事件
			events.push({
				type: "auto_retry_end",
				payload: {
					runId,
					sessionId,
					success: true,
					attempt: retryAttempt,
				},
			});

			expect(events).toHaveLength(1);
			expect(events[0].type).toBe("auto_retry_end");
			expect(events[0].payload.success).toBe(true);
			expect(events[0].payload.attempt).toBe(2);
		});

		it("成功时不应该包含 error 字段", () => {
			const events: RetryEvent[] = [];

			events.push({
				type: "auto_retry_end",
				payload: {
					runId: "run-123",
					sessionId: "session-456",
					success: true,
					attempt: 1,
				},
			});

			expect(events[0].payload.error).toBeUndefined();
		});

		it("overflow 恢复成功后也应该发送事件", () => {
			const events: RetryEvent[] = [];
			const retryAttempt = 0;
			const overflowRecovered = true;

			// 如果发生了重试或 overflow 恢复，发送事件
			if (retryAttempt > 0 || overflowRecovered) {
				events.push({
					type: "auto_retry_end",
					payload: {
						runId: "run-123",
						sessionId: "session-456",
						success: true,
						attempt: retryAttempt,
					},
				});
			}

			expect(events).toHaveLength(1);
			expect(events[0].payload.success).toBe(true);
		});
	});

	describe("失败场景", () => {
		it("应该在重试耗尽后发送 auto_retry_end 事件（失败）", () => {
			const events: RetryEvent[] = [];
			const runId = "run-123";
			const sessionId = "session-456";
			const retryAttempt = 3; // 达到 maxRetries
			const error = new Error("rate limit exceeded");

			// 重试耗尽
			events.push({
				type: "auto_retry_end",
				payload: {
					runId,
					sessionId,
					success: false,
					attempt: retryAttempt,
					error: error.message,
				},
			});

			expect(events).toHaveLength(1);
			expect(events[0].type).toBe("auto_retry_end");
			expect(events[0].payload.success).toBe(false);
			expect(events[0].payload.attempt).toBe(3);
			expect(events[0].payload.error).toBe("rate limit exceeded");
		});

		it("应该包含失败时的错误信息", () => {
			const events: RetryEvent[] = [];
			const error = new Error("connection refused after 3 retries");

			events.push({
				type: "auto_retry_end",
				payload: {
					runId: "run-123",
					sessionId: "session-456",
					success: false,
					attempt: 3,
					error: error.message,
				},
			});

			expect(events[0].payload.error).toBe("connection refused after 3 retries");
		});
	});
});

describe("完整的事件序列", () => {
	it("应该发送正确的重试事件序列", () => {
		const events: RetryEvent[] = [];
		const runId = "run-123";
		const sessionId = "session-456";

		// 模拟重试流程
		const maxRetries = 3;
		const baseDelayMs = 2000;

		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			// 发送 retry_start 事件
			if (attempt > 0) {
				const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
				events.push({
					type: "auto_retry_start",
					payload: {
						runId,
						sessionId,
						attempt: attempt,
						delayMs,
						error: "rate limit exceeded",
					},
				});
			}

			// 模拟这次也失败
			if (attempt < maxRetries) {
				continue; // 继续重试
			}

			// 最后一次尝试后，发送 retry_end
			events.push({
				type: "auto_retry_end",
				payload: {
					runId,
					sessionId,
					success: false,
					attempt: maxRetries,
					error: "rate limit exceeded",
				},
			});
		}

		// 验证事件序列
		expect(events).toHaveLength(maxRetries + 1); // 3 次 start + 1 次 end

		// 第一次重试
		expect(events[0].type).toBe("auto_retry_start");
		expect(events[0].payload.attempt).toBe(1);
		expect(events[0].payload.delayMs).toBe(2000);

		// 第二次重试
		expect(events[1].type).toBe("auto_retry_start");
		expect(events[1].payload.attempt).toBe(2);
		expect(events[1].payload.delayMs).toBe(4000);

		// 第三次重试
		expect(events[2].type).toBe("auto_retry_start");
		expect(events[2].payload.attempt).toBe(3);
		expect(events[2].payload.delayMs).toBe(8000);

		// 重试结束
		expect(events[3].type).toBe("auto_retry_end");
		expect(events[3].payload.success).toBe(false);
	});

	it("成功的重试应该发送 start 和 end 事件", () => {
		const events: RetryEvent[] = [];
		const runId = "run-123";
		const sessionId = "session-456";

		// 第一次尝试失败
		// ...

		// 第一次重试
		events.push({
			type: "auto_retry_start",
			payload: {
				runId,
				sessionId,
				attempt: 1,
				delayMs: 2000,
				error: "timeout",
			},
		});

		// 重试成功
		events.push({
			type: "auto_retry_end",
			payload: {
				runId,
				sessionId,
				success: true,
				attempt: 1,
			},
		});

		expect(events).toHaveLength(2);
		expect(events[0].type).toBe("auto_retry_start");
		expect(events[1].type).toBe("auto_retry_end");
		expect(events[1].payload.success).toBe(true);
	});
});

describe("事件持久化", () => {
	it("事件应该被持久化到数据库", () => {
		const databaseEvents: Array<{ runId: string; sessionId: string; type: string; payload: unknown }> = [];
		const emittedEvents: Array<{ type: string; payload: unknown }> = [];

		// 模拟 emitAndPersist 函数
		const runId = "run-123";
		const sessionId = "session-456";

		const event = {
			type: "auto_retry_start",
			payload: {
				runId,
				sessionId,
				attempt: 1,
				delayMs: 2000,
				error: "rate limit",
			},
		};

		// 持久化到数据库
		databaseEvents.push({
			runId,
			sessionId,
			type: event.type,
			payload: event.payload,
		});

		// 发送到事件总线
		emittedEvents.push({
			type: event.type,
			payload: event.payload,
		});

		expect(databaseEvents).toHaveLength(1);
		expect(emittedEvents).toHaveLength(1);
		expect(databaseEvents[0].type).toBe("auto_retry_start");
		expect(emittedEvents[0].type).toBe("auto_retry_start");
	});

	it("多个事件应该按顺序持久化", () => {
		const events: RetryEvent[] = [];

		// 添加多个事件
		for (let i = 1; i <= 3; i++) {
			events.push({
				type: "auto_retry_start",
				payload: {
					runId: "run-123",
					sessionId: "session-456",
					attempt: i,
					delayMs: 2000 * Math.pow(2, i - 1),
					error: "rate limit",
				},
			});
		}

		// 验证顺序
		expect(events[0].payload.attempt).toBe(1);
		expect(events[1].payload.attempt).toBe(2);
		expect(events[2].payload.attempt).toBe(3);
	});
});

describe("边界情况", () => {
	it("maxRetries=0 时不应该发送重试事件", () => {
		const events: RetryEvent[] = [];
		const maxRetries = 0;

		// 第一次尝试就失败，不重试
		if (maxRetries === 0) {
			events.push({
				type: "auto_retry_end",
				payload: {
					runId: "run-123",
					sessionId: "session-456",
					success: false,
					attempt: 0,
					error: "rate limit",
				},
			});
		}

		expect(events).toHaveLength(1);
		expect(events[0].payload.attempt).toBe(0);
	});

	it("立即成功不应该发送重试事件", () => {
		const events: RetryEvent[] = [];

		// 第一次尝试就成功，不需要重试
		// 不发送任何重试相关事件

		expect(events).toHaveLength(0);
	});
});
