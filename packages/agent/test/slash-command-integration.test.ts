/**
 * slash-command-integration.test.ts - 集成测试
 *
 * 测试覆盖：
 * - 完整的命令注册、解析、执行流程
 * - 多个命令源的协同工作（内置命令、Prompt 模板、Skill 命令）
 * - 上下文传递
 * - 输出处理
 * - 错误传播
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
	SlashCommandRegistry,
	createSlashCommandContext,
	type SlashCommand,
} from "../src/slash-commands";
import type { PromptTemplate } from "../src/prompt-templates";
import type { AgentSession } from "../src/agent-session";
import type { AppStore } from "@omi/store";
import type { SessionManager } from "../src/session-manager";
import type { SettingsManager } from "@omi/settings";
import type { SkillDescriptor } from "@omi/core";

/** Helper to create a minimal valid SkillDescriptor for testing */
function createMockSkill(name: string, description = ""): SkillDescriptor {
	return {
		id: `skill-${name}`,
		name,
		description: description || `Mock skill ${name}`,
		license: null,
		compatibility: null,
		metadata: {},
		allowedTools: [],
		body: `Mock body for ${name}`,
		source: {
			scope: "workspace",
			client: "agent",
			basePath: "/mock/base",
			skillPath: "/mock/skill",
		},
		references: [],
		assets: [],
		scripts: [],
		disableModelInvocation: false,
	};
}

function createMockSession(): AgentSession {
	return {
		getSessionStats: vi.fn(() => ({
			sessionId: "integration-test-session",
			totalMessages: 15,
			userMessages: 7,
			assistantMessages: 8,
			toolCalls: 3,
			runs: 5,
		})),
		setModel: vi.fn(),
		compactSession: vi.fn(async () => ({
			summary: { goal: "Integration test compaction" },
			removedEntries: [],
		})),
		fork: vi.fn(async (id) => ({
			newSessionId: `forked-from-${id || "root"}`,
			selectedText: "Selected integration test content",
		})),
		prompt: vi.fn(async () => ({
			content: "Mocked response",
		})),
	} as unknown as AgentSession;
}

function createMockDatabase(): AppStore {
	return {
		createSession: vi.fn((title) => ({
			id: `session-${Date.now()}`,
			title,
			createdAt: new Date().toISOString(),
		})),
		listSessions: vi.fn(() => [
			{ id: "sess-1", title: "First Session", createdAt: "2024-01-01T00:00:00Z" },
			{ id: "sess-2", title: "Second Session", createdAt: "2024-01-02T00:00:00Z" },
			{ id: "sess-3", title: "Third Session", createdAt: "2024-01-03T00:00:00Z" },
		]),
		getSession: vi.fn((id) =>
			id === "sess-1"
				? { id: "sess-1", title: "First Session", createdAt: "2024-01-01T00:00:00Z" }
				: null,
		),
	} as unknown as AppStore;
}

function createMockSessionManager(): SessionManager {
	return {
		getState: vi.fn((sessionId) => ({
			activeRunId: sessionId === "integration-test-session" ? "active-run-123" : undefined,
		})),
	} as unknown as SessionManager;
}

function createMockSettingsManager(): SettingsManager {
	return {
		getGlobalSettings: vi.fn(() => ({
			retry: {
				enabled: true,
				maxRetries: 3,
				baseDelayMs: 2000,
				maxDelayMs: 60000,
			},
			model: {
				default: "claude-sonnet-4-20250514",
				provider: "anthropic",
			},
		})),
	} as unknown as SettingsManager;
}

