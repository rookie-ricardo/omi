/**
 * is-retryable-error.test.ts - 可重试错误识别测试
 *
 * 测试覆盖：
 * - isRetryableError - 可重试错误识别
 * - isOverflowError - Context Overflow 错误识别
 * - extractRetryAfterDelay - 从错误中提取重试延迟
 * - 边界情况
 */

import { describe, it, expect } from "vitest";
import {
	isRetryableError,
	isOverflowError,
	extractRetryAfterDelay,
} from "@omi/memory";

describe("isRetryableError - 可重试错误识别", () => {
	describe("应该识别 rate_limit 错误", () => {
		it("应该识别 'rate limit' 错误", () => {
			expect(isRetryableError(new Error("Rate limit exceeded"))).toBe(true);
			expect(isRetryableError(new Error("rate_limit_error"))).toBe(true);
		});

		it("应该识别 'rate limit' 的各种变体", () => {
			expect(isRetryableError(new Error("Rate limit reached"))).toBe(true);
			expect(isRetryableError(new Error("RateLimited"))).toBe(true);
			expect(isRetryableError(new Error("RATE_LIMIT"))).toBe(true);
		});
	});

	describe("应该识别 overloaded 错误", () => {
		it("应该识别 'overloaded' 错误", () => {
			expect(isRetryableError(new Error("Service is overloaded"))).toBe(true);
			expect(isRetryableError(new Error("overloaded_error"))).toBe(true);
		});
	});

	describe("应该识别 429 状态码", () => {
		it("应该识别 429 状态码", () => {
			expect(isRetryableError(new Error("HTTP 429"))).toBe(true);
			expect(isRetryableError(new Error("Status: 429"))).toBe(true);
			expect(isRetryableError(new Error("Error code 429"))).toBe(true);
		});
	});

	describe("应该识别 5xx 服务器错误", () => {
		it("应该识别 500 错误", () => {
			expect(isRetryableError(new Error("Internal Server Error 500"))).toBe(true);
			expect(isRetryableError(new Error("HTTP 500"))).toBe(true);
		});

		it("应该识别 502 错误", () => {
			expect(isRetryableError(new Error("Bad Gateway 502"))).toBe(true);
			expect(isRetryableError(new Error("HTTP 502"))).toBe(true);
		});

		it("应该识别 503 错误", () => {
			expect(isRetryableError(new Error("Service Unavailable 503"))).toBe(true);
			expect(isRetryableError(new Error("HTTP 503"))).toBe(true);
		});

		it("应该识别 504 错误", () => {
			expect(isRetryableError(new Error("Gateway Timeout 504"))).toBe(true);
			expect(isRetryableError(new Error("HTTP 504"))).toBe(true);
		});
	});

	describe("应该识别网络错误", () => {
		it("应该识别 'network error'", () => {
			expect(isRetryableError(new Error("Network error"))).toBe(true);
			expect(isRetryableError(new Error("network_error"))).toBe(true);
		});

		it("应该识别 'connection refused'", () => {
			expect(isRetryableError(new Error("Connection refused"))).toBe(true);
			expect(isRetryableError(new Error("connection_refused"))).toBe(true);
		});

		it("应该识别 'fetch failed'", () => {
			expect(isRetryableError(new Error("Fetch failed"))).toBe(true);
			expect(isRetryableError(new Error("fetch_failed"))).toBe(true);
		});

		it("应该识别 'timeout'", () => {
			expect(isRetryableError(new Error("Request timeout"))).toBe(true);
			expect(isRetryableError(new Error("timeout error"))).toBe(true);
		});

		it("应该识别 ECONNREFUSED", () => {
			expect(isRetryableError(new Error("ECONNREFUSED"))).toBe(true);
			expect(isRetryableError(new Error("Error: ECONNREFUSED 127.0.0.1:8000"))).toBe(true);
		});

		it("应该识别 ETIMEDOUT", () => {
			expect(isRetryableError(new Error("ETIMEDOUT"))).toBe(true);
			expect(isRetryableError(new Error("Error: ETIMEDOUT"))).toBe(true);
		});

		it("应该识别 'socket hang up'", () => {
			expect(isRetryableError(new Error("socket hang up"))).toBe(true);
			expect(isRetryableError(new Error("Socket hang up error"))).toBe(true);
		});
	});

	describe("不应该识别不可重试的错误", () => {
		it("不应该识别 overflow 错误", () => {
			expect(isRetryableError(new Error("context length exceeded"))).toBe(false);
			expect(isRetryableError(new Error("maximum context length exceeded"))).toBe(false);
			expect(isRetryableError(new Error("too many tokens"))).toBe(false);
		});

		it("不应该识别认证错误", () => {
			expect(isRetryableError(new Error("Unauthorized"))).toBe(false);
			expect(isRetryableError(new Error("401"))).toBe(false);
			expect(isRetryableError(new Error("Invalid API key"))).toBe(false);
		});

		it("不应该识别权限错误", () => {
			expect(isRetryableError(new Error("Forbidden"))).toBe(false);
			expect(isRetryableError(new Error("403"))).toBe(false);
		});

		it("不应该识别客户端错误 (4xx)", () => {
			expect(isRetryableError(new Error("Bad Request 400"))).toBe(false);
			expect(isRetryableError(new Error("Not Found 404"))).toBe(false);
		});

		it("不应该识别语法错误", () => {
			expect(isRetryableError(new Error("Syntax error"))).toBe(false);
			expect(isRetryableError(new Error("Parse error"))).toBe(false);
		});

		it("不应该识别验证错误", () => {
			expect(isRetryableError(new Error("Validation failed"))).toBe(false);
			expect(isRetryableError(new Error("Invalid input"))).toBe(false);
		});
	});

	describe("边界情况", () => {
		it("应该处理空错误消息", () => {
			expect(isRetryableError(new Error(""))).toBe(false);
		});

		it("应该处理非 Error 对象", () => {
			expect(isRetryableError("string error")).toBe(false);
			expect(isRetryableError(12345)).toBe(false);
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

describe("isOverflowError - Context Overflow 错误识别", () => {
	it("应该识别常见的 overflow 模式", () => {
		// 这些模式来自 pi-ai 的 getOverflowPatterns
		expect(isOverflowError(new Error("context length exceeded"))).toBe(true);
		expect(isOverflowError(new Error("maximum context length exceeded"))).toBe(true);
		expect(isOverflowError(new Error("too many tokens"))).toBe(true);
	});

	it("overflow 错误不应该被识别为可重试", () => {
		// Overflow 错误有单独的处理路径
		expect(isRetryableError(new Error("context length exceeded"))).toBe(false);
		expect(isRetryableError(new Error("maximum context length exceeded"))).toBe(false);
	});

	it("非 overflow 错误应该返回 false", () => {
		expect(isOverflowError(new Error("rate limit"))).toBe(false);
		expect(isOverflowError(new Error("timeout"))).toBe(false);
		expect(isOverflowError(new Error("500"))).toBe(false);
	});

	it("应该处理边界情况", () => {
		expect(isOverflowError(new Error(""))).toBe(false);
		expect(isOverflowError(new Error("context"))).toBe(false);
		expect(isOverflowError("string")).toBe(false);
		expect(isOverflowError(null)).toBe(false);
	});
});

describe("extractRetryAfterDelay - 提取重试延迟", () => {
	describe("应该提取以秒为单位的延迟", () => {
		it("应该提取 'retry after Xs'", () => {
			expect(extractRetryAfterDelay(new Error("retry after 5s"))).toBe(5000);
			expect(extractRetryAfterDelay(new Error("Retry after 10s"))).toBe(10000);
		});

		it("应该提取 'retry after X sec/seconds'", () => {
			expect(extractRetryAfterDelay(new Error("retry after 5 sec"))).toBe(5000);
			expect(extractRetryAfterDelay(new Error("retry after 10 seconds"))).toBe(10000);
		});

		it("应该提取 'try again in X seconds'", () => {
			expect(extractRetryAfterDelay(new Error("try again in 3 seconds"))).toBe(3000);
			expect(extractRetryAfterDelay(new Error("Try again in 30 seconds"))).toBe(30000);
		});

		it("应该提取 'wait X s/sec/seconds'", () => {
			expect(extractRetryAfterDelay(new Error("wait 5s"))).toBe(5000);
			expect(extractRetryAfterDelay(new Error("Wait 10 seconds"))).toBe(10000);
		});

		it("应该提取 'delay X s/sec/seconds'", () => {
			expect(extractRetryAfterDelay(new Error("delay 2s"))).toBe(2000);
			expect(extractRetryAfterDelay(new Error("Delay 15 seconds"))).toBe(15000);
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
			// 实际实现会尝试从字符串中提取，所以字符串输入也会工作
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
