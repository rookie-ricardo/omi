/**
 * slash-command-execution.test.ts - 命令执行和分发流程测试
 *
 * 测试覆盖：
 * - execute - 从完整输入字符串执行命令
 * - executeCommand - 执行命令
 * - Prompt Template 展开集成
 * - Skill 命令展开集成
 * - 命令分发流程
 * - 未知命令处理
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
	SlashCommandRegistry,
	createSlashCommandContext,
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
			sessionId: "test-session",
			totalMessages: 0,
			userMessages: 0,
			assistantMessages: 0,
			toolCalls: 0,
			runs: 0,
		})),
		setModel: vi.fn(),
		compactSession: vi.fn(async () => ({
			summary: { goal: "test" },
			removedEntries: [],
		})),
		fork: vi.fn(async () => ({
			newSessionId: "forked",
			selectedText: "text",
		})),
		prompt: vi.fn(async () => ({})),
	} as unknown as AgentSession;
}

function createMockDatabase(): AppStore {
	return {
		createSession: vi.fn(() => ({ id: "new", title: "New", createdAt: "" })),
		listSessions: vi.fn(() => []),
		getSession: vi.fn(() => null),
	} as unknown as AppStore;
}

function createMockSessionManager(): SessionManager {
	return {
		getState: vi.fn(() => ({})),
	} as unknown as SessionManager;
}

function createMockSettingsManager(): SettingsManager {
	return {
		getGlobalSettings: vi.fn(() => ({})),
	} as unknown as SettingsManager;
}

function createMockContext(): ReturnType<typeof createSlashCommandContext> {
	return createSlashCommandContext(
		createMockSession(),
		createMockDatabase(),
		createMockSessionManager(),
		vi.fn(),
		createMockSettingsManager(),
	);
}

describe("execute - 从完整输入字符串执行命令", () => {
	let registry: SlashCommandRegistry;
	let context: ReturnType<typeof createSlashCommandContext>;

	beforeEach(() => {
		registry = new SlashCommandRegistry();
		context = createMockContext();
	});

	it("应该执行简单的命令", async () => {
		const result = await registry.execute("/help", context);

		expect(result.success).toBe(true);
		expect(result.output).toContain("Available commands");
	});

	it("应该执行带参数的命令", async () => {
		const result = await registry.execute("/model test-model", context);

		expect(result.success).toBe(true);
	});

	it("对于不以斜杠开头的输入应该返回错误", async () => {
		const result = await registry.execute("help", context);

		expect(result.success).toBe(false);
		expect(result.error).toContain("Invalid command format");
	});

	it("对于空字符串应该返回错误", async () => {
		const result = await registry.execute("", context);

		expect(result.success).toBe(false);
		expect(result.error).toContain("Invalid command format");
	});

	it("应该处理只有斜杠的输入", async () => {
		const result = await registry.execute("/", context);

		expect(result.success).toBe(false);
	});

	it("应该保留参数中的空格", async () => {
		const mockDb = createMockDatabase();
		const contextWithStdout = createSlashCommandContext(
			createMockSession(),
			mockDb,
			createMockSessionManager(),
			vi.fn(),
			createMockSettingsManager(),
		);

		await registry.execute("/new My Session Title", contextWithStdout);
		// 验证参数正确传递
		expect(mockDb.createSession).toHaveBeenCalledWith("My Session Title");
	});
});

describe("executeCommand - 执行命令", () => {
	let registry: SlashCommandRegistry;
	let context: ReturnType<typeof createSlashCommandContext>;

	beforeEach(() => {
		registry = new SlashCommandRegistry();
		context = createMockContext();
	});

	it("应该执行已注册的命令", async () => {
		const result = await registry.executeCommand("help", "", context);

		expect(result.success).toBe(true);
	});

	it("应该传递参数给命令", async () => {
		const mockSession = createMockSession();
		const contextWithSession = createSlashCommandContext(
			mockSession,
			createMockDatabase(),
			createMockSessionManager(),
			vi.fn(),
			createMockSettingsManager(),
		);

		await registry.executeCommand("model", "test-model", contextWithSession);

		expect(mockSession.setModel).toHaveBeenCalledWith("test-model");
	});

	it("命令名应该不区分大小写", async () => {
		const result1 = await registry.executeCommand("HELP", "", context);
		const result2 = await registry.executeCommand("Help", "", context);
		const result3 = await registry.executeCommand("help", "", context);

		expect(result1.success).toBe(true);
		expect(result2.success).toBe(true);
		expect(result3.success).toBe(true);
	});

	it("对于不存在的命令应该返回错误", async () => {
		const result = await registry.executeCommand("nonexistent", "", context);

		expect(result.success).toBe(false);
		expect(result.error).toContain("Unknown command");
		expect(result.error).toContain("/nonexistent");
	});
});

describe("Prompt Template 展开集成", () => {
	let registry: SlashCommandRegistry;
	let context: ReturnType<typeof createSlashCommandContext>;

	beforeEach(() => {
		registry = new SlashCommandRegistry();
		context = createMockContext();
	});

	it("应该注册 Prompt 模板到 hasCommand", () => {
		const templates: PromptTemplate[] = [
			{
				name: "greet",
				description: "Greeting template",
				content: "Hello, $1!",
				source: "user",
				filePath: "/path/to/greet.md",
			},
		];

		registry.registerPromptTemplates(templates);
		expect(registry.hasCommand("greet")).toBe(true);
	});

	it("应该在 listAllCommands 中包含模板", () => {
		const templates: PromptTemplate[] = [
			{
				name: "code-review",
				description: "Code review template",
				content: "Review: $1",
				source: "user",
				filePath: "/path/to/code-review.md",
			},
		];

		registry.registerPromptTemplates(templates);
		const allCommands = registry.listAllCommands();
		const templateCmd = allCommands.find((c) => c.name === "code-review");

		expect(templateCmd).toBeDefined();
		expect(templateCmd?.source).toBe("prompt");
	});

	it("应该在 listAllCommands 中正确显示多个模板", () => {
		const templates: PromptTemplate[] = [
			{
				name: "template1",
				description: "First template",
				content: "Content 1: $1",
				source: "user",
				filePath: "/path1",
			},
			{
				name: "template2",
				description: "Second template",
				content: "Content 2: $2",
				source: "project",
				filePath: "/path2",
			},
		];

		registry.registerPromptTemplates(templates);
		const allCommands = registry.listAllCommands();

		expect(allCommands.some((c) => c.name === "template1" && c.source === "prompt")).toBe(true);
		expect(allCommands.some((c) => c.name === "template2" && c.source === "prompt")).toBe(true);
	});
});

describe("Skill 命令展开集成", () => {
	let registry: SlashCommandRegistry;
	let context: ReturnType<typeof createSlashCommandContext>;
	let mockSession: AgentSession;

	beforeEach(() => {
		registry = new SlashCommandRegistry();
		mockSession = createMockSession();
		context = createSlashCommandContext(
			mockSession,
			createMockDatabase(),
			createMockSessionManager(),
			vi.fn(),
			createMockSettingsManager(),
		);
	});

	it("应该执行 skill:name 格式的命令", async () => {
		const skills = [
			createMockSkill("refactor", "Refactor code"),
			createMockSkill("debug", "Debug code"),
		];

		registry.registerSkillCommands(skills, true);
		const result = await registry.execute("/skill:refactor optimize this function", context);

		expect(result.success).toBe(true);
		expect(result.output).toContain("refactor");
		expect(mockSession.prompt).toHaveBeenCalledWith(
			expect.stringContaining("Refactor code"),
		);
	});

	it("应该传递参数给 skill", async () => {
		const skills = [createMockSkill("test", "Test this code")];

		registry.registerSkillCommands(skills, true);
		await registry.execute("/skill:test specific code here", context);

		expect(mockSession.prompt).toHaveBeenCalledWith(
			expect.stringContaining("specific code here"),
		);
	});

	it("skill:name 格式应该不区分大小写", async () => {
		const skills = [createMockSkill("MySkill", "A skill")];

		registry.registerSkillCommands(skills, true);
		const result = await registry.execute("/SKILL:MYSKILL args", context);

		expect(result.success).toBe(true);
	});

	it("应该处理 skill 命令执行错误", async () => {
		const errorSession = {
			...mockSession,
			prompt: vi.fn(() => {
				throw new Error("Skill execution failed");
			}),
		} as unknown as AgentSession;

		const errorContext = createSlashCommandContext(
			errorSession,
			createMockDatabase(),
			createMockSessionManager(),
			vi.fn(),
			createMockSettingsManager(),
		);

		const skills = [createMockSkill("fail", "Failing skill")];
		registry.registerSkillCommands(skills, true);

		const result = await registry.execute("/skill:fail test", errorContext);

		expect(result.success).toBe(false);
		expect(result.error).toContain("Skill execution failed");
	});

	it("应该处理没有描述的技能", async () => {
		const skills = [createMockSkill("nodesc")];

		registry.registerSkillCommands(skills, true);
		const result = await registry.execute("/skill:nodesc argument", context);

		expect(result.success).toBe(true);
		expect(mockSession.prompt).toHaveBeenCalledWith(expect.stringContaining("nodesc"));
	});

	it("当禁用时不应执行 skill 命令", async () => {
		const skills = [createMockSkill("disabled", "Disabled skill")];

		registry.registerSkillCommands(skills, false);
		const result = await registry.execute("/skill:disabled test", context);

		expect(result.success).toBe(false);
		expect(result.error).toContain("Unknown command");
	});
});

describe("命令分发流程", () => {
	let registry: SlashCommandRegistry;
	let context: ReturnType<typeof createSlashCommandContext>;

	beforeEach(() => {
		registry = new SlashCommandRegistry();
		context = createMockContext();
	});

	it("应该优先执行注册的命令而非模板", async () => {
		// 注册一个与模板同名的命令
		registry.registerCommand({
			name: "test",
			description: "Command",
			execute: async () => ({ success: true, output: "from command" }),
		});

		// 也注册一个同名模板
		registry.registerPromptTemplates([
			{
				name: "test",
				description: "Template",
				content: "from template",
				source: "user",
				filePath: "/path",
			},
		]);

		const result = await registry.execute("/test", context);

		// 应该执行命令而不是模板
		expect(result.success).toBe(true);
		expect(result.output).toBe("from command");
	});

	it("应该返回正确的 continueInteraction 标志", async () => {
		registry.registerCommand({
			name: "continue-test",
			description: "Test",
			execute: async () => ({
				success: true,
				output: "result",
				continueInteraction: true,
			}),
		});

		const result = await registry.execute("/continue-test", context);

		expect(result.continueInteraction).toBe(true);
	});

	it("应该支持异步命令执行", async () => {
		registry.registerCommand({
			name: "async-test",
			description: "Async test",
			execute: async () => {
				await new Promise((resolve) => setTimeout(resolve, 10));
				return { success: true, output: "async result" };
			},
		});

		const result = await registry.execute("/async-test", context);

		expect(result.success).toBe(true);
		expect(result.output).toBe("async result");
	});
});

describe("未知命令处理", () => {
	let registry: SlashCommandRegistry;
	let context: ReturnType<typeof createSlashCommandContext>;

	beforeEach(() => {
		registry = new SlashCommandRegistry();
		context = createMockContext();
	});

	it("应该返回友好的错误消息", async () => {
		const result = await registry.execute("/unknown-command", context);

		expect(result.success).toBe(false);
		expect(result.error).toContain("Unknown command");
		expect(result.error).toContain("/unknown-command");
		expect(result.error).toContain("/help");
	});

	it("应该处理未知 skill:name 格式的命令", async () => {
		// 注册一些技能但不是请求的那个
		registry.registerSkillCommands([createMockSkill("other")], true);

		const result = await registry.execute("/skill:nonexistent test", context);

		expect(result.success).toBe(false);
	});

	it("应该处理已注册技能但带 : 前缀的情况", async () => {
		const skills = [createMockSkill("testskill", "Test")];

		registry.registerSkillCommands(skills, true);

		// 应该能找到 /skill:testskill
		const result1 = await registry.execute("/skill:testskill arg", context);
		expect(result1.success).toBe(true);

		// 也应该能找到 /testskill（如果支持的话）
		// 当前实现只支持 skill:name 格式
	});
});

describe("边界情况", () => {
	let registry: SlashCommandRegistry;
	let context: ReturnType<typeof createSlashCommandContext>;

	beforeEach(() => {
		registry = new SlashCommandRegistry();
		context = createMockContext();
	});

	it("应该处理空参数", async () => {
		const result = await registry.execute("/model", context);

		expect(result.success).toBe(true);
	});

	it("应该处理只有空格的参数", async () => {
		const result = await registry.execute("/model    ", context);

		expect(result.success).toBe(true);
	});

	it("应该处理命令名中的特殊字符", async () => {
		registry.registerCommand({
			name: "test:command-with-dash",
			description: "Test",
			execute: async () => ({ success: true, output: "ok" }),
		});

		const result = await registry.execute("/test:command-with-dash", context);

		expect(result.success).toBe(true);
	});

	it("应该处理非常长的参数", async () => {
		const longArg = "a".repeat(10000);
		registry.registerCommand({
			name: "long-arg-test",
			description: "Test",
			execute: async (_args, ctx) => {
				ctx.stdout(`Received: ${_args.slice(0, 50)}...`);
				return { success: true };
			},
		});

		const result = await registry.execute(`/long-arg-test ${longArg}`, context);

		expect(result.success).toBe(true);
	});
});