describe("集成测试 - 完整命令流程", () => {
	let registry: SlashCommandRegistry;
	let mockSession: AgentSession;
	let mockDatabase: AppStore;
	let mockSessionManager: SessionManager;
	let mockSettings: SettingsManager;
	let stdout: ReturnType<typeof vi.fn>;
	let stderr: ReturnType<typeof vi.fn>;
	let context: ReturnType<typeof createSlashCommandContext>;

	beforeEach(() => {
		registry = new SlashCommandRegistry();
		mockSession = createMockSession();
		mockDatabase = createMockDatabase();
		mockSessionManager = createMockSessionManager();
		mockSettings = createMockSettingsManager();
		stdout = vi.fn();
		stderr = vi.fn();
		context = createSlashCommandContext(
			mockSession,
			mockDatabase,
			mockSessionManager,
			stdout,
			mockSettings,
		);
	});

	it("应该支持完整的命令生命周期：注册 -> 解析 -> 执行", async () => {
		// 1. 注册自定义命令
		const customCommand: SlashCommand = {
			name: "integration-test",
			description: "Integration test command",
			usage: "/integration-test <message>",
			execute: async (args, ctx) => {
				ctx.stdout(`Processing: ${args}`);
				return {
					success: true,
					output: `Processed: ${args}`,
				};
			},
		};

		registry.registerCommand(customCommand);

		// 2. 验证命令已注册
		expect(registry.hasCommand("integration-test")).toBe(true);

		// 3. 解析并执行命令
		const result = await registry.execute("/integration-test Hello World", context);

		// 4. 验证结果
		expect(result.success).toBe(true);
		expect(result.output).toBe("Processed: Hello World");
		expect(stdout).toHaveBeenCalledWith("Processing: Hello World");
	});

	it("应该协调所有命令源（内置、模板、技能）", async () => {
		// 注册 Prompt 模板
		const templates: PromptTemplate[] = [
			{
				name: "code-review",
				description: "Code review template",
				content: "Review this code: $1\nFocus on: $2",
				source: "user",
				filePath: "/prompts/code-review.md",
			},
		];

		registry.registerPromptTemplates(templates);

		// 注册 Skill
		const skills = [
			createMockSkill("refactor", "Refactor code for better performance"),
		];

		registry.registerSkillCommands(skills, true);

		// 验证所有命令源都在 listAllCommands 中
		const allCommands = registry.listAllCommands();
		const commandNames = allCommands.map((c) => c.name);

		// 内置命令
		expect(commandNames).toContain("model");
		expect(commandNames).toContain("help");

		// Prompt 模板
		expect(commandNames).toContain("code-review");

		// Skill 命令 - listAllCommands 返回原始技能名称（不带 skill: 前缀）
		// 但在 hasCommand 和 execute 时需要使用 skill: 前缀
		expect(commandNames).toContain("refactor");

		// 验证有 source 为 skill 的命令
		const skillCmd = allCommands.find((c) => c.name === "refactor" && c.source === "skill");
		expect(skillCmd).toBeDefined();

		// 验证 hasCommand 能找到 skill 命令（需要 skill: 前缀）
		expect(registry.hasCommand("skill:refactor")).toBe(true);

		// 执行 Skill 命令（需要 skill: 前缀）
		const skillResult = await registry.execute("/skill:refactor optimize loops", context);
		expect(skillResult.success).toBe(true);
	});

	it("应该正确传递上下文到命令处理器", async () => {
		let capturedContext: ReturnType<typeof createSlashCommandContext> | undefined;

		registry.registerCommand({
			name: "context-test",
			description: "Test context passing",
			execute: async (_args, ctx) => {
				capturedContext = ctx;
				// 验证上下文包含所有必需的依赖
				expect(ctx.session).toBeDefined();
				expect(ctx.database).toBeDefined();
				expect(ctx.sessionManager).toBeDefined();
				expect(ctx.stdout).toBeDefined();
				expect(ctx.stderr).toBeDefined();
				return { success: true };
			},
		});

		await registry.execute("/context-test", context);

		expect(capturedContext).toBeDefined();
		expect(capturedContext?.session).toBe(mockSession);
		expect(capturedContext?.database).toBe(mockDatabase);
	});

	it("应该处理多步骤命令序列", async () => {
		const sequence: string[] = [];

		registry.registerCommand({
			name: "step1",
			description: "Step 1",
			execute: async () => {
				sequence.push("step1");
				return { success: true, output: "Step 1 complete" };
			},
		});

		registry.registerCommand({
			name: "step2",
			description: "Step 2",
			execute: async () => {
				sequence.push("step2");
				return { success: true, output: "Step 2 complete" };
			},
		});

		registry.registerCommand({
			name: "step3",
			description: "Step 3",
			execute: async () => {
				sequence.push("step3");
				return { success: true, output: "Step 3 complete" };
			},
		});

		// 按顺序执行命令
		await registry.execute("/step1", context);
		await registry.execute("/step2", context);
		await registry.execute("/step3", context);

		expect(sequence).toEqual(["step1", "step2", "step3"]);
	});

	it("应该在一个命令失败后继续执行其他命令", async () => {
		registry.registerCommand({
			name: "fail",
			description: "Failing command",
			execute: async () => ({
				success: false,
				error: "Intentional failure",
			}),
		});

		registry.registerCommand({
			name: "succeed",
			description: "Successful command",
			execute: async () => ({
				success: true,
				output: "Success",
			}),
		});

		const failResult = await registry.execute("/fail", context);
		const succeedResult = await registry.execute("/succeed", context);

		expect(failResult.success).toBe(false);
		expect(succeedResult.success).toBe(true);
	});
});

