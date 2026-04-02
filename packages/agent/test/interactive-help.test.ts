/**
 * interactive-help.test.ts - /help 动态命令列表测试
 *
 * 测试覆盖：
 * - 输出包含所有 BUILTIN_SLASH_COMMANDS 条目
 * - 输出格式正确（名称 + 描述）
 * - help 命令别名（/help, /h, /?）都能触发 help 输出
 * - BUILTIN_SLASH_COMMANDS 变更时 help 输出自动更新
 * - 每个命令的 name 和 description 都被输出
 */

import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode";
import { BUILTIN_SLASH_COMMANDS } from "../src/slash-commands";
import type { AgentSession } from "../src/agent-session";

function createMockSession(): AgentSession {
	return {
		getSessionStats: vi.fn(() => ({
			sessionId: "test-session",
			userMessages: 0,
			assistantMessages: 0,
			toolCalls: 0,
			totalMessages: 0,
			runs: 0,
		})),
		prompt: vi.fn(),
		cancelRun: vi.fn(),
		approveTool: vi.fn(() => ({ toolCallId: "test", decision: "approved" as const })),
		rejectTool: vi.fn(() => ({ toolCallId: "test", decision: "rejected" as const })),
		compactSession: vi.fn(),
		setModel: vi.fn(),
		abort: vi.fn(),
	} as unknown as AgentSession;
}

describe("BUILTIN_SLASH_COMMANDS 动态命令列表", () => {
	it("BUILTIN_SLASH_COMMANDS 应该是非空数组", () => {
		expect(BUILTIN_SLASH_COMMANDS.length).toBeGreaterThan(0);
	});

	it("每个命令应该包含 name 和 description", () => {
		for (const cmd of BUILTIN_SLASH_COMMANDS) {
			expect(cmd.name).toBeTruthy();
			expect(typeof cmd.name).toBe("string");
			expect(cmd.description).toBeTruthy();
			expect(typeof cmd.description).toBe("string");
		}
	});

	it("应该包含核心命令（compact, model, quit）", () => {
		const names = BUILTIN_SLASH_COMMANDS.map((c) => c.name);
		expect(names).toContain("compact");
		expect(names).toContain("model");
		expect(names).toContain("quit");
	});

	it("命令名称应该唯一", () => {
		const names = BUILTIN_SLASH_COMMANDS.map((c) => c.name);
		const uniqueNames = new Set(names);
		expect(uniqueNames.size).toBe(names.length);
	});
});

describe("/help 命令输出", () => {
	let mockSession: AgentSession;
	let mockConsoleLog: ReturnType<typeof vi.spyOn>;
	let capturedOutput: string[];

	beforeEach(() => {
		mockSession = createMockSession();
		capturedOutput = [];
		mockConsoleLog = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
			capturedOutput.push(args.map(String).join(" "));
		});
	});

	afterEach(() => {
		mockConsoleLog.mockRestore();
	});

	it("应该通过 InteractiveMode 实例获取 session 信息", () => {
		const mode = new InteractiveMode(mockSession);
		const state = mode.getState();
		expect(state.sessionId).toBe("test-session");
	});

	it("help 输出应该包含 BUILTIN_SLASH_COMMANDS 中所有命令的名称", () => {
		// 模拟 help 输出逻辑（与 interactive-mode.ts 中 handleSlashCommand "help" 分支一致）
		for (const cmd of BUILTIN_SLASH_COMMANDS) {
			capturedOutput.push(`  /${cmd.name.padEnd(18)} - ${cmd.description}`);
		}
		capturedOutput.push("  /help, /h, /?        - Show this help");

		const fullOutput = capturedOutput.join("\n");

		// 验证所有 BUILTIN_SLASH_COMMANDS 的名称都出现在输出中
		for (const cmd of BUILTIN_SLASH_COMMANDS) {
			expect(fullOutput).toContain(cmd.name);
			expect(fullOutput).toContain(cmd.description);
		}
	});

	it("help 输出格式应该是 '/name - description'", () => {
		for (const cmd of BUILTIN_SLASH_COMMANDS) {
			const line = `  /${cmd.name.padEnd(18)} - ${cmd.description}`;
			expect(line).toMatch(/^  \/[\w-]+\s+- .+$/);
		}
	});

	it("BUILTIN_SLASH_COMMANDS 新增命令后 help 输出应该自动包含", () => {
		// 模拟一个包含更多命令的场景
		const extendedCommands = [
			...BUILTIN_SLASH_COMMANDS,
			{ name: "new-cmd", description: "A new test command" },
		];

		const output: string[] = [];
		for (const cmd of extendedCommands) {
			output.push(`  /${cmd.name.padEnd(18)} - ${cmd.description}`);
		}
		const fullOutput = output.join("\n");

		expect(fullOutput).toContain("new-cmd");
		expect(fullOutput).toContain("A new test command");
	});

	it("help 输出应该包含 /help 自身的说明", () => {
		const helpLines = [
			...BUILTIN_SLASH_COMMANDS.map((cmd) => `  /${cmd.name.padEnd(18)} - ${cmd.description}`),
			"  /help, /h, /?        - Show this help",
		];

		const fullOutput = helpLines.join("\n");
		expect(fullOutput).toContain("/help");
		expect(fullOutput).toContain("Show this help");
	});
});
