/**
 * slash-command-registry.test.ts - SlashCommandRegistry 类测试
 *
 * 测试覆盖：
 * - SlashCommandRegistry 创建和初始化
 * - registerCommand - 注册命令
 * - unregisterCommand - 注销命令
 * - hasCommand - 检查命令是否存在
 * - getCommand - 获取命令
 * - listCommands - 列出所有注册的命令
 * - listAllCommands - 列出所有可用命令（包括模板和技能）
 * - registerPromptTemplates - 注册 Prompt 模板
 * - registerSkillCommands - 注册 Skill 命令
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
	SlashCommandRegistry,
	type SlashCommand,
	type SlashCommandContext,
} from "../src/slash-commands";
import type { PromptTemplate } from "../src/prompt-templates";
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

describe("SlashCommandRegistry - 创建和初始化", () => {
	it("应该创建一个空的注册表", () => {
		const registry = new SlashCommandRegistry();

		expect(registry).toBeDefined();
		expect(registry.listCommands()).toBeInstanceOf(Array);
	});

	it("构造函数应该自动注册内置命令", () => {
		const registry = new SlashCommandRegistry();
		const commands = registry.listCommands();

		// 应该有内置命令
		expect(commands.length).toBeGreaterThan(0);

		// 检查一些核心内置命令存在
		const commandNames = commands.map((c) => c.name);
		expect(commandNames).toContain("model");
		expect(commandNames).toContain("compact");
		expect(commandNames).toContain("help");
		expect(commandNames).toContain("quit");
	});

	it("内置命令应该按名称排序", () => {
		const registry = new SlashCommandRegistry();
		const commands = registry.listCommands();

		for (let i = 1; i < commands.length; i++) {
			expect(commands[i - 1].name.localeCompare(commands[i].name)).toBeLessThanOrEqual(0);
		}
	});
});

describe("registerCommand - 注册命令", () => {
	let registry: SlashCommandRegistry;

	beforeEach(() => {
		registry = new SlashCommandRegistry();
	});

	it("应该成功注册一个新命令", () => {
		const command: SlashCommand = {
			name: "test-command",
			description: "Test command",
			execute: async () => ({ success: true, output: "test" }),
		};

		registry.registerCommand(command);

		expect(registry.hasCommand("test-command")).toBe(true);
		expect(registry.getCommand("test-command")?.name).toBe("test-command");
	});

	it("命令名应该转换为小写", () => {
		const command: SlashCommand = {
			name: "TestCommand",
			description: "Test",
			execute: async () => ({ success: true }),
		};

		registry.registerCommand(command);

		expect(registry.hasCommand("testcommand")).toBe(true);
		expect(registry.hasCommand("TestCommand")).toBe(true);
		expect(registry.hasCommand("TESTCOMMAND")).toBe(true);
	});

	it("应该允许覆盖现有命令", async () => {
		const command1: SlashCommand = {
			name: "override-test",
			description: "Original",
			execute: async () => ({ success: true, output: "original" }),
		};

		const command2: SlashCommand = {
			name: "override-test",
			description: "Overridden",
			execute: async () => ({ success: true, output: "overridden" }),
		};

		registry.registerCommand(command1);
		registry.registerCommand(command2);

		const cmd = registry.getCommand("override-test");
		expect(cmd).toBeDefined();
		expect(cmd?.description).toBe("Overridden");

		const result = await cmd?.execute("", {} as SlashCommandContext);
		expect(result?.output).toBe("overridden");
	});

	it("应该注册带有 usage 的命令", () => {
		const command: SlashCommand = {
			name: "usage-test",
			description: "Test usage",
			usage: "/usage-test <arg1> <arg2>",
			execute: async () => ({ success: true }),
		};

		registry.registerCommand(command);

		const registered = registry.getCommand("usage-test");
		expect(registered?.usage).toBe("/usage-test <arg1> <arg2>");
	});
});

describe("unregisterCommand - 注销命令", () => {
	let registry: SlashCommandRegistry;

	beforeEach(() => {
		registry = new SlashCommandRegistry();
	});

	it("应该成功注销已注册的命令", () => {
		const command: SlashCommand = {
			name: "to-remove",
			description: "Will be removed",
			execute: async () => ({ success: true }),
		};

		registry.registerCommand(command);
		expect(registry.hasCommand("to-remove")).toBe(true);

		registry.unregisterCommand("to-remove");
		expect(registry.hasCommand("to-remove")).toBe(false);
	});

	it("命令名应该不区分大小写", () => {
		const command: SlashCommand = {
			name: "CaseSensitive",
			description: "Test",
			execute: async () => ({ success: true }),
		};

		registry.registerCommand(command);
		registry.unregisterCommand("CASESENSITIVE");

		expect(registry.hasCommand("casesensitive")).toBe(false);
	});

	it("注销不存在的命令应该是安全的", () => {
		expect(() => registry.unregisterCommand("nonexistent")).not.toThrow();
	});

	it("不能注销内置命令（可以通过覆盖实现）", () => {
		// 内置命令已注册
		expect(registry.hasCommand("model")).toBe(true);

		// 注销后应该不存在
		registry.unregisterCommand("model");
		expect(registry.hasCommand("model")).toBe(false);
	});
});

describe("hasCommand - 检查命令是否存在", () => {
	let registry: SlashCommandRegistry;

	beforeEach(() => {
		registry = new SlashCommandRegistry();
	});

	it("应该返回 true 对于已注册的命令", () => {
		const command: SlashCommand = {
			name: "exists",
			description: "Test",
			execute: async () => ({ success: true }),
		};

		registry.registerCommand(command);
		expect(registry.hasCommand("exists")).toBe(true);
	});

	it("应该返回 false 对于不存在的命令", () => {
		expect(registry.hasCommand("does-not-exist")).toBe(false);
	});

	it("检查应该不区分大小写", () => {
		const command: SlashCommand = {
			name: "MixedCase",
			description: "Test",
			execute: async () => ({ success: true }),
		};

		registry.registerCommand(command);

		expect(registry.hasCommand("mixedcase")).toBe(true);
		expect(registry.hasCommand("MIXEDCASE")).toBe(true);
		expect(registry.hasCommand("MixedCase")).toBe(true);
	});

	it("应该检查 Prompt 模板", () => {
		const templates: PromptTemplate[] = [
			{
				name: "test-template",
				description: "Test template",
				content: "Test content",
				source: "user",
				filePath: "/path/to/test.md",
			},
		];

		registry.registerPromptTemplates(templates);
		expect(registry.hasCommand("test-template")).toBe(true);
	});
	it("应该检查 Skill 命令", () => {
		const skills = [
			createMockSkill("test-skill", "Test skill"),
		];

		registry.registerSkillCommands(skills, true);
		expect(registry.hasCommand("skill:test-skill")).toBe(true);
	});
});

describe("getCommand - 获取命令", () => {
	let registry: SlashCommandRegistry;

	beforeEach(() => {
		registry = new SlashCommandRegistry();
	});

	it("应该返回已注册的命令", () => {
		const command: SlashCommand = {
			name: "get-test",
			description: "Test",
			execute: async () => ({ success: true }),
		};

		registry.registerCommand(command);
		const retrieved = registry.getCommand("get-test");

		expect(retrieved).toBeDefined();
		expect(retrieved?.name).toBe("get-test");
	});

	it("对于不存在的命令应该返回 undefined", () => {
		expect(registry.getCommand("nonexistent")).toBeUndefined();
	});

	it("获取应该不区分大小写", () => {
		const command: SlashCommand = {
			name: "GetTest",
			description: "Test",
			execute: async () => ({ success: true }),
		};

		registry.registerCommand(command);
		expect(registry.getCommand("gettest")?.name).toBe("GetTest");
	});

	it("应该返回 Prompt 模板（如果有）", () => {
		const templates: PromptTemplate[] = [
			{
				name: "template-cmd",
				description: "Template",
				content: "Content",
				source: "user",
				filePath: "/path",
			},
		];

		registry.registerPromptTemplates(templates);
		// Prompt 模板不会通过 getCommand 返回，它们在 executeCommand 中特殊处理
		expect(registry.getCommand("template-cmd")).toBeUndefined();
	});
});

describe("listCommands - 列出所有注册的命令", () => {
	let registry: SlashCommandRegistry;

	beforeEach(() => {
		registry = new SlashCommandRegistry();
	});

	it("应该返回所有已注册的命令", () => {
		const cmd1: SlashCommand = {
			name: "alpha",
			description: "First",
			execute: async () => ({ success: true }),
		};
		const cmd2: SlashCommand = {
			name: "beta",
			description: "Second",
			execute: async () => ({ success: true }),
		};

		registry.registerCommand(cmd1);
		registry.registerCommand(cmd2);

		const commands = registry.listCommands();
		const names = commands.map((c) => c.name);

		expect(names).toContain("alpha");
		expect(names).toContain("beta");
	});

	it("应该包含内置命令", () => {
		const commands = registry.listCommands();
		const names = commands.map((c) => c.name);

		expect(names).toContain("model");
		expect(names).toContain("help");
	});

	it("返回的列表应该按名称排序", () => {
		registry.registerCommand({
			name: "zebra",
			description: "Z",
			execute: async () => ({ success: true }),
		});
		registry.registerCommand({
			name: "apple",
			description: "A",
			execute: async () => ({ success: true }),
		});

		const commands = registry.listCommands();

		// 查找 apple 和 zebra 的位置
		const appleIndex = commands.findIndex((c) => c.name === "apple");
		const zebraIndex = commands.findIndex((c) => c.name === "zebra");

		expect(appleIndex).toBeLessThan(zebraIndex);
	});

	it("不应该包含 Prompt 模板和 Skill 命令", () => {
		registry.registerPromptTemplates([
			{
				name: "template",
				description: "T",
				content: "C",
				source: "user",
				filePath: "/path",
			},
		]);

		registry.registerSkillCommands([createMockSkill("skill", "S")], true);

		const commands = registry.listCommands();
		const names = commands.map((c) => c.name);

		expect(names).not.toContain("template");
		expect(names).not.toContain("skill:skill");
	});
});

describe("listAllCommands - 列出所有可用命令", () => {
	let registry: SlashCommandRegistry;

	beforeEach(() => {
		registry = new SlashCommandRegistry();
	});

	it("应该包含已注册的命令", () => {
		registry.registerCommand({
			name: "custom-cmd",
			description: "Custom",
			execute: async () => ({ success: true }),
		});

		const all = registry.listAllCommands();
		const custom = all.find((c) => c.name === "custom-cmd");

		expect(custom).toBeDefined();
		expect(custom?.source).toBe("extension");
	});

	it("应该包含 Prompt 模板", () => {
		const templates: PromptTemplate[] = [
			{
				name: "prompt-cmd",
				description: "Prompt template",
				content: "Content",
				source: "user",
				filePath: "/path",
			},
		];

		registry.registerPromptTemplates(templates);
		const all = registry.listAllCommands();
		const promptCmd = all.find((c) => c.name === "prompt-cmd");

		expect(promptCmd).toBeDefined();
		expect(promptCmd?.source).toBe("prompt");
	});

	it("应该包含 Skill 命令（当启用时）", () => {
		const skills = [
			createMockSkill("test-skill", "A skill"),
			createMockSkill("another-skill", "Another skill"),
		];

		registry.registerSkillCommands(skills, true);
		const all = registry.listAllCommands();

		// 注意：listAllCommands 返回的是原始 skill.name，不是 skill:name 格式
		// 注册时使用 skill:name 格式，但 listAllCommands 返回原始技能名称
		// 检查 source 为 skill 的命令
		const skillCommands = all.filter((c) => c.source === "skill");
		expect(skillCommands.length).toBe(2);
		expect(skillCommands.some((c) => c.name === "test-skill")).toBe(true);
		expect(skillCommands.some((c) => c.name === "another-skill")).toBe(true);
	});
	it("不应该包含 Skill 命令（当禁用时）", () => {
		const skills = [createMockSkill("test-skill", "A skill")];
		registry.registerSkillCommands(skills, false);
		const all = registry.listAllCommands();

		expect(all.some((c) => c.name === "skill:test-skill")).toBe(false);
	});

	it("结果应该按名称排序", () => {
		const all = registry.listAllCommands();

		for (let i = 1; i < all.length; i++) {
			expect(all[i - 1].name.localeCompare(all[i].name)).toBeLessThanOrEqual(0);
		}
	});
});

describe("registerPromptTemplates - 注册 Prompt 模板", () => {
	let registry: SlashCommandRegistry;

	beforeEach(() => {
		registry = new SlashCommandRegistry();
	});

	it("应该注册单个 Prompt 模板", () => {
		const templates: PromptTemplate[] = [
			{
				name: "test-template",
				description: "Test",
				content: "Hello $1",
				source: "user",
				filePath: "/path/to/test.md",
			},
		];

		registry.registerPromptTemplates(templates);
		expect(registry.hasCommand("test-template")).toBe(true);
	});

	it("应该注册多个 Prompt 模板", () => {
		const templates: PromptTemplate[] = [
			{
				name: "template1",
				description: "First",
				content: "Content 1",
				source: "user",
				filePath: "/path1",
			},
			{
				name: "template2",
				description: "Second",
				content: "Content 2",
				source: "project",
				filePath: "/path2",
			},
		];

		registry.registerPromptTemplates(templates);

		expect(registry.hasCommand("template1")).toBe(true);
		expect(registry.hasCommand("template2")).toBe(true);
	});

	it("模板名应该不区分大小写", () => {
		const templates: PromptTemplate[] = [
			{
				name: "MyTemplate",
				description: "Test",
				content: "Content",
				source: "user",
				filePath: "/path",
			},
		];

		registry.registerPromptTemplates(templates);

		expect(registry.hasCommand("mytemplate")).toBe(true);
		expect(registry.hasCommand("MYTEMPLATE")).toBe(true);
	});

	it("空数组不应该导致错误", () => {
		expect(() => registry.registerPromptTemplates([])).not.toThrow();
	});
});

describe("registerSkillCommands - 注册 Skill 命令", () => {
	let registry: SlashCommandRegistry;

	beforeEach(() => {
		registry = new SlashCommandRegistry();
	});

	it("应该注册 Skill 命令（启用时）", () => {
		const skills = [
			createMockSkill("skill1", "First skill"),
			createMockSkill("skill2", "Second skill"),
		];

		registry.registerSkillCommands(skills, true);

		expect(registry.hasCommand("skill:skill1")).toBe(true);
		expect(registry.hasCommand("skill:skill2")).toBe(true);
	});

	it("Skill 命令名应该不区分大小写", () => {

		const skills = [createMockSkill("MySkill", "Test")];
		registry.registerSkillCommands(skills, true);

		expect(registry.hasCommand("skill:myskill")).toBe(true);
		expect(registry.hasCommand("skill:MYSKILL")).toBe(true);
	});

	it("应该处理空描述的技能", () => {
		const skills = [{ name: "no-desc" } as any];

		registry.registerSkillCommands(skills, true);

		expect(registry.hasCommand("skill:no-desc")).toBe(true);

		const all = registry.listAllCommands();
		// listAllCommands 返回原始技能名称，不带 skill: 前缀
		const skillEntry = all.find((c) => c.name === "no-desc" && c.source === "skill");
		expect(skillEntry).toBeDefined();
		// 空描述会被 || "" 转换为空字符串
		expect(skillEntry?.description).toBe("");
	});

	it("空数组不应该导致错误", () => {
		expect(() => registry.registerSkillCommands([], true)).not.toThrow();
		expect(() => registry.registerSkillCommands([], false)).not.toThrow();
	});
});

describe("边界情况", () => {
	it("应该处理包含特殊字符的命令名", () => {
		const registry = new SlashCommandRegistry();
		const command: SlashCommand = {
			name: "test:command-with-dash",
			description: "Test",
			execute: async () => ({ success: true }),
		};

		registry.registerCommand(command);
		expect(registry.hasCommand("test:command-with-dash")).toBe(true);
	});

	it("应该处理非常长的命令名", () => {
		const registry = new SlashCommandRegistry();
		const longName = "a".repeat(100);

		registry.registerCommand({
			name: longName,
			description: "Long name",
			execute: async () => ({ success: true }),
		});

		expect(registry.hasCommand(longName)).toBe(true);
	});

	it("应该处理命令名中的 Unicode 字符", () => {
		const registry = new SlashCommandRegistry();

		registry.registerCommand({
			name: "测试命令",
			description: "Test",
			execute: async () => ({ success: true }),
		});

		expect(registry.hasCommand("测试命令")).toBe(true);
	});

	it("应该处理大量命令注册", () => {
		const registry = new SlashCommandRegistry();

		for (let i = 0; i < 1000; i++) {
			registry.registerCommand({
				name: `cmd${i}`,
				description: `Command ${i}`,
				execute: async () => ({ success: true }),
			});
		}

		const commands = registry.listCommands();
		expect(commands.length).toBeGreaterThanOrEqual(1000);
	});
});