describe("集成测试 - 复杂场景", () => {
	let registry: SlashCommandRegistry;
	let context: ReturnType<typeof createSlashCommandContext>;

	beforeEach(() => {
		registry = new SlashCommandRegistry();
		context = createSlashCommandContext(
			createMockSession(),
			createMockDatabase(),
			createMockSessionManager(),
			vi.fn(),
			createMockSettingsManager(),
		);
	});

	it("应该处理命令优先级（内置 > 模板）", async () => {
		// 注册一个与内置命令同名的模板
		registry.registerPromptTemplates([
			{
				name: "model",
				description: "Custom model template",
				content: "Custom model content: $1",
				source: "user",
				filePath: "/path",
			},
		]);

		// 执行 /model 应该使用内置命令，而不是模板
		const result = await registry.execute("/model test-model", context);

		expect(result.success).toBe(true);
		// 内置命令的输出格式
		expect(result.output).toContain("test-model");
	});

	it("应该支持命令覆盖和恢复", async () => {
		const originalOutput = "Original implementation";

		// 注册原始命令
		registry.registerCommand({
			name: "override-test",
			description: "Original",
			execute: async () => ({
				success: true,
				output: originalOutput,
			}),
		});

		const result1 = await registry.execute("/override-test", context);
		expect(result1.output).toBe(originalOutput);

		// 覆盖命令
		registry.registerCommand({
			name: "override-test",
			description: "Overridden",
			execute: async () => ({
				success: true,
				output: "Overridden implementation",
			}),
		});

		const result2 = await registry.execute("/override-test", context);
		expect(result2.output).toBe("Overridden implementation");
	});

	it("应该处理命令依赖（一个命令调用另一个）", async () => {
		let dependencyCalled = false;

		// "依赖"命令
		registry.registerCommand({
			name: "dependency",
			description: "Dependency",
			execute: async () => {
				dependencyCalled = true;
				return { success: true, output: "Dependency executed" };
			},
		});

		// "依赖者"命令
		registry.registerCommand({
			name: "dependent",
			description: "Depends on dependency",
			execute: async (_args, ctx) => {
				// 通过 registry 执行另一个命令
				const depResult = await registry.executeCommand("dependency", "", ctx);
				return {
					success: depResult.success,
					output: `Dependent executed. Dependency result: ${depResult.output}`,
				};
			},
		});

		const result = await registry.execute("/dependent", context);

		expect(dependencyCalled).toBe(true);
		expect(result.success).toBe(true);
		expect(result.output).toContain("Dependency executed");
	});
});

