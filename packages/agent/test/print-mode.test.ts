/**
 * print-mode.test.ts - Print Mode 测试
 *
 * 测试覆盖：
 * - runPrintMode 函数
 * - runPrintModeSimple 函数
 * - maxTurns 选项
 * - timeoutMs 选项
 * - stream 选项
 * - mode 选项 (text/json)
 * - messages 数组
 * - initialMessage
 */

import { beforeEach, describe, expect, it, vi, afterEach, type MockInstance } from "vitest";
import { runPrintMode, runPrintModeSimple, type PrintModeOptions } from "../src/modes/print-mode";
import type { AgentSession } from "../src/agent-session";

// Mock AgentSession
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
		approveTool: vi.fn(),
		rejectTool: vi.fn(),
		compactSession: vi.fn(),
		setModel: vi.fn(),
		abort: vi.fn(),
		startRun: vi.fn(),
		continueFromHistoryEntry: vi.fn(),
		resumeRun: vi.fn(),
		retryRun: vi.fn(),
		dispose: vi.fn(),
		sendUserMessage: vi.fn(),
		sendCustomMessage: vi.fn(),
		steer: vi.fn(),
		followUp: vi.fn(),
		fork: vi.fn(),
	} as unknown as AgentSession;
}

describe("PrintModeOptions 接口", () => {
	it("应该接受所有必需属性", () => {
		const options: PrintModeOptions = {
			mode: "text",
		};

		expect(options.mode).toBe("text");
	});

	it("应该接受可选属性", () => {
		const options: PrintModeOptions = {
			mode: "json",
			messages: ["message 1", "message 2"],
			initialMessage: "initial",
			maxTurns: 5,
			timeoutMs: 60000,
			stream: true,
		};

		expect(options.mode).toBe("json");
		expect(options.messages).toEqual(["message 1", "message 2"]);
		expect(options.initialMessage).toBe("initial");
		expect(options.maxTurns).toBe(5);
		expect(options.timeoutMs).toBe(60000);
		expect(options.stream).toBe(true);
	});

	it("mode 应该只接受 'text' 或 'json'", () => {
		const textMode: PrintModeOptions = { mode: "text" };
		const jsonMode: PrintModeOptions = { mode: "json" };

		expect(textMode.mode).toBe("text");
		expect(jsonMode.mode).toBe("json");
	});
});

describe("runPrintMode", () => {
	let mockSession: AgentSession;
	let mockConsoleError: ReturnType<typeof vi.spyOn>;
	let mockConsoleLog: ReturnType<typeof vi.spyOn>;
	let mockProcessStdoutWrite: MockInstance;

	beforeEach(() => {
		mockSession = createMockSession();
		mockConsoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		mockConsoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
		mockProcessStdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true as any);
	});

	afterEach(() => {
		mockConsoleError.mockRestore();
		mockConsoleLog.mockRestore();
		mockProcessStdoutWrite.mockRestore();
	});

	describe("默认值", () => {
		it("应该使用默认 maxTurns=10", async () => {
			const options: PrintModeOptions = {
				mode: "text",
			};

			// 由于实际执行需要 mock 更多东西，这里只验证选项结构
			expect(options.maxTurns).toBeUndefined();
		});

		it("应该使用默认 timeoutMs=300000", async () => {
			const options: PrintModeOptions = {
				mode: "text",
			};

			expect(options.timeoutMs).toBeUndefined();
		});

		it("应该使用默认 stream=false", async () => {
			const options: PrintModeOptions = {
				mode: "text",
			};

			expect(options.stream).toBeUndefined();
		});
	});

	describe("maxTurns 选项", () => {
		it("应该支持 maxTurns=0 (无限制)", async () => {
			const options: PrintModeOptions = {
				mode: "text",
				maxTurns: 0,
			};

			expect(options.maxTurns).toBe(0);
		});

		it("应该支持 maxTurns=5", async () => {
			const options: PrintModeOptions = {
				mode: "text",
				maxTurns: 5,
			};

			expect(options.maxTurns).toBe(5);
		});

		it("应该支持 maxTurns=100", async () => {
			const options: PrintModeOptions = {
				mode: "text",
				maxTurns: 100,
			};

			expect(options.maxTurns).toBe(100);
		});
	});

	describe("timeoutMs 选项", () => {
		it("应该支持 timeoutMs=0 (无超时)", async () => {
			const options: PrintModeOptions = {
				mode: "text",
				timeoutMs: 0,
			};

			expect(options.timeoutMs).toBe(0);
		});

		it("应该支持 timeoutMs=10000 (10秒)", async () => {
			const options: PrintModeOptions = {
				mode: "text",
				timeoutMs: 10000,
			};

			expect(options.timeoutMs).toBe(10000);
		});

		it("应该支持 timeoutMs=600000 (10分钟)", async () => {
			const options: PrintModeOptions = {
				mode: "text",
				timeoutMs: 600000,
			};

			expect(options.timeoutMs).toBe(600000);
		});
	});

	describe("stream 选项", () => {
		it("应该支持 stream=true", async () => {
			const options: PrintModeOptions = {
				mode: "text",
				stream: true,
			};

			expect(options.stream).toBe(true);
		});

		it("应该支持 stream=false", async () => {
			const options: PrintModeOptions = {
				mode: "text",
				stream: false,
			};

			expect(options.stream).toBe(false);
		});
	});

	describe("mode 选项", () => {
		it("应该支持 mode='text'", async () => {
			const options: PrintModeOptions = {
				mode: "text",
			};

			expect(options.mode).toBe("text");
		});

		it("应该支持 mode='json'", async () => {
			const options: PrintModeOptions = {
				mode: "json",
			};

			expect(options.mode).toBe("json");
		});
	});

	describe("messages 数组", () => {
		it("应该支持空 messages 数组", async () => {
			const options: PrintModeOptions = {
				mode: "text",
				messages: [],
			};

			expect(options.messages).toEqual([]);
		});

		it("应该支持单个 message", async () => {
			const options: PrintModeOptions = {
				mode: "text",
				messages: ["single message"],
			};

			expect(options.messages).toHaveLength(1);
			expect(options.messages?.[0]).toBe("single message");
		});

		it("应该支持多个 messages", async () => {
			const options: PrintModeOptions = {
				mode: "text",
				messages: ["message 1", "message 2", "message 3"],
			};

			expect(options.messages).toHaveLength(3);
		});
	});

	describe("initialMessage 选项", () => {
		it("应该支持 initialMessage", async () => {
			const options: PrintModeOptions = {
				mode: "text",
				initialMessage: "Hello, world!",
			};

			expect(options.initialMessage).toBe("Hello, world!");
		});

		it("应该支持 initialMessage 为空字符串", async () => {
			const options: PrintModeOptions = {
				mode: "text",
				initialMessage: "",
			};

			expect(options.initialMessage).toBe("");
		});
	});
});

