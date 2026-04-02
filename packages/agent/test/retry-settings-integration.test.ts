/**
 * retry-settings-integration.test.ts - Settings 配置集成测试
 *
 * 测试覆盖：
 * - RetrySettings 接口
 * - getRetrySettings 方法
 * - 默认值
 * - 配置覆盖
 * - 禁用重试
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SettingsManager, type RetrySettings } from "@omi/settings";

describe("RetrySettings 接口", () => {
	it("应该包含所有必需的字段", () => {
		const settings: RetrySettings = {
			enabled: true,
			maxRetries: 3,
			baseDelayMs: 2000,
			maxDelayMs: 60000,
		};

		expect(settings.enabled).toBeDefined();
		expect(settings.maxRetries).toBeDefined();
		expect(settings.baseDelayMs).toBeDefined();
		expect(settings.maxDelayMs).toBeDefined();
	});

	it("所有字段都应该是可选的", () => {
		const partialSettings: Partial<RetrySettings> = {
			enabled: true,
		};

		expect(partialSettings.enabled).toBe(true);
		expect(partialSettings.maxRetries).toBeUndefined();
	});
});

describe("SettingsManager - getRetrySettings 方法", () => {
	let settingsManager: SettingsManager;

	beforeEach(() => {
		// 创建一个内存中的 SettingsManager 用于测试
		settingsManager = SettingsManager.inMemory();
	});

	describe("默认值", () => {
		it("应该返回默认的 retry settings", () => {
			const retrySettings = settingsManager.getRetrySettings();

			expect(retrySettings).toEqual({
				enabled: true,
				maxRetries: 3,
				baseDelayMs: 2000,
				maxDelayMs: 60000,
			});
		});

		it("默认应该启用重试", () => {
			const retrySettings = settingsManager.getRetrySettings();
			expect(retrySettings.enabled).toBe(true);
		});

		it("默认 maxRetries 应该是 3", () => {
			const retrySettings = settingsManager.getRetrySettings();
			expect(retrySettings.maxRetries).toBe(3);
		});

		it("默认 baseDelayMs 应该是 2000 (2秒)", () => {
			const retrySettings = settingsManager.getRetrySettings();
			expect(retrySettings.baseDelayMs).toBe(2000);
		});

		it("默认 maxDelayMs 应该是 60000 (60秒)", () => {
			const retrySettings = settingsManager.getRetrySettings();
			expect(retrySettings.maxDelayMs).toBe(60000);
		});
	});

	describe("配置覆盖", () => {
		it("应该支持自定义 retry settings", () => {
			settingsManager.applyOverrides({
				retry: {
					enabled: false,
					maxRetries: 5,
					baseDelayMs: 5000,
					maxDelayMs: 120000,
				},
			});

			const retrySettings = settingsManager.getRetrySettings();

			expect(retrySettings.enabled).toBe(false);
			expect(retrySettings.maxRetries).toBe(5);
			expect(retrySettings.baseDelayMs).toBe(5000);
			expect(retrySettings.maxDelayMs).toBe(120000);
		});

		it("应该支持部分覆盖", () => {
			settingsManager.applyOverrides({
				retry: {
					maxRetries: 10,
				},
			});

			const retrySettings = settingsManager.getRetrySettings();

			// maxRetries 被覆盖
			expect(retrySettings.maxRetries).toBe(10);
			// 其他值使用默认值
			expect(retrySettings.enabled).toBe(true);
			expect(retrySettings.baseDelayMs).toBe(2000);
			expect(retrySettings.maxDelayMs).toBe(60000);
		});

		it("应该支持设置 enabled 为 false", () => {
			settingsManager.applyOverrides({
				retry: {
					enabled: false,
				},
			});

			const retrySettings = settingsManager.getRetrySettings();
			expect(retrySettings.enabled).toBe(false);
		});
	});

	describe("getRetryEnabled 方法", () => {
		it("默认应该返回 true", () => {
			expect(settingsManager.getRetryEnabled()).toBe(true);
		});

		it("应该返回配置的 enabled 值", () => {
			settingsManager.applyOverrides({
				retry: {
					enabled: false,
				},
			});

			expect(settingsManager.getRetryEnabled()).toBe(false);
		});
	});

	describe("setRetryEnabled 方法", () => {
		it("应该能够设置 enabled 为 false", () => {
			settingsManager.setRetryEnabled(false);

			expect(settingsManager.getRetryEnabled()).toBe(false);
			expect(settingsManager.getRetrySettings().enabled).toBe(false);
		});

		it("应该能够设置 enabled 为 true", () => {
			settingsManager.setRetryEnabled(false);
			expect(settingsManager.getRetryEnabled()).toBe(false);

			settingsManager.setRetryEnabled(true);
			expect(settingsManager.getRetryEnabled()).toBe(true);
		});
	});
});

describe("AgentSession 中的 Settings 集成", () => {
	describe("使用默认 settings", () => {
		it("应该使用默认的 retry settings", () => {
			// 模拟没有 settingsManager 的情况
			const settingsManager = SettingsManager.inMemory();
			const retrySettings = settingsManager.getRetrySettings();

			expect(retrySettings).toEqual({
				enabled: true,
				maxRetries: 3,
				baseDelayMs: 2000,
				maxDelayMs: 60000,
			});
		});

		it("应该能够基于 settings 计算延迟", () => {
			const settingsManager = SettingsManager.inMemory();
			const retrySettings = settingsManager.getRetrySettings();

			const baseDelayMs = retrySettings.baseDelayMs;
			const attempt = 1;
			const delayMs = baseDelayMs * Math.pow(2, attempt);

			expect(delayMs).toBe(4000); // 2000 * 2^1
		});

		it("应该能够基于 settings 判断是否重试", () => {
			const settingsManager = SettingsManager.inMemory();
			const retrySettings = settingsManager.getRetrySettings();

			const maxRetries = retrySettings.maxRetries;
			const attempt = 2;

			expect(shouldAttemptRetry(attempt, maxRetries, retrySettings.enabled)).toBe(true);
			expect(shouldAttemptRetry(maxRetries + 1, maxRetries, retrySettings.enabled)).toBe(false);
		});
	});

	describe("使用自定义 settings", () => {
		it("应该使用自定义的 retry settings", () => {
			const settingsManager = SettingsManager.inMemory({
				retry: {
					enabled: false,
					maxRetries: 5,
					baseDelayMs: 1000,
					maxDelayMs: 30000,
				},
			});

			const retrySettings = settingsManager.getRetrySettings();

			expect(retrySettings).toEqual({
				enabled: false,
				maxRetries: 5,
				baseDelayMs: 1000,
				maxDelayMs: 30000,
			});
		});

		it("enabled=false 时应该禁用重试", () => {
			const settingsManager = SettingsManager.inMemory({
				retry: {
					enabled: false,
				},
			});

			const retrySettings = settingsManager.getRetrySettings();

			expect(retrySettings.enabled).toBe(false);
			expect(shouldAttemptRetry(0, 3, retrySettings.enabled)).toBe(false);
		});

		it("自定义 maxRetries 应该生效", () => {
			const settingsManager = SettingsManager.inMemory({
				retry: {
					maxRetries: 10,
				},
			});

			const retrySettings = settingsManager.getRetrySettings();

			expect(retrySettings.maxRetries).toBe(10);
			expect(shouldAttemptRetry(10, retrySettings.maxRetries, retrySettings.enabled)).toBe(true);
			expect(shouldAttemptRetry(11, retrySettings.maxRetries, retrySettings.enabled)).toBe(false);
		});

		it("自定义 baseDelayMs 应该影响延迟计算", () => {
			const settingsManager = SettingsManager.inMemory({
				retry: {
					baseDelayMs: 5000,
				},
			});

			const retrySettings = settingsManager.getRetrySettings();
			const attempt = 2;
			const delayMs = retrySettings.baseDelayMs * Math.pow(2, attempt);

			expect(delayMs).toBe(20000); // 5000 * 2^2
		});

		it("自定义 maxDelayMs 应该限制最大延迟", () => {
			const settingsManager = SettingsManager.inMemory({
				retry: {
					baseDelayMs: 10000,
					maxDelayMs: 15000,
				},
			});

			const retrySettings = settingsManager.getRetrySettings();
			const attempt = 3;
			const exponentialDelay = retrySettings.baseDelayMs * Math.pow(2, attempt);
			const delayMs = Math.min(exponentialDelay, retrySettings.maxDelayMs);

			// 10000 * 2^3 = 80000, 但 maxDelayMs = 15000
			expect(delayMs).toBe(15000);
		});
	});
});

describe("边界情况", () => {
	it("应该处理 baseDelayMs 为 0", () => {
		const settingsManager = SettingsManager.inMemory({
			retry: {
				baseDelayMs: 0,
			},
		});

		const retrySettings = settingsManager.getRetrySettings();
		expect(retrySettings.baseDelayMs).toBe(0);
	});

	it("应该处理 maxRetries 为 0", () => {
		const settingsManager = SettingsManager.inMemory({
			retry: {
				maxRetries: 0,
			},
		});

		const retrySettings = settingsManager.getRetrySettings();
		expect(retrySettings.maxRetries).toBe(0);
	});

	it("应该处理 maxDelayMs 为 0", () => {
		const settingsManager = SettingsManager.inMemory({
			retry: {
				maxDelayMs: 0,
			},
		});

		const retrySettings = settingsManager.getRetrySettings();
		expect(retrySettings.maxDelayMs).toBe(0);
	});

	it("应该处理负数值（虽然不应该设置）", () => {
		const settingsManager = SettingsManager.inMemory({
			retry: {
				maxRetries: -1, // 无效但测试边界
			} as any,
		});

		const retrySettings = settingsManager.getRetrySettings();
		// 实际实现可能会验证输入，这里只测试返回值
		expect(retrySettings.maxRetries).toBe(-1);
	});
});

// ============================================================================
// 辅助函数
// ============================================================================

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