describe("集成测试 - 错误处理和恢复", () => {
	let registry: SlashCommandRegistry;
	let context: ReturnType<typeof createSlashCommandContext>;

	beforeEach(() => {
		registry = new SlashCommandRegistry();
		context = createSlashCommandContext(
			createMockSession(),
			createMockDatabase(),
			createMockSessionManager(),
			vi.fn(),
			createMockSettingsManager(),
		);
	});

	it("应该处理上下文缺失的情况", async () => {
		registry.registerCommand({
			name: "requires-settings",
			description: "Requires settings manager",
			execute: async (_args, ctx) => {
				if (!ctx.settingsManager) {
					return {
						success: false,
						error: "Settings manager is required",
					};
				}
				return { success: true };
			},
		});

		const noSettingsContext = createSlashCommandContext(
			createMockSession(),
			createMockDatabase(),
			createMockSessionManager(),
			vi.fn(),
			undefined,
		);

		const result = await registry.execute("/requires-settings", noSettingsContext);

		expect(result.success).toBe(false);
		expect(result.error).toContain("Settings manager is required");
	});

	it("应该处理命令执行中返回的错误结果", async () => {
		registry.registerCommand({
			name: "returns-error",
			description: "Returns error result",
			execute: async () => {
				return {
					success: false,
					error: "Command execution failed",
				};
			},
		});

		const result = await registry.execute("/returns-error", context);

		expect(result.success).toBe(false);
		expect(result.error).toContain("Command execution failed");
	});

	// 注意：当前实现不会捕获命令 execute 方法中抛出的异常
	// 这些异常会直接传播给调用者
	// 这是一个潜在的改进点，但符合当前代码行为
	it("命令中抛出的异常会传播给调用者", async () => {
		registry.registerCommand({
			name: "throws-error",
			description: "Throws an error",
			execute: async () => {
				throw new Error("Unexpected error in command");
			},
		});

		// 当前实现会抛出异常而不是返回错误结果
		await expect(registry.execute("/throws-error", context)).rejects.toThrow(
			"Unexpected error in command",
		);
	});
});

describe("集成测试 - 性能和边界", () => {
	let registry: SlashCommandRegistry;
	let context: ReturnType<typeof createSlashCommandContext>;

	beforeEach(() => {
		registry = new SlashCommandRegistry();
		context = createSlashCommandContext(
			createMockSession(),
			createMockDatabase(),
			createMockSessionManager(),
			vi.fn(),
			createMockSettingsManager(),
		);
	});

	it("应该高效处理大量命令注册", async () => {
		const startTime = Date.now();

		for (let i = 0; i < 1000; i++) {
			registry.registerCommand({
				name: `bulk-cmd-${i}`,
				description: `Bulk command ${i}`,
				execute: async () => ({ success: true, output: `Result ${i}` }),
			});
		}

		const registrationTime = Date.now() - startTime;

		// 验证所有命令都已注册
		expect(registry.hasCommand("bulk-cmd-0")).toBe(true);
		expect(registry.hasCommand("bulk-cmd-999")).toBe(true);

		// 验证列表性能
		const listStart = Date.now();
		const commands = registry.listCommands();
		const listTime = Date.now() - listStart;

		expect(commands.length).toBeGreaterThanOrEqual(1000);
		expect(registrationTime).toBeLessThan(1000); // 应该在 1 秒内完成
		expect(listTime).toBeLessThan(100); // 列表应该在 100ms 内返回
	});

	it("应该高效处理命令查找", async () => {
		// 注册 100 个命令
		for (let i = 0; i < 100; i++) {
			registry.registerCommand({
				name: `search-cmd-${i}`,
				description: `Search command ${i}`,
				execute: async () => ({ success: true }),
			});
		}

		const startTime = Date.now();

		// 执行 100 次查找
		for (let i = 0; i < 100; i++) {
			const exists = registry.hasCommand(`search-cmd-${i}`);
			expect(exists).toBe(true);
		}

		const searchTime = Date.now() - startTime;

		expect(searchTime).toBeLessThan(100); // 100 次查找应该在 100ms 内完成
	});

	it("应该处理深层嵌套的命令调用", async () => {
		let depth = 0;
		const maxDepth = 10;

		registry.registerCommand({
			name: "recursive",
			description: "Recursive command",
			execute: async (_args, ctx) => {
				depth++;
				if (depth < maxDepth) {
					await registry.executeCommand("recursive", "", ctx);
				}
				return { success: true, output: `Depth: ${depth}` };
			},
		});

		const result = await registry.execute("/recursive", context);

		expect(result.success).toBe(true);
		expect(depth).toBe(maxDepth);
	});
});