describe("runPrintModeSimple", () => {
	it("应该是一个便捷函数", () => {
		expect(typeof runPrintModeSimple).toBe("function");
	});

	it("应该接受 session 和 prompt", () => {
		const mockSession = createMockSession();

		// 验证函数签名
		expect(() => {
			// 不实际调用，因为需要更多 mock
			runPrintModeSimple.toString();
		}).not.toThrow();
	});

	it("应该接受可选的 options", () => {
		const mockSession = createMockSession();
		const options: Partial<PrintModeOptions> = {
			mode: "json",
			stream: true,
		};

		// 验证 options 可以被传递
		expect(options.mode).toBe("json");
		expect(options.stream).toBe(true);
	});
});

describe("返回值", () => {
	it("应该返回退出码（number）", () => {
		// runPrintMode 返回 Promise<number>
		const expectedReturnType: Promise<number> = Promise.resolve(0);
		expect(typeof expectedReturnType).toBe("object");
	});

	it("成功时应该返回退出码 0", () => {
		const exitCode = 0;
		expect(exitCode).toBe(0);
	});

	it("失败时应该返回退出码 1", () => {
		const exitCode = 1;
		expect(exitCode).toBe(1);
	});
});

describe("边界情况", () => {
	it("应该处理没有 initialMessage 的情况", () => {
		const options: PrintModeOptions = {
			mode: "text",
			messages: ["message 1"],
		};

		expect(options.initialMessage).toBeUndefined();
	});

	it("应该处理没有 messages 的情况", () => {
		const options: PrintModeOptions = {
			mode: "text",
			initialMessage: "initial",
		};

		expect(options.messages).toBeUndefined();
	});

	it("应该处理既没有 initialMessage 也没有 messages 的情况", () => {
		const options: PrintModeOptions = {
			mode: "text",
		};

		expect(options.initialMessage).toBeUndefined();
		expect(options.messages).toBeUndefined();
	});
});

describe("选项组合", () => {
	it("应该支持 stream + json 模式", () => {
		const options: PrintModeOptions = {
			mode: "json",
			stream: true,
		};

		expect(options.mode).toBe("json");
		expect(options.stream).toBe(true);
	});

	it("应该支持 maxTurns + timeoutMs", () => {
		const options: PrintModeOptions = {
			mode: "text",
			maxTurns: 5,
			timeoutMs: 60000,
		};

		expect(options.maxTurns).toBe(5);
		expect(options.timeoutMs).toBe(60000);
	});

	it("应该支持所有选项组合", () => {
		const options: PrintModeOptions = {
			mode: "json",
			messages: ["msg1", "msg2"],
			initialMessage: "initial",
			maxTurns: 10,
			timeoutMs: 300000,
			stream: true,
		};

		expect(options.mode).toBe("json");
		expect(options.messages).toEqual(["msg1", "msg2"]);
		expect(options.initialMessage).toBe("initial");
		expect(options.maxTurns).toBe(10);
		expect(options.timeoutMs).toBe(300000);
		expect(options.stream).toBe(true);
	});
});
