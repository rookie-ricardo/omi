/**
 * slash-commands registry 测试 - Slash 命令注册和分发系统
 *
 * 测试覆盖：
 * - SlashCommandRegistry 基本功能
 * - 命令注册和注销
 * - 命令解析和执行
 * - Prompt 模板集成
 * - Skill 命令集成
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
	SlashCommandRegistry,
	createSlashCommandRegistry,
	createSlashCommandContext,
	type SlashCommand,
	type SlashCommandResult,
} from "../src/slash-commands";

describe("SlashCommandRegistry", () => {
	let registry: SlashCommandRegistry;

	beforeEach(() => {
		registry = createSlashCommandRegistry();
	});

	describe("基本功能", () => {
		it("应该创建一个注册表", () => {
			expect(registry).toBeDefined();
			expect(registry instanceof SlashCommandRegistry).toBe(true);
		});

		it("应该包含所有内置命令", () => {
			const commands = registry.listCommands();
			expect(commands.length).toBeGreaterThan(0);
		});

		it("应该能注册自定义命令", () => {
			const customCommand: SlashCommand = {
				name: "test",
				description: "Test command",
				execute: async () => ({ success: true, output: "test" }),
			};

			registry.registerCommand(customCommand);
			expect(registry.hasCommand("test")).toBe(true);
		});

		it("应该能注销命令", () => {
			registry.registerCommand({
				name: "temp",
				description: "Temporary command",
				execute: async () => ({ success: true }),
			});

			expect(registry.hasCommand("temp")).toBe(true);
			registry.unregisterCommand("temp");
			expect(registry.hasCommand("temp")).toBe(false);
		});

		it("命令名查找应该不区分大小写", () => {
			registry.registerCommand({
				name: "MyCommand",
				description: "Test",
				execute: async () => ({ success: true }),
			});

			expect(registry.hasCommand("mycommand")).toBe(true);
			expect(registry.hasCommand("MYCOMMAND")).toBe(true);
			expect(registry.hasCommand("MyCommand")).toBe(true);
		});
	});

	describe("命令列表", () => {
		it("应该按名称排序返回命令", () => {
			const commands = registry.listCommands();
			for (let i = 1; i < commands.length; i++) {
				expect(commands[i - 1].name.localeCompare(commands[i].name)).toBeLessThanOrEqual(0);
			}
		});

		it("listAllCommands 应该包含所有来源的命令", () => {
			const allCommands = registry.listAllCommands();
			const sources = new Set(allCommands.map((c) => c.source));

			// 内置命令都是 extension 类型
			expect(sources.has("extension")).toBe(true);
		});
	});

	describe("命令解析", () => {
		it("应该能解析简单命令", () => {
			const { name, args } = registry.parseCommand("/help");
			expect(name).toBe("help");
			expect(args).toBe("");
		});

		it("应该能解析带参数的命令", () => {
			const { name, args } = registry.parseCommand("/model gpt-4");
			expect(name).toBe("model");
			expect(args).toBe("gpt-4");
		});

		it("应该能解析带多个参数的命令", () => {
			const { name, args } = registry.parseCommand("/fork entry123 some text");
			expect(name).toBe("fork");
			expect(args).toBe("entry123 some text");
		});

		it("应该处理不以 / 开头的输入", () => {
			const { name, args } = registry.parseCommand("regular text");
			expect(name).toBe("");
			expect(args).toBe("");
		});

		it("应该正确处理带引号的参数", () => {
			const { name, args } = registry.parseCommand('/model "some model"');
			expect(name).toBe("model");
			expect(args).toBe('"some model"');
		});
	});

	describe("Prompt 模板集成", () => {
		it("应该能注册 prompt 模板", () => {
			const templates = [
				{
					name: "code-review",
					description: "Review code",
					content: "Please review this code",
					source: "user" as const,
					filePath: "/path/to/template.md",
				},
			];

			registry.registerPromptTemplates(templates);
			expect(registry.hasCommand("code-review")).toBe(true);
		});

		it("listAllCommands 应该包含 prompt 模板", () => {
			const templates = [
				{
					name: "test-template",
					description: "Test template",
					content: "Test content",
					source: "user" as const,
					filePath: "/path/to/template.md",
				},
			];

			registry.registerPromptTemplates(templates);
			const allCommands = registry.listAllCommands();
			const templateCmd = allCommands.find((c) => c.name === "test-template");

			expect(templateCmd).toBeDefined();
			expect(templateCmd?.source).toBe("prompt");
		});
	});

	describe("Skill 命令集成", () => {
		it("应该能注册 skill 命令", () => {
			const skills = [
				{
					id: "skill1",
					name: "test-skill",
					description: "Test skill",
					allowedTools: [],
				} as any,
			];

			registry.registerSkillCommands(skills, true);
			expect(registry.hasCommand("skill:test-skill")).toBe(true);
		});

		it("当 enableSkillCommands 为 false 时不应注册 skill 命令", () => {
			const skills = [
				{
					id: "skill1",
					name: "test-skill",
					description: "Test skill",
					allowedTools: [],
				} as any,
			];

			registry.registerSkillCommands(skills, false);
			expect(registry.hasCommand("skill:test-skill")).toBe(false);
		});
	});

	describe("命令执行", () => {
		it("应该能执行内置命令", async () => {
			const mockContext = {
				session: {
					getSessionStats: vi.fn(() => ({
						sessionId: "test-session",
						userMessages: 0,
						assistantMessages: 0,
						toolCalls: 0,
						totalMessages: 0,
						runs: 0,
					})),
				},
				database: {},
				sessionManager: {
					getState: vi.fn(() => null),
				},
				stdout: vi.fn(),
				stderr: vi.fn(),
			} as any;

			const result = await registry.executeCommand("help", "", mockContext);
			expect(result.success).toBe(true);
			expect(result.output).toBeDefined();
		});

		it("应该能通过 execute 执行完整命令字符串", async () => {
			const mockContext = {
				session: {
					getSessionStats: vi.fn(() => ({
						sessionId: "test-session",
						userMessages: 0,
						assistantMessages: 0,
						toolCalls: 0,
						totalMessages: 0,
						runs: 0,
					})),
				},
				database: {},
				sessionManager: {
					getState: vi.fn(() => null),
				},
				stdout: vi.fn(),
				stderr: vi.fn(),
			} as any;

			const result = await registry.execute("/help", mockContext);
			expect(result.success).toBe(true);
		});

		it("应该对未知命令返回错误", async () => {
			const mockContext = {
				session: {},
				database: {},
				sessionManager: {},
				stdout: vi.fn(),
				stderr: vi.fn(),
			} as any;

			const result = await registry.executeCommand("unknown", "args", mockContext);
			expect(result.success).toBe(false);
			expect(result.error).toContain("Unknown command");
		});

		it("应该对无效格式返回错误", async () => {
			const mockContext = {
				session: {},
				database: {},
				sessionManager: {},
				stdout: vi.fn(),
				stderr: vi.fn(),
			} as any;

			const result = await registry.execute("not a command", mockContext);
			expect(result.success).toBe(false);
		});
	});
});

describe("createSlashCommandContext", () => {
	it("应该创建正确的上下文对象", () => {
		const mockSession = {} as any;
		const mockDatabase = {} as any;
		const mockSessionManager = {} as any;
		const mockStdout = vi.fn();

		const context = createSlashCommandContext(
			mockSession,
			mockDatabase,
			mockSessionManager,
			mockStdout,
		);

		expect(context.session).toBe(mockSession);
		expect(context.database).toBe(mockDatabase);
		expect(context.sessionManager).toBe(mockSessionManager);
		expect(context.stdout).toBe(mockStdout);
		expect(context.stderr).toBeDefined();
	});

	it("应该使用默认 stdout 如果未提供", () => {
		const context = createSlashCommandContext(
			{} as any,
			{} as any,
			{} as any,
		);

		expect(context.stdout).toBeDefined();
		expect(context.stderr).toBeDefined();
	});
});
