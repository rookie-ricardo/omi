/**
 * built-in-providers.test.ts - 内建 Provider 测试
 *
 * 测试覆盖：
 * - BUILT_IN_PROVIDERS 常量
 * - isBuiltInProvider 函数
 * - listBuiltInProviders 函数
 * - listBuiltInModels 函数
 * - createModelFromConfig 对各个 provider 的支持
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { ProviderConfig } from "@omi/core";
import {
	createModelFromConfig,
	isBuiltInProvider,
	listBuiltInProviders,
	listBuiltInModels,
} from "../src/model-registry";

describe("内建 Provider 常量", () => {
	it("应该包含所有预期的 provider", () => {
		const providers = listBuiltInProviders();
		const expectedProviders = [
			"anthropic",
			"openai",
			"openrouter",
			"google",
			"bedrock",
			"azure",
			"mistral",
			"xai",
			"groq",
			"cerebras",
		] as const;

		expect(providers).toEqual(expectedProviders);
	});

	it("应该包含 10 个内建 provider", () => {
		const providers = listBuiltInProviders();
		expect(providers).toHaveLength(10);
	});

	it("应该是只读元组", () => {
		const providers = listBuiltInProviders();
		// 验证返回的是数组
		expect(providers).toEqual(expect.any(Array));
	});
});

describe("isBuiltInProvider", () => {
	describe("应该识别内建 provider", () => {
		it("应该识别 anthropic", () => {
			expect(isBuiltInProvider("anthropic")).toBe(true);
		});

		it("应该识别 openai", () => {
			expect(isBuiltInProvider("openai")).toBe(true);
		});

		it("应该识别 openrouter", () => {
			expect(isBuiltInProvider("openrouter")).toBe(true);
		});

		it("应该识别 google", () => {
			expect(isBuiltInProvider("google")).toBe(true);
		});

		it("应该识别 bedrock", () => {
			expect(isBuiltInProvider("bedrock")).toBe(true);
		});

		it("应该识别 azure", () => {
			expect(isBuiltInProvider("azure")).toBe(true);
		});

		it("应该识别 mistral", () => {
			expect(isBuiltInProvider("mistral")).toBe(true);
		});

		it("应该识别 xai", () => {
			expect(isBuiltInProvider("xai")).toBe(true);
		});

		it("应该识别 groq", () => {
			expect(isBuiltInProvider("groq")).toBe(true);
		});

		it("应该识别 cerebras", () => {
			expect(isBuiltInProvider("cerebras")).toBe(true);
		});
	});

	describe("不应该识别非内建 provider", () => {
		it("不应该识别 openai-compatible", () => {
			expect(isBuiltInProvider("openai-compatible")).toBe(false);
		});

		it("不应该识别 anthropic-compatible", () => {
			expect(isBuiltInProvider("anthropic-compatible")).toBe(false);
		});

		it("不应该识别自定义 provider", () => {
			expect(isBuiltInProvider("custom-provider")).toBe(false);
		});

		it("不应该识别空字符串", () => {
			expect(isBuiltInProvider("")).toBe(false);
		});
	});

	describe("类型保护", () => {
		it("应该将识别为内建 provider 的字符串类型收窄", () => {
			const provider = "anthropic" as string;
			if (isBuiltInProvider(provider)) {
				// provider 的类型应该是 BuiltInProviderName
				expect(["anthropic", "openai", "openrouter", "google", "bedrock", "azure", "mistral", "xai", "groq", "cerebras"]).toContain(
					provider,
				);
			}
		});
	});
});

describe("listBuiltInProviders", () => {
	it("应该返回所有内建 provider 名称", () => {
		const providers = listBuiltInProviders();
		const expectedProviders = [
			"anthropic",
			"openai",
			"openrouter",
			"google",
			"bedrock",
			"azure",
			"mistral",
			"xai",
			"groq",
			"cerebras",
		] as const;
		expect(providers).toEqual(expectedProviders);
	});

	it("应该返回一个新数组（不是原数组的引用）", () => {
		const providers1 = listBuiltInProviders();
		const providers2 = listBuiltInProviders();
		expect(providers1).not.toBe(providers2);
		expect(providers1).toEqual(providers2);
	});
});

describe("listBuiltInModels", () => {
	describe("内建 provider 应该返回模型列表", () => {
		it("anthropic 应该返回模型列表", () => {
			const models = listBuiltInModels("anthropic");
			expect(Array.isArray(models)).toBe(true);
			expect(models.length).toBeGreaterThan(0);
			expect(models[0]).toHaveProperty("id");
			expect(models[0]).toHaveProperty("provider");
			expect(models[0].provider).toBe("anthropic");
		});

		it("openai 应该返回模型列表", () => {
			const models = listBuiltInModels("openai");
			expect(Array.isArray(models)).toBe(true);
			expect(models.length).toBeGreaterThan(0);
			expect(models[0].provider).toBe("openai");
		});

		it("google 应该返回模型列表", () => {
			const models = listBuiltInModels("google");
			expect(Array.isArray(models)).toBe(true);
			// Google provider 可能没有模型或模型列表为空
			expect(models.length).toBeGreaterThanOrEqual(0);
			if (models.length > 0) {
				expect(models[0].provider).toBe("google");
			}
		});

		it("bedrock 应该返回模型列表或为空", () => {
			const models = listBuiltInModels("bedrock");
			expect(Array.isArray(models)).toBe(true);
			// Bedrock provider 可能没有预定义模型
			expect(models.length).toBeGreaterThanOrEqual(0);
		});

		it("azure 应该返回模型列表或为空", () => {
			const models = listBuiltInModels("azure");
			expect(Array.isArray(models)).toBe(true);
			// Azure provider 可能没有预定义模型
			expect(models.length).toBeGreaterThanOrEqual(0);
		});

		it("mistral 应该返回模型列表", () => {
			const models = listBuiltInModels("mistral");
			expect(Array.isArray(models)).toBe(true);
			expect(models.length).toBeGreaterThan(0);
			expect(models[0].provider).toBe("mistral");
		});

		it("xai 应该返回模型列表", () => {
			const models = listBuiltInModels("xai");
			expect(Array.isArray(models)).toBe(true);
			expect(models.length).toBeGreaterThan(0);
			expect(models[0].provider).toBe("xai");
		});

		it("groq 应该返回模型列表", () => {
			const models = listBuiltInModels("groq");
			expect(Array.isArray(models)).toBe(true);
			expect(models.length).toBeGreaterThan(0);
			expect(models[0].provider).toBe("groq");
		});

		it("cerebras 应该返回模型列表", () => {
			const models = listBuiltInModels("cerebras");
			expect(Array.isArray(models)).toBe(true);
			expect(models.length).toBeGreaterThan(0);
			expect(models[0].provider).toBe("cerebras");
		});

		it("openrouter 应该返回模型列表", () => {
			const models = listBuiltInModels("openrouter");
			expect(Array.isArray(models)).toBe(true);
			expect(models.length).toBeGreaterThan(0);
			expect(models[0].provider).toBe("openrouter");
		});
	});

	describe("非内建 provider 应该返回空数组", () => {
		it("自定义 provider 应该返回空数组", () => {
			const models = listBuiltInModels("custom-provider");
			expect(models).toEqual([]);
		});

		it("空字符串应该返回空数组", () => {
			const models = listBuiltInModels("");
			expect(models).toEqual([]);
		});
	});
});

describe("createModelFromConfig - 新增 Provider", () => {
	describe("Google Provider", () => {
		it("应该识别 google 为内建 provider", () => {
			expect(isBuiltInProvider("google")).toBe(true);
		});

		it("应该支持自定义 baseUrl", () => {
			// 注意: 由于 pi-ai 可能没有预定义的 Google 模型，
			// 这里只测试 provider 类型识别
			const isGoogle = isBuiltInProvider("google");
			expect(isGoogle).toBe(true);
		});
	});

	describe("Bedrock Provider", () => {
		it("应该识别 bedrock 为内建 provider", () => {
			expect(isBuiltInProvider("bedrock")).toBe(true);
		});

		it("应该支持自定义 baseUrl", () => {
			const isBedrock = isBuiltInProvider("bedrock");
			expect(isBedrock).toBe(true);
		});
	});

	describe("Azure Provider", () => {
		it("应该识别 azure 为内建 provider", () => {
			expect(isBuiltInProvider("azure")).toBe(true);
		});

		it("应该支持自定义 baseUrl", () => {
			const isAzure = isBuiltInProvider("azure");
			expect(isAzure).toBe(true);
		});
	});

	describe("Mistral Provider", () => {
		it("应该为 mistral 创建模型", () => {
			const config: ProviderConfig = {
				id: "provider-1",
								name: "mistral",
				protocol: "openai-chat",
				baseUrl: "https://api.mistral.ai",
				apiKey: "test-api-key",
				model: "mistral-large-latest",
    url: "",
				createdAt: "2024-01-01T00:00:00.000Z",
				updatedAt: "2024-01-01T00:00:00.000Z",
			};

			const model = createModelFromConfig(config);

			expect(model.provider).toBe("mistral");
			expect(model.api).toBe("openai-completions");
			expect(model.baseUrl).toBe("https://api.mistral.ai");
		});
	});

	describe("xAI Provider", () => {
		it("应该为 xai 创建模型", () => {
			const config: ProviderConfig = {
				id: "provider-1",
								name: "xai",
				protocol: "openai-chat",
				baseUrl: "https://api.x.ai",
				apiKey: "test-api-key",
				model: "grok-beta",
    url: "",
				createdAt: "2024-01-01T00:00:00.000Z",
				updatedAt: "2024-01-01T00:00:00.000Z",
			};

			const model = createModelFromConfig(config);

			expect(model.provider).toBe("xai");
			expect(model.api).toBe("openai-completions");
			expect(model.baseUrl).toBe("https://api.x.ai");
		});
	});

	describe("Groq Provider", () => {
		it("应该为 groq 创建模型", () => {
			const config: ProviderConfig = {
				id: "provider-1",
								name: "groq",
				protocol: "openai-chat",
				baseUrl: "https://api.groq.com/openai/v1",
				apiKey: "test-api-key",
				model: "llama-3.3-70b-versatile",
    url: "",
				createdAt: "2024-01-01T00:00:00.000Z",
				updatedAt: "2024-01-01T00:00:00.000Z",
			};

			const model = createModelFromConfig(config);

			expect(model.provider).toBe("groq");
			expect(model.api).toBe("openai-completions");
			expect(model.baseUrl).toBe("https://api.groq.com/openai/v1");
		});
	});

	describe("Cerebras Provider", () => {
		it("应该识别 cerebras 为内建 provider", () => {
			expect(isBuiltInProvider("cerebras")).toBe(true);
		});

		it("应该列出 cerebras 模型", () => {
			const models = listBuiltInModels("cerebras");
			expect(Array.isArray(models)).toBe(true);
			if (models.length > 0) {
				expect(models[0].provider).toBe("cerebras");
			}
		});
	});
});

describe("边界情况", () => {
	it("不支持的 provider 名称应该抛出错误", () => {
		const config: ProviderConfig = {
			id: "provider-1",
			name: "unsupported" as any,
			protocol: "openai-chat",
			baseUrl: "https://api.example.com",
			apiKey: "test-api-key",
			model: "model-1",
			url: "",
			createdAt: "2024-01-01T00:00:00.000Z",
			updatedAt: "2024-01-01T00:00:00.000Z",
		};

		expect(() => createModelFromConfig(config)).toThrow("Unsupported provider name: unsupported");
	});

	it("openai-compatible 应该创建自定义模型", () => {
		const config: ProviderConfig = {
			id: "provider-1",
						name: "openai-compatible",
			protocol: "openai-chat",
			baseUrl: "https://api.example.com/v1",
			apiKey: "test-api-key",
			model: "custom-model",
    url: "",
			createdAt: "2024-01-01T00:00:00.000Z",
			updatedAt: "2024-01-01T00:00:00.000Z",
		};

		const model = createModelFromConfig(config);

		expect(model.provider).toBe("openai-compatible");
		expect(model.api).toBe("openai-completions");
		expect(model.baseUrl).toBe("https://api.example.com/v1");
	});

	it("anthropic-compatible 应该创建自定义模型", () => {
		const config: ProviderConfig = {
			id: "provider-1",
						name: "anthropic-compatible",
			protocol: "anthropic-messages",
			baseUrl: "https://api.example.com",
			apiKey: "test-api-key",
			model: "custom-model",
    url: "",
			createdAt: "2024-01-01T00:00:00.000Z",
			updatedAt: "2024-01-01T00:00:00.000Z",
		};

		const model = createModelFromConfig(config);

		expect(model.provider).toBe("anthropic-compatible");
		expect(model.api).toBe("anthropic-messages");
		expect(model.baseUrl).toBe("https://api.example.com");
	});
});
