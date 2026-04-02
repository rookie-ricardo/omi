/**
 * retry-functions.test.ts - Compaction 重试函数测试
 *
 * 测试覆盖：
 * - isRetryableError 函数（从 @omi/memory 导出）
 * - isOverflowError 函数（从 @omi/memory 导出）
 * - extractRetryAfterDelay 函数（从 @omi/memory 导出）
 *
 * 注意：这些函数在 packages/memory/src/compaction.ts 中定义
 */

import { describe, it, expect } from "vitest";
import {
	isRetryableError,
	isOverflowError,
	extractRetryAfterDelay,
} from "@omi/memory";

describe("compaction.ts 重试函数", () => {
	describe("isRetryableError", () => {
		describe("应该识别可重试的临时错误", () => {
			it("应该识别 overloaded 错误", () => {
				expect(isRetryableError(new Error("overloaded"))).toBe(true);
				expect(isRetryableError(new Error("server is overloaded"))).toBe(true);
			});

			it("应该识别 rate limit 错误", () => {
				expect(isRetryableError(new Error("rate limit"))).toBe(true);
				expect(isRetryableError(new Error("ratelimit"))).toBe(true);
				expect(isRetryableError(new Error("rate_limit"))).toBe(true);
			});

			it("应该识别 429 状态码", () => {
				expect(isRetryableError(new Error("429"))).toBe(true);
				expect(isRetryableError(new Error("HTTP 429"))).toBe(true);
			});

			it("应该识别 5xx 服务器错误", () => {
				expect(isRetryableError(new Error("500"))).toBe(true);
				expect(isRetryableError(new Error("502"))).toBe(true);
				expect(isRetryableError(new Error("503"))).toBe(true);
				expect(isRetryableError(new Error("504"))).toBe(true);
			});

			it("应该识别网络错误", () => {
				expect(isRetryableError(new Error("network error"))).toBe(true);
				expect(isRetryableError(new Error("connection refused"))).toBe(true);
				expect(isRetryableError(new Error("fetch failed"))).toBe(true);
				expect(isRetryableError(new Error("timeout"))).toBe(true);
			});

			it("应该识别 ECONNREFUSED", () => {
				expect(isRetryableError(new Error("ECONNREFUSED"))).toBe(true);
			});

			it("应该识别 ETIMEDOUT", () => {
				expect(isRetryableError(new Error("ETIMEDOUT"))).toBe(true);
			});

			it("应该识别 socket hang up", () => {
				expect(isRetryableError(new Error("socket hang up"))).toBe(true);
			});
		});

		describe("不应该识别不可重试的错误", () => {
			it("不应该识别 overflow 错误（由单独的处理路径）", () => {
				expect(isRetryableError(new Error("context length exceeded"))).toBe(false);
				expect(isRetryableError(new Error("maximum context length exceeded"))).toBe(false);
				expect(isRetryableError(new Error("too many tokens"))).toBe(false);
			});

			it("不应该识别认证错误", () => {
				expect(isRetryableError(new Error("401"))).toBe(false);
				expect(isRetryableError(new Error("Unauthorized"))).toBe(false);
				expect(isRetryableError(new Error("Invalid API key"))).toBe(false);
			});

			it("不应该识别权限错误", () => {
				expect(isRetryableError(new Error("403"))).toBe(false);
				expect(isRetryableError(new Error("Forbidden"))).toBe(false);
			});

			it("不应该识别客户端错误 (4xx)", () => {
				expect(isRetryableError(new Error("400"))).toBe(false);
				expect(isRetryableError(new Error("404"))).toBe(false);
			});
		});

		describe("边界情况", () => {
			it("应该处理空错误消息", () => {
				expect(isRetryableError(new Error(""))).toBe(false);
			});

			it("应该处理非 Error 对象", () => {
				expect(isRetryableError("string error")).toBe(false);
				expect(isRetryableError(null)).toBe(false);
				expect(isRetryableError(undefined)).toBe(false);
			});

			it("应该处理包含多个错误信息的消息", () => {
				expect(
					isRetryableError(new Error("Request timeout: Connection refused after 30s")),
				).toBe(true);
			});
		});
	});

	describe("isOverflowError", () => {
		describe("应该识别 context overflow 错误", () => {
			it("应该识别 'context length exceeded'", () => {
				expect(isOverflowError(new Error("context length exceeded"))).toBe(true);
			});

			it("应该识别 'maximum context length exceeded'", () => {
				expect(isOverflowError(new Error("maximum context length exceeded"))).toBe(true);
			});

			it("应该识别 'too many tokens'", () => {
				expect(isOverflowError(new Error("too many tokens"))).toBe(true);
			});
		});

		describe("不应该识别非 overflow 错误", () => {
			it("不应该识别 rate limit 错误", () => {
				expect(isOverflowError(new Error("rate limit"))).toBe(false);
			});

			it("不应该识别 timeout 错误", () => {
				expect(isOverflowError(new Error("timeout"))).toBe(false);
			});

			it("不应该识别 500 错误", () => {
				expect(isOverflowError(new Error("500"))).toBe(false);
			});
		});

		describe("边界情况", () => {
			it("应该处理空错误消息", () => {
				expect(isOverflowError(new Error(""))).toBe(false);
			});

			it("应该处理非 Error 对象", () => {
				expect(isOverflowError("string")).toBe(false);
				expect(isOverflowError(null)).toBe(false);
				expect(isOverflowError(undefined)).toBe(false);
			});
		});
	});

	describe("extractRetryAfterDelay", () => {
		describe("应该提取以秒为单位的延迟", () => {
			it("应该提取 'retry after Xs'", () => {
				expect(extractRetryAfterDelay(new Error("retry after 5s"))).toBe(5000);
				expect(extractRetryAfterDelay(new Error("retry after 10s"))).toBe(10000);
			});

			it("应该提取 'retry after X sec/seconds'", () => {
				expect(extractRetryAfterDelay(new Error("retry after 5 sec"))).toBe(5000);
				expect(extractRetryAfterDelay(new Error("retry after 10 seconds"))).toBe(10000);
			});

			it("应该提取 'try again in X seconds'", () => {
				expect(extractRetryAfterDelay(new Error("try again in 3 seconds"))).toBe(3000);
				expect(extractRetryAfterDelay(new Error("try again in 30 seconds"))).toBe(30000);
			});

			it("应该提取 'wait X s/sec/seconds'", () => {
				expect(extractRetryAfterDelay(new Error("wait 5s"))).toBe(5000);
				expect(extractRetryAfterDelay(new Error("wait 10 seconds"))).toBe(10000);
			});

			it("应该提取 'delay X s/sec/seconds'", () => {
				expect(extractRetryAfterDelay(new Error("delay 2s"))).toBe(2000);
				expect(extractRetryAfterDelay(new Error("delay 15 seconds"))).toBe(15000);
			});
		});

		describe("应该提取以毫秒为单位的延迟", () => {
			it("应该提取 'retry after Xms'", () => {
				expect(extractRetryAfterDelay(new Error("retry after 500ms"))).toBe(500);
				expect(extractRetryAfterDelay(new Error("retry after 1000ms"))).toBe(1000);
			});

			it("应该提取 'retry after X millisecond/milliseconds'", () => {
				expect(extractRetryAfterDelay(new Error("retry after 500 millisecond"))).toBe(500);
				expect(extractRetryAfterDelay(new Error("retry after 1000 milliseconds"))).toBe(1000);
			});
		});

		describe("不应该提取不存在的延迟", () => {
			it("应该返回 undefined 当没有延迟信息时", () => {
				expect(extractRetryAfterDelay(new Error("rate limit"))).toBeUndefined();
				expect(extractRetryAfterDelay(new Error("timeout"))).toBeUndefined();
				expect(extractRetryAfterDelay(new Error("500"))).toBeUndefined();
			});

			it("应该返回 undefined 对于空错误消息", () => {
				expect(extractRetryAfterDelay(new Error(""))).toBeUndefined();
			});
		});

		describe("边界情况", () => {
			it("应该处理空错误消息", () => {
				expect(extractRetryAfterDelay(new Error(""))).toBeUndefined();
			});

			it("应该处理非 Error 对象", () => {
				expect(extractRetryAfterDelay("retry after 5s")).toBe(5000);
				expect(extractRetryAfterDelay(null)).toBeUndefined();
				expect(extractRetryAfterDelay(undefined)).toBeUndefined();
				expect(extractRetryAfterDelay(12345)).toBeUndefined();
			});

			it("应该处理错误的延迟格式", () => {
				expect(extractRetryAfterDelay(new Error("retry after s"))).toBeUndefined();
				expect(extractRetryAfterDelay(new Error("retry after abc seconds"))).toBeUndefined();
			});

			it("应该处理延迟为零的情况", () => {
				expect(extractRetryAfterDelay(new Error("retry after 0s"))).toBe(0);
				expect(extractRetryAfterDelay(new Error("retry after 0ms"))).toBe(0);
			});

			it("应该处理大数值", () => {
				expect(extractRetryAfterDelay(new Error("retry after 3600s"))).toBe(3600000);
				expect(extractRetryAfterDelay(new Error("retry after 60000ms"))).toBe(60000);
			});
		});
	});

	describe("错误分类协同测试", () => {
		it("overflow 错误应该被正确分类", () => {
			const overflowError = new Error("context length exceeded");
			expect(isOverflowError(overflowError)).toBe(true);
			expect(isRetryableError(overflowError)).toBe(false);
		});

		it("rate limit 错误应该被正确分类", () => {
			const rateLimitError = new Error("rate limit exceeded");
			expect(isOverflowError(rateLimitError)).toBe(false);
			expect(isRetryableError(rateLimitError)).toBe(true);
		});

		it("500 错误应该被正确分类", () => {
			const serverError = new Error("Internal Server Error 500");
			expect(isOverflowError(serverError)).toBe(false);
			expect(isRetryableError(serverError)).toBe(true);
		});

		it("包含延迟信息的错误应该能提取延迟", () => {
			const rateLimitWithDelay = new Error("rate limit, retry after 5s");
			expect(isRetryableError(rateLimitWithDelay)).toBe(true);
			expect(extractRetryAfterDelay(rateLimitWithDelay)).toBe(5000);
		});
	});
});
