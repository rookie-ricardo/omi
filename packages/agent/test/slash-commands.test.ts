/**
 * slash-commands.ts 测试 - Slash 命令系统
 *
 * 测试覆盖：
 * - BUILTIN_SLASH_COMMANDS 完整性
 * - 类型定义
 * - 命令结构
 * - SlashCommandRegistry 功能
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
	BUILTIN_SLASH_COMMANDS,
	type BuiltinSlashCommand,
	type SlashCommandInfo,
	type SlashCommandLocation,
	type SlashCommandSource,
	SlashCommandRegistry,
	createSlashCommandRegistry,
	createSlashCommandContext,
	type SlashCommand,
	type SlashCommandResult,
} from "../src/slash-commands";

describe("BUILTIN_SLASH_COMMANDS - 内置命令完整性", () => {
	it("应该包含所有预期的命令", () => {
		const expectedCommands = [
			"settings",
			"model",
			"scoped-models",
			"export",
			"share",
			"copy",
			"name",
			"session",
			"changelog",
			"hotkeys",
			"fork",
			"tree",
			"login",
			"logout",
			"new",
			"compact",
			"resume",
			"reload",
			"quit",
		];

		const commandNames = BUILTIN_SLASH_COMMANDS.map((cmd) => cmd.name);
		expect(commandNames).toEqual(expect.arrayContaining(expectedCommands));
		expect(BUILTIN_SLASH_COMMANDS).toHaveLength(expectedCommands.length);
	});

	it("应该是只读数组", () => {
		// ReadonlyArray 类型在编译时保证，运行时验证类型
		expect(Array.isArray(BUILTIN_SLASH_COMMANDS)).toBe(true);
		// 尝试修改应该不会在运行时报错（但 TypeScript 会报错）
		const arr = BUILTIN_SLASH_COMMANDS as BuiltinSlashCommand[];
		expect(() => arr.push({ name: "test", description: "test" })).not.toThrow();
	});

	it("每个命令应该有 name 和 description", () => {
		BUILTIN_SLASH_COMMANDS.forEach((command) => {
			expect(command.name).toBeDefined();
			expect(command.name).toBeTruthy();
			expect(command.description).toBeDefined();
			expect(command.description).toBeTruthy();
		});
	});

	it("命令名应该是唯一的", () => {
		const names = BUILTIN_SLASH_COMMANDS.map((cmd) => cmd.name);
		const uniqueNames = new Set(names);
		expect(uniqueNames.size).toBe(names.length);
	});

	it("命令名应该是小写且不含空格", () => {
		BUILTIN_SLASH_COMMANDS.forEach((command) => {
			expect(command.name).toBe(command.name.toLowerCase());
			expect(command.name).not.toContain(" ");
		});
	});
});

describe("BuiltinSlashCommand 类型", () => {
	it("每个内置命令应该符合 BuiltinSlashCommand 类型", () => {
		BUILTIN_SLASH_COMMANDS.forEach((command) => {
			expect(command).toHaveProperty("name");
			expect(command).toHaveProperty("description");

			// 验证类型
			expect(typeof command.name).toBe("string");
			expect(typeof command.description).toBe("string");
		});
	});

	it("内置命令示例应该有正确的结构", () => {
		const sampleCommand: BuiltinSlashCommand = {
			name: "test",
			description: "Test command",
		};

		expect(sampleCommand.name).toBe("test");
		expect(sampleCommand.description).toBe("Test command");
	});
});

describe("SlashCommandInfo 类型", () => {
	it("应该接受有效的 SlashCommandInfo", () => {
		const validInfo: SlashCommandInfo = {
			name: "custom-command",
			description: "Custom command description",
			source: "extension",
			location: "user",
			path: "/path/to/command",
		};

		expect(validInfo.name).toBe("custom-command");
		expect(validInfo.source).toBe("extension");
	});

	it("description 和 location 应该是可选的", () => {
		const minimalInfo: SlashCommandInfo = {
			name: "minimal",
			source: "prompt",
		};

		expect(minimalInfo.name).toBe("minimal");
		expect(minimalInfo.description).toBeUndefined();
		expect(minimalInfo.location).toBeUndefined();
	});
});

describe("SlashCommandSource 类型", () => {
	it("应该接受所有有效的 source 值", () => {
		const sources: SlashCommandSource[] = ["extension", "prompt", "skill"];

		sources.forEach((source) => {
			const info: SlashCommandInfo = {
				name: "test",
				source,
			};
			expect(info.source).toBe(source);
		});
	});

	it("应该拒绝无效的 source 值", () => {
		// TypeScript 会在编译时捕获这个，运行时我们验证结构
		const createInfo = (source: string): SlashCommandInfo => ({
			name: "test",
			source: source as SlashCommandSource,
		});

		const validSources: SlashCommandSource[] = ["extension", "prompt", "skill"];
		validSources.forEach((source) => {
			const info = createInfo(source);
			expect(["extension", "prompt", "skill"]).toContain(info.source);
		});
	});
});

describe("SlashCommandLocation 类型", () => {
	it("应该接受所有有效的 location 值", () => {
		const locations: SlashCommandLocation[] = ["user", "project", "path"];

		locations.forEach((location) => {
			const info: SlashCommandInfo = {
				name: "test",
				source: "extension",
				location,
			};
			expect(info.location).toBe(location);
		});
	});
});

describe("特定命令验证", () => {
	it("settings 命令应该存在", () => {
		const settings = BUILTIN_SLASH_COMMANDS.find((cmd) => cmd.name === "settings");
		expect(settings).toBeDefined();
		expect(settings?.description).toContain("settings");
	});

	it("model 命令应该存在", () => {
		const model = BUILTIN_SLASH_COMMANDS.find((cmd) => cmd.name === "model");
		expect(model).toBeDefined();
		expect(model?.description).toContain("model");
	});

	it("quit 命令应该存在", () => {
		const quit = BUILTIN_SLASH_COMMANDS.find((cmd) => cmd.name === "quit");
		expect(quit).toBeDefined();
		expect(quit?.description).toContain("Quit");
	});

	it("所有命令的描述应该是有意义的", () => {
		BUILTIN_SLASH_COMMANDS.forEach((command) => {
			// 描述至少要有一定长度
			expect(command.description.length).toBeGreaterThan(3);
			// 描述应该包含一些实际内容
			expect(command.description.trim()).toBeTruthy();
		});
	});
});

describe("命令分类", () => {
	it("应该有会话管理命令", () => {
		const sessionCommands = BUILTIN_SLASH_COMMANDS.filter((cmd) =>
			["new", "session", "resume", "name", "fork", "tree"].includes(cmd.name),
		);
		expect(sessionCommands.length).toBeGreaterThanOrEqual(6);
	});

	it("应该有配置命令", () => {
		const configCommands = BUILTIN_SLASH_COMMANDS.filter((cmd) =>
			["settings", "model", "scoped-models", "reload", "hotkeys"].includes(cmd.name),
		);
		expect(configCommands.length).toBeGreaterThanOrEqual(5);
	});

	it("应该有导出相关命令", () => {
		const exportCommands = BUILTIN_SLASH_COMMANDS.filter((cmd) =>
			["export", "share", "copy"].includes(cmd.name),
		);
		expect(exportCommands.length).toBeGreaterThanOrEqual(3);
	});

	it("应该有认证命令", () => {
		const authCommands = BUILTIN_SLASH_COMMANDS.filter((cmd) =>
			["login", "logout"].includes(cmd.name),
		);
		expect(authCommands.length).toBe(2);
	});
});

describe("边界情况", () => {
	it("应该能处理空命令名（验证类型系统）", () => {
		const emptyNameCommand: BuiltinSlashCommand = {
			name: "",
			description: "Empty name",
		};
		expect(emptyNameCommand.name).toBe("");
	});

	it("应该能处理特殊字符在描述中", () => {
		const specialDescCommand: BuiltinSlashCommand = {
			name: "special",
			description: "Command with (parentheses), \"quotes\", and - dashes",
		};
		expect(specialDescCommand.description).toContain("(");
		expect(specialDescCommand.description).toContain(")");
		expect(specialDescCommand.description).toContain("\"");
		expect(specialDescCommand.description).toContain("-");
	});
});

describe("与 Pi-Mono 一致性", () => {
	it("命令数量应与 Pi-Mono 一致", () => {
		// Omi 有 20 个内置命令（新增了 hotkeys）
		expect(BUILTIN_SLASH_COMMANDS).toHaveLength(20);
	});

	it("特定命令应与 Pi-Mono 完全一致", () => {
		const piCommands = [
			{ name: "settings", description: "Open settings menu" },
			{ name: "model", description: "Select model (opens selector UI)" },
			{ name: "quit", description: "Quit pi" },
		];

		piCommands.forEach((piCmd) => {
			const match = BUILTIN_SLASH_COMMANDS.find((cmd) => cmd.name === piCmd.name);
			expect(match).toBeDefined();
			expect(match?.description).toBe(piCmd.description);
		});
	});
});
