/**
 * model-resolver.ts 测试 - 模型解析器
 *
 * 测试覆盖：
 * - findExactModelReferenceMatch - 精确模型匹配
 * - parseModelPattern - 模式解析
 * - resolveModelScope - 模型范围解析
 * - resolveCliModel - CLI 模型解析
 * - findInitialModel - 初始模型查找
 * - restoreModelFromSession - 会话恢复
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Model, Api } from "@mariozechner/pi-ai";
import {
	findExactModelReferenceMatch,
	parseModelPattern,
	resolveModelScope,
	resolveCliModel,
	findInitialModel,
	restoreModelFromSession,
	defaultModelPerProvider,
	type ScopedModel,
	type ModelRegistry,
	type ParsedModelResult,
	type ResolveCliModelResult,
} from "../src/model-resolver";

// Mock model data
const createMockModel = (provider: string, id: string, name?: string): Model<Api> =>
	({ provider, id, name: name ?? id }) as Model<Api>;

const mockModels: Model<Api>[] = [
	createMockModel("anthropic", "claude-opus-4-6", "Claude Opus 4.6"),
	createMockModel("anthropic", "claude-sonnet-4-5-20250929", "Claude Sonnet 4.5"),
	createMockModel("anthropic", "claude-sonnet-4-5-latest", "Claude Sonnet 4.5 Latest"),
	createMockModel("openai", "gpt-5.4", "GPT 5.4"),
	createMockModel("openai", "gpt-4o", "GPT 4o"),
	createMockModel("google", "gemini-2.5-pro", "Gemini 2.5 Pro"),
	createMockModel("openrouter", "openai/gpt-5.1-codex", "OpenAI GPT 5.1 via OpenRouter"),
	createMockModel("openrouter", "anthropic/claude-opus-4-6:extended", "Claude Opus Extended"),
];

// Mock ModelRegistry
const createMockRegistry = (models: Model<Api>[]): ModelRegistry => ({
	getAvailable: async () => models.filter((m) => m.provider !== "test-no-api"),
	getAll: () => models,
	find: (provider, modelId) => models.find((m) => m.provider === provider && m.id === modelId),
	getApiKey: async () => "test-api-key",
});

describe("findExactModelReferenceMatch - 精确模型匹配", () => {
	it("应该通过 provider/modelId 格式匹配", () => {
		const result = findExactModelReferenceMatch("anthropic/claude-opus-4-6", mockModels);
		expect(result?.id).toBe("claude-opus-4-6");
		expect(result?.provider).toBe("anthropic");
	});

	it("应该通过 modelId 精确匹配（唯一）", () => {
		const result = findExactModelReferenceMatch("gpt-5.4", mockModels);
		expect(result?.id).toBe("gpt-5.4");
		expect(result?.provider).toBe("openai");
	});

	it("应该不匹配模糊的 modelId", () => {
		const result = findExactModelReferenceMatch("claude", mockModels);
		expect(result).toBeUndefined();
	});

	it("应该处理大小写不敏感", () => {
		const result = findExactModelReferenceMatch("ANTHROPIC/CLAUDE-OPUS-4-6", mockModels);
		expect(result?.id).toBe("claude-opus-4-6");
	});

	it("应该拒绝有多个匹配的 modelId", () => {
		const ambiguousModels = [
			createMockModel("provider1", "same-id"),
			createMockModel("provider2", "same-id"),
		];
		const result = findExactModelReferenceMatch("same-id", ambiguousModels);
		expect(result).toBeUndefined();
	});

	it("应该处理空字符串", () => {
		const result = findExactModelReferenceMatch("", mockModels);
		expect(result).toBeUndefined();
	});

	it("应该处理空白字符串", () => {
		const result = findExactModelReferenceMatch("  ", mockModels);
		expect(result).toBeUndefined();
	});
});

describe("parseModelPattern - 模式解析", () => {
	it("应该精确匹配模型", () => {
		const result = parseModelPattern("claude-opus-4-6", mockModels);
		expect(result.model).toBeDefined();
		expect(result.model?.id).toBe("claude-opus-4-6");
		expect(result.thinkingLevel).toBeUndefined();
	});

	it("应该支持思考级别后缀", () => {
		const result = parseModelPattern("claude-opus-4-6:high", mockModels);
		expect(result.model?.id).toBe("claude-opus-4-6");
		expect(result.thinkingLevel).toBe("high");
	});

	it("应该处理模型 ID 中的冒号", () => {
		const result = parseModelPattern("anthropic/claude-opus-4-6:extended:medium", mockModels);
		expect(result.model).toBeDefined();
		expect(result.thinkingLevel).toBe("medium");
	});

	it("无效思考级别应该产生警告", () => {
		const result = parseModelPattern("claude-opus-4-6:invalid", mockModels);
		expect(result.model).toBeDefined();
		expect(result.warning).toContain("Invalid thinking level");
	});

	it("严格模式下无效思考级别应该失败", () => {
		const result = parseModelPattern("claude-opus-4-6:invalid", mockModels, {
			allowInvalidThinkingLevelFallback: false,
		});
		expect(result.model).toBeUndefined();
	});

	it("找不到模型时应该返回 undefined", () => {
		const result = parseModelPattern("nonexistent-model", mockModels);
		expect(result.model).toBeUndefined();
	});

	it("应该进行模糊匹配", () => {
		const result = parseModelPattern("sonnet", mockModels);
		expect(result.model).toBeDefined();
		expect(result.model?.id).toContain("sonnet");
	});

	it("应该优先选择别名而非日期版本", () => {
		const result = parseModelPattern("claude-sonnet", mockModels);
		expect(result.model?.id).toBe("claude-sonnet-4-5-latest");
	});

	it("没有别名时应该选择最新日期版本", () => {
		const datedModels = [
			createMockModel("test", "model-20240101"),
			createMockModel("test", "model-20241231"),
		];
		const result = parseModelPattern("model", datedModels);
		expect(result.model?.id).toBe("model-20241231");
	});
});

describe("resolveModelScope - 模型范围解析", () => {
	it("应该解析单一模型模式", async () => {
		const registry = createMockRegistry(mockModels);
		const result = await resolveModelScope(["claude-opus-4-6"], registry);

		expect(result).toHaveLength(1);
		expect(result[0].model.id).toBe("claude-opus-4-6");
	});

	it("应该支持 glob 模式", async () => {
		const registry = createMockRegistry(mockModels);
		const result = await resolveModelScope(["anthropic/*"], registry);

		expect(result.length).toBeGreaterThan(0);
		// glob 模式匹配 "provider/modelId" 格式
		const hasAnthropic = result.some((r) => r.model.provider === "anthropic");
		expect(hasAnthropic).toBe(true);
	});

	it("应该支持带思考级别的 glob 模式", async () => {
		const registry = createMockRegistry(mockModels);
		const result = await resolveModelScope(["anthropic/*:high"], registry);

		expect(result.length).toBeGreaterThan(0);
		expect(result.every((r) => r.thinkingLevel === "high")).toBe(true);
	});

	it("应该去重模型", async () => {
		const registry = createMockRegistry(mockModels);
		const result = await resolveModelScope(
			["claude-opus-4-6", "claude-opus-4-6"],
			registry,
		);

		expect(result).toHaveLength(1);
	});

	it("应该处理带冒号的模型 ID", async () => {
		const registry = createMockRegistry(mockModels);
		const result = await resolveModelScope(
			["anthropic/claude-opus-4-6:extended:medium"],
			registry,
		);

		expect(result).toHaveLength(1);
		expect(result[0].thinkingLevel).toBe("medium");
	});
});

describe("resolveCliModel - CLI 模型解析", () => {
	let registry: ModelRegistry;

	beforeEach(() => {
		registry = createMockRegistry(mockModels);
	});

	it("应该解析 provider/model 格式", () => {
		const result = resolveCliModel({
			cliModel: "anthropic/claude-opus-4-6",
			modelRegistry: registry,
		});

		expect(result.model?.id).toBe("claude-opus-4-6");
		expect(result.error).toBeUndefined();
	});

	it("应该解析 --provider 和 --model 分开的情况", () => {
		const result = resolveCliModel({
			cliProvider: "anthropic",
			cliModel: "claude-opus-4-6",
			modelRegistry: registry,
		});

		expect(result.model?.id).toBe("claude-opus-4-6");
	});

	it("应该处理大小写不敏感的 provider", () => {
		const result = resolveCliModel({
			cliProvider: "ANTHROPIC",
			cliModel: "claude-opus-4-6",
			modelRegistry: registry,
		});

		expect(result.model?.id).toBe("claude-opus-4-6");
	});

	it("未提供 model 时应返回 undefined", () => {
		const result = resolveCliModel({
			modelRegistry: registry,
		});

		expect(result.model).toBeUndefined();
		expect(result.error).toBeUndefined();
	});

	it("未知 provider 应该返回错误", () => {
		const result = resolveCliModel({
			cliProvider: "unknown",
			cliModel: "model",
			modelRegistry: registry,
		});

		expect(result.error).toContain("Unknown provider");
	});

	it("没有可用模型时应该返回错误", () => {
		const emptyRegistry = createMockRegistry([]);
		const result = resolveCliModel({
			cliModel: "any",
			modelRegistry: emptyRegistry,
		});

		expect(result.error).toContain("No models available");
	});
});

describe("findInitialModel - 初始模型查找", () => {
	let registry: ModelRegistry;

	beforeEach(() => {
		registry = createMockRegistry(mockModels);
	});

	it("CLI 参数应该有最高优先级", async () => {
		const result = await findInitialModel({
			cliProvider: "anthropic",
			cliModel: "claude-opus-4-6",
			scopedModels: [],
			isContinuing: false,
			modelRegistry: registry,
		});

		expect(result.model?.id).toBe("claude-opus-4-6");
	});

	it("应该使用第一个 scoped model", async () => {
		const scoped: ScopedModel[] = [
			{ model: mockModels[2], thinkingLevel: "high" },
		];

		const result = await findInitialModel({
			scopedModels: scoped,
			isContinuing: false,
			modelRegistry: registry,
		});

		expect(result.model?.id).toBe("claude-sonnet-4-5-latest");
		expect(result.thinkingLevel).toBe("high");
	});

	it("继续时不应该使用 scoped models", async () => {
		const scoped: ScopedModel[] = [
			{ model: mockModels[0], thinkingLevel: undefined },
		];

		const result = await findInitialModel({
			scopedModels: scoped,
			isContinuing: true,
			defaultProvider: "anthropic",
			defaultModelId: "claude-opus-4-6",
			modelRegistry: registry,
		});

		// 应该使用默认模型而不是 scoped
		expect(result.model?.id).toBe("claude-opus-4-6");
	});

	it("应该使用保存的默认模型", async () => {
		const result = await findInitialModel({
			scopedModels: [],
			isContinuing: false,
			defaultProvider: "openai",
			defaultModelId: "gpt-5.4",
			modelRegistry: registry,
		});

		expect(result.model?.id).toBe("gpt-5.4");
	});

	it("应该回退到第一个可用模型", async () => {
		const result = await findInitialModel({
			scopedModels: [],
			isContinuing: false,
			modelRegistry: registry,
		});

		expect(result.model).toBeDefined();
	});

	it("没有可用模型时应该返回 undefined", async () => {
		const emptyRegistry = createMockRegistry([]);
		const result = await findInitialModel({
			scopedModels: [],
			isContinuing: false,
			modelRegistry: emptyRegistry,
		});

		expect(result.model).toBeUndefined();
	});
});

describe("restoreModelFromSession - 会话恢复", () => {
	let registry: ModelRegistry;

	beforeEach(() => {
		registry = createMockRegistry(mockModels);
	});

	it("应该恢复保存的模型", async () => {
		const result = await restoreModelFromSession(
			"anthropic",
			"claude-opus-4-6",
			undefined,
			false,
			registry,
		);

		expect(result.model?.id).toBe("claude-opus-4-6");
		expect(result.fallbackMessage).toBeUndefined();
	});

	it("模型不存在时应该回退到当前模型", async () => {
		const currentModel = mockModels[0];
		const result = await restoreModelFromSession(
			"nonexistent",
			"model",
			currentModel,
			false,
			registry,
		);

		expect(result.model?.id).toBe(currentModel.id);
		expect(result.fallbackMessage).toContain("model no longer exists");
	});

	it("没有当前模型时应该回退到可用模型", async () => {
		const result = await restoreModelFromSession(
			"nonexistent",
			"model",
			undefined,
			false,
			registry,
		);

		expect(result.model).toBeDefined();
		expect(result.fallbackMessage).toBeDefined();
	});

	it("没有可用模型时应该返回 undefined", async () => {
		const emptyRegistry = createMockRegistry([]);
		const result = await restoreModelFromSession(
			"anthropic",
			"claude-opus-4-6",
			undefined,
			false,
			emptyRegistry,
		);

		expect(result.model).toBeUndefined();
	});
});

describe("defaultModelPerProvider - 默认模型", () => {
	it("应该包含所有已知提供商的默认模型", () => {
		const providers = [
			"amazon-bedrock",
			"anthropic",
			"openai",
			"google",
			"xai",
			"groq",
		];

		providers.forEach((provider) => {
			expect(defaultModelPerProvider[provider as keyof typeof defaultModelPerProvider]).toBeDefined();
		});
	});

	it("默认模型 ID 应该是非空字符串", () => {
		Object.values(defaultModelPerProvider).forEach((modelId) => {
			expect(modelId).toBeTruthy();
			expect(typeof modelId).toBe("string");
		});
	});
});

describe("边界情况", () => {
	it("应该处理空模型列表", () => {
		const result = findExactModelReferenceMatch("any", []);
		expect(result).toBeUndefined();
	});

	it("应该处理包含特殊字符的模型 ID", () => {
		const specialModels = [
			createMockModel("test", "model:with:colons"),
			createMockModel("test", "model/with/slashes"),
		];

		const result = findExactModelReferenceMatch("model:with:colons", specialModels);
		expect(result?.id).toBe("model:with:colons");
	});

	it("应该处理非常长的模型 ID", () => {
		const longId = "a".repeat(1000);
		const longModels = [createMockModel("test", longId)];

		const result = findExactModelReferenceMatch(longId, longModels);
		expect(result?.id).toBe(longId);
	});

	it("应该处理 unicode 模型名称", () => {
		const unicodeModels = [
			createMockModel("test", "模型-名称"),
		];

		const result = parseModelPattern("模型", unicodeModels);
		expect(result.model?.id).toBe("模型-名称");
	});
});

describe("与 Pi-Mono 一致性", () => {
	it("应该与 Pi-Mono 的默认模型一致", () => {
		// 验证关键提供商的默认模型
		expect(defaultModelPerProvider.anthropic).toBe("claude-opus-4-6");
		expect(defaultModelPerProvider.openai).toBe("gpt-5.4");
		expect(defaultModelPerProvider.google).toBe("gemini-2.5-pro");
	});

	it("应该与 Pi-Mono 的解析行为一致", () => {
		const testCases = [
			{ pattern: "claude-opus-4-6", expectedId: "claude-opus-4-6" },
			{ pattern: "claude-opus-4-6:high", expectedId: "claude-opus-4-6", thinkingLevel: "high" },
		];

		testCases.forEach(({ pattern, expectedId, thinkingLevel }) => {
			const result = parseModelPattern(pattern, mockModels);
			expect(result.model?.id).toBe(expectedId);
			if (thinkingLevel) {
				expect(result.thinkingLevel).toBe(thinkingLevel);
			}
		});
	});
});
