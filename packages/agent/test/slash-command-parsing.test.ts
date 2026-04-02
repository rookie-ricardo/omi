/**
 * slash-command-parsing.test.ts - 命令解析测试
 *
 * 测试覆盖：
 * - parseCommand - 解析命令字符串为名称和参数
 * - 基本命令解析
 * - 带参数的命令解析
 * - 边界情况（空输入、无参数、多个空格等）
 * - 特殊字符处理
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SlashCommandRegistry } from "../src/slash-commands";

describe("parseCommand - 命令解析", () => {
	let registry: SlashCommandRegistry;

	beforeEach(() => {
		registry = new SlashCommandRegistry();
	});

	describe("基本命令解析", () => {
		it("应该解析简单的命令（无参数）", () => {
			const result = registry.parseCommand("/help");
			expect(result.name).toBe("help");
			expect(result.args).toBe("");
		});

		it("应该解析带单个参数的命令", () => {
			const result = registry.parseCommand("/model claude-3-5-sonnet");
			expect(result.name).toBe("model");
			expect(result.args).toBe("claude-3-5-sonnet");
		});

		it("应该解析带多个参数的命令", () => {
			const result = registry.parseCommand("/custom arg1 arg2 arg3");
			expect(result.name).toBe("custom");
			expect(result.args).toBe("arg1 arg2 arg3");
		});

		it("应该保留参数中的空格", () => {
			const result = registry.parseCommand("/cmd hello world test");
			expect(result.name).toBe("cmd");
			expect(result.args).toBe("hello world test");
		});
	});

	describe("边界情况", () => {
		it("应该处理空字符串", () => {
			const result = registry.parseCommand("");
			expect(result.name).toBe("");
			expect(result.args).toBe("");
		});

		it("应该处理只有斜杠的输入", () => {
			const result = registry.parseCommand("/");
			expect(result.name).toBe("");
			expect(result.args).toBe("");
		});

		it("应该处理无斜杠的输入", () => {
			const result = registry.parseCommand("help");
			expect(result.name).toBe("");
			expect(result.args).toBe("");
		});

		it("应该处理命令前后的空格", () => {
			const result = registry.parseCommand("  /help  ");
			expect(result.name).toBe("help");
			expect(result.args).toBe("");
		});

		it("应该处理命令后的多个空格", () => {
			const result = registry.parseCommand("/model     claude");
			expect(result.name).toBe("model");
			expect(result.args).toBe("claude");
		});

		it("应该处理参数前的多个空格", () => {
			const result = registry.parseCommand("/cmd    arg1    arg2");
			expect(result.name).toBe("cmd");
			expect(result.args).toBe("arg1    arg2");
		});

		it("应该处理只有命令名和空格的情况", () => {
			const result = registry.parseCommand("/help ");
			expect(result.name).toBe("help");
			expect(result.args).toBe("");
		});
	});

	describe("特殊字符处理", () => {
		it("应该处理带引号的参数", () => {
			const result = registry.parseCommand('/cmd "quoted string"');
			expect(result.name).toBe("cmd");
			expect(result.args).toBe('"quoted string"');
		});

		it("应该处理带单引号的参数", () => {
			const result = registry.parseCommand("/cmd 'single quoted'");
			expect(result.name).toBe("cmd");
			expect(result.args).toBe("'single quoted'");
		});

		it("应该处理命令名中的连字符", () => {
			const result = registry.parseCommand("/my-custom-command arg");
			expect(result.name).toBe("my-custom-command");
			expect(result.args).toBe("arg");
		});

		it("应该处理命令名中的冒号", () => {
			const result = registry.parseCommand("/skill:generate arg");
			expect(result.name).toBe("skill:generate");
			expect(result.args).toBe("arg");
		});

		it("应该处理参数中的特殊字符", () => {
			const result = registry.parseCommand("/cmd user@example.com");
			expect(result.name).toBe("cmd");
			expect(result.args).toBe("user@example.com");
		});

		it("应该处理参数中的 URL", () => {
			const result = registry.parseCommand("/cmd https://example.com/path?query=value");
			expect(result.name).toBe("cmd");
			expect(result.args).toBe("https://example.com/path?query=value");
		});

		it("应该处理参数中的路径", () => {
			const result = registry.parseCommand("/cmd /path/to/file");
			expect(result.name).toBe("cmd");
			expect(result.args).toBe("/path/to/file");
		});

		it("应该处理 Unicode 命令名", () => {
			const result = registry.parseCommand("/测试 参数");
			expect(result.name).toBe("测试");
			expect(result.args).toBe("参数");
		});
	});

	describe("复杂参数解析", () => {
		it("应该解析包含等号的参数", () => {
			const result = registry.parseCommand("/settings key=value");
			expect(result.name).toBe("settings");
			expect(result.args).toBe("key=value");
		});

		it("应该解析包含多个等号的参数", () => {
			const result = registry.parseCommand("/cmd key1=value1 key2=value2");
			expect(result.name).toBe("cmd");
			expect(result.args).toBe("key1=value1 key2=value2");
		});

		it("应该解析包含连字符的参数", () => {
			const result = registry.parseCommand("/model --version latest");
			expect(result.name).toBe("model");
			expect(result.args).toBe("--version latest");
		});

		it("应该解析包含数字的参数", () => {
			const result = registry.parseCommand("/cmd 123 456 789");
			expect(result.name).toBe("cmd");
			expect(result.args).toBe("123 456 789");
		});

		it("应该解析混合类型的参数", () => {
			const result = registry.parseCommand('/cmd text123 "quoted" 456 --flag');
			expect(result.name).toBe("cmd");
			expect(result.args).toBe('text123 "quoted" 456 --flag');
		});
	});

	describe("实际使用场景", () => {
		it("应该正确解析 /model 命令", () => {
			const result = registry.parseCommand("/model claude-sonnet-4-20250514");
			expect(result.name).toBe("model");
			expect(result.args).toBe("claude-sonnet-4-20250514");
		});

		it("应该正确解析 /fork 命令", () => {
			const result = registry.parseCommand("/fork msg-123");
			expect(result.name).toBe("fork");
			expect(result.args).toBe("msg-123");
		});

		it("应该正确解析 /settings 命令", () => {
			const result = registry.parseCommand("/settings retry.maxRetries 5");
			expect(result.name).toBe("settings");
			expect(result.args).toBe("retry.maxRetries 5");
		});

		it("应该正确解析 /new 命令", () => {
			const result = registry.parseCommand("/new My Session Title");
			expect(result.name).toBe("new");
			expect(result.args).toBe("My Session Title");
		});

		it("应该正确解析 /resume 命令", () => {
			const result = registry.parseCommand("/resume session-abc-123");
			expect(result.name).toBe("resume");
			expect(result.args).toBe("session-abc-123");
		});

		it("应该正确解析 /help 命令（带参数）", () => {
			const result = registry.parseCommand("/help model");
			expect(result.name).toBe("help");
			expect(result.args).toBe("model");
		});

		it("应该正确解析 skill 命令", () => {
			const result = registry.parseCommand("/skill:refactor optimize this code");
			expect(result.name).toBe("skill:refactor");
			expect(result.args).toBe("optimize this code");
		});
	});

	describe("空白字符变体", () => {
		it("应该处理制表符（作为分隔符）", () => {
			// parseCommand 使用 indexOf(" ") 查找第一个空格，不处理制表符作为分隔符
			const result = registry.parseCommand("/cmd\targ1\targ2");
			// 整个内容被视为命令名
			expect(result.name).toBe("cmd\targ1\targ2");
			expect(result.args).toBe("");
		});

		it("应该处理混合空白字符", () => {
			const result = registry.parseCommand("  /cmd  \t  arg  ");
			// \t 不是空格，所以被视为命令名的一部分
			// 但 trim() 会移除前导空格
			expect(result.name).toContain("cmd");
			expect(result.args).toBe("arg");
		});
	});
});

describe("命令解析与大小写", () => {
	let registry: SlashCommandRegistry;

	beforeEach(() => {
		registry = new SlashCommandRegistry();
	});

	it("应该保留命令名的大小写（parse 阶段）", () => {
		const result = registry.parseCommand("/Model");
		expect(result.name).toBe("Model");
	});

	it("应该保留参数的大小写", () => {
		const result = registry.parseCommand("/model ClaudeSonnet");
		expect(result.args).toBe("ClaudeSonnet");
	});

	it("应该处理混合大小写的命令名", () => {
		const result = registry.parseCommand("/MyCustomCommand args");
		expect(result.name).toBe("MyCustomCommand");
		expect(result.args).toBe("args");
	});
});

describe("极端情况", () => {
	let registry: SlashCommandRegistry;

	beforeEach(() => {
		registry = new SlashCommandRegistry();
	});

	it("应该处理非常长的命令", () => {
		const longCmd = "/".padEnd(10000, "a");
		const result = registry.parseCommand(longCmd);
		expect(result.name).toBe(longCmd.slice(1));
	});

	it("应该处理只有空格的输入", () => {
		const result = registry.parseCommand("     ");
		expect(result.name).toBe("");
		expect(result.args).toBe("");
	});

	it("应该处理多个斜杠", () => {
		const result = registry.parseCommand("//help");
		expect(result.name).toBe("/help");
	});

	it("应该处理斜杠不在开头的情况", () => {
		const result = registry.parseCommand("text /help");
		expect(result.name).toBe("");
		expect(result.args).toBe("");
	});
});
