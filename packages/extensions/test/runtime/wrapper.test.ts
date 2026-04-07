/**
 * wrapper.ts 测试 - 扩展工具包装器
 *
 * 测试覆盖：
 * - wrapRegisteredTool - 单个工具包装
 * - wrapRegisteredTools - 批量工具包装
 * - RegisteredTool 接口
 */

import { describe, it, expect, vi } from "vitest";
import type { OmiTool } from "@omi/core";
import {
	wrapRegisteredTool,
	wrapRegisteredTools,
	type RegisteredTool,
} from "../../src/runtime/wrapper";

// Mock ExtensionRunner
const createMockRunner = () => ({
	createContext: vi.fn(() => ({ mockContext: true })),
}) as any;

// Mock tool definition
const createMockRegisteredTool = (name: string): RegisteredTool => ({
	definition: {
		name,
		label: `${name}Label`,
		description: `Description for ${name}`,
		parameters: {
			type: "object",
			properties: {
				arg1: { type: "string" },
			},
		},
		execute: vi.fn(async (toolCallId, params, signal, onUpdate, context) => {
			return { result: `${name} executed` };
		}),
	},
});

describe("wrapRegisteredTool - 单个工具包装", () => {
	it("应该包装工具为 OmiTool 格式", () => {
		const registeredTool = createMockRegisteredTool("testTool");
		const runner = createMockRunner();

		const wrapped = wrapRegisteredTool(registeredTool, runner);

		expect(wrapped.name).toBe("testTool");
		expect(wrapped.label).toBe("testToolLabel");
		expect(wrapped.description).toBe("Description for testTool");
		expect(wrapped.parameters).toBeDefined();
		expect(wrapped.execute).toBeInstanceOf(Function);
	});

	it("当 label 未定义时应使用 name 作为默认值", () => {
		const registeredTool: RegisteredTool = {
			definition: {
				name: "noLabelTool",
				description: "Tool without label",
				parameters: {},
				execute: vi.fn(),
			},
		};
		const runner = createMockRunner();

		const wrapped = wrapRegisteredTool(registeredTool, runner);

		expect(wrapped.label).toBe("noLabelTool");
	});

	it("execute 时应该传递 runner context", async () => {
		const mockExecute = vi.fn(async (toolCallId, params, signal, onUpdate, context) => {
			expect(context).toEqual({ mockContext: true });
			return { executed: true };
		});

		const registeredTool: RegisteredTool = {
			definition: {
				name: "contextTool",
				description: "Tool that uses context",
				parameters: {},
				execute: mockExecute,
			},
		};

		const runner = createMockRunner();
		const wrapped = wrapRegisteredTool(registeredTool, runner);

		await wrapped.execute("call123", {}, undefined, undefined);

		expect(mockExecute).toHaveBeenCalledWith(
			"call123",
			{},
			undefined,
			undefined,
			{ mockContext: true },
		);
	});

	it("应该传递所有 execute 参数", async () => {
		const mockExecute = vi.fn(async (toolCallId, params, signal, onUpdate, context) => {
			return { result: "done" };
		});

		const registeredTool: RegisteredTool = {
			definition: {
				name: "paramTool",
				description: "Tool with parameters",
				parameters: {},
				execute: mockExecute,
			},
		};

		const runner = createMockRunner();
		const wrapped = wrapRegisteredTool(registeredTool, runner);

		const controller = new AbortController();
		const onUpdate = vi.fn();

		await wrapped.execute("call456", { arg: "value" }, controller.signal, onUpdate);

		expect(mockExecute).toHaveBeenCalledWith(
			"call456",
			{ arg: "value" },
			controller.signal,
			onUpdate,
			{ mockContext: true },
		);
	});

	it("应该返回 execute 的结果", async () => {
		const expectedResult = { data: "test result" };
		const registeredTool: RegisteredTool = {
			definition: {
				name: "resultTool",
				description: "Tool that returns result",
				parameters: {},
				execute: vi.fn().mockResolvedValue(expectedResult),
			},
		};

		const runner = createMockRunner();
		const wrapped = wrapRegisteredTool(registeredTool, runner);

		const result = await wrapped.execute("call789", {}, undefined, undefined);

		expect(result).toEqual(expectedResult);
	});
});

describe("wrapRegisteredTools - 批量工具包装", () => {
	it("应该包装所有工具", () => {
		const tools = [
			createMockRegisteredTool("tool1"),
			createMockRegisteredTool("tool2"),
			createMockRegisteredTool("tool3"),
		];

		const runner = createMockRunner();
		const wrapped = wrapRegisteredTools(tools, runner);

		expect(wrapped).toHaveLength(3);
		expect(wrapped[0].name).toBe("tool1");
		expect(wrapped[1].name).toBe("tool2");
		expect(wrapped[2].name).toBe("tool3");
	});

	it("应该为每个工具传递 runner context", async () => {
		const mockExecute1 = vi.fn();
		const mockExecute2 = vi.fn();

		const tools: RegisteredTool[] = [
			{
				definition: {
					name: "tool1",
					description: "Tool 1",
					parameters: {},
					execute: mockExecute1,
				},
			},
			{
				definition: {
					name: "tool2",
					description: "Tool 2",
					parameters: {},
					execute: mockExecute2,
				},
			},
		];

		const runner = createMockRunner();
		const wrapped = wrapRegisteredTools(tools, runner);

		// 执行两个工具
		await wrapped[0].execute("call1", {}, undefined, undefined);
		await wrapped[1].execute("call2", {}, undefined, undefined);

		// 验证两个工具都被调用且收到了 runner context
		expect(mockExecute1).toHaveBeenCalled();
		expect(mockExecute2).toHaveBeenCalled();

		// 验证第一个工具的调用参数
		expect(mockExecute1.mock.calls[0][4]).toEqual({ mockContext: true });
		// 验证第二个工具的调用参数
		expect(mockExecute2.mock.calls[0][4]).toEqual({ mockContext: true });
	});

	it("空数组应返回空数组", () => {
		const runner = createMockRunner();
		const wrapped = wrapRegisteredTools([], runner);

		expect(wrapped).toEqual([]);
	});

	it("应该保留每个工具的独立定义", () => {
		const tools = [
			createMockRegisteredTool("toolA"),
			createMockRegisteredTool("toolB"),
		];

		const runner = createMockRunner();
		const wrapped = wrapRegisteredTools(tools, runner);

		expect(wrapped[0].name).not.toBe(wrapped[1].name);
		expect(wrapped[0].label).not.toBe(wrapped[1].label);
	});
});

describe("RegisteredTool 接口", () => {
	it("应该接受符合接口的工具定义", () => {
		const validTool: RegisteredTool = {
			definition: {
				name: "validTool",
				label: "Valid Tool",
				description: "A valid tool definition",
				parameters: {
					type: "object",
					properties: {
						input: { type: "string" },
					},
					required: ["input"],
				},
				execute: async () => ({ success: true }),
			},
		};

		expect(validTool.definition.name).toBe("validTool");
	});

	it("label 应该是可选的", () => {
		const toolWithoutLabel: RegisteredTool = {
			definition: {
				name: "noLabel",
				description: "Tool without optional label",
				parameters: {},
				execute: async () => ({}),
			},
		};

		expect(toolWithoutLabel.definition.label).toBeUndefined();
	});
});

describe("边界情况", () => {
	it("应该处理带复杂参数的工具", () => {
		const complexTool: RegisteredTool = {
			definition: {
				name: "complexTool",
				description: "Tool with complex parameters",
				parameters: {
					type: "object",
					properties: {
						nested: {
							type: "object",
							properties: {
								deep: { type: "string" },
							},
						},
						array: {
							type: "array",
							items: { type: "string" },
						},
					},
				},
				execute: vi.fn(),
			},
		};

		const runner = createMockRunner();
		const wrapped = wrapRegisteredTool(complexTool, runner);

		expect(wrapped.parameters).toBeDefined();
		expect(typeof wrapped.parameters).toBe("object");
	});

	it("应该处理异步 execute 函数", async () => {
		const asyncTool: RegisteredTool = {
			definition: {
				name: "asyncTool",
				description: "Async tool",
				parameters: {},
				execute: async () => {
					await new Promise((resolve) => setTimeout(resolve, 10));
					return { asyncResult: true };
				},
			},
		};

		const runner = createMockRunner();
		const wrapped = wrapRegisteredTool(asyncTool, runner);

		const result = await wrapped.execute("call", {}, undefined, undefined);

		expect(result).toEqual({ asyncResult: true });
	});

	it("应该处理 execute 抛出错误", async () => {
		const errorTool: RegisteredTool = {
			definition: {
				name: "errorTool",
				description: "Tool that throws",
				parameters: {},
				execute: async () => {
					throw new Error("Tool execution failed");
				},
			},
		};

		const runner = createMockRunner();
		const wrapped = wrapRegisteredTool(errorTool, runner);

		await expect(
			wrapped.execute("call", {}, undefined, undefined),
		).rejects.toThrow("Tool execution failed");
	});

	it("应该处理特殊字符的工具名称", () => {
		const specialNameTool: RegisteredTool = {
			definition: {
				name: "tool-with-special_chars.123",
				description: "Tool with special characters",
				parameters: {},
				execute: vi.fn(),
			},
		};

		const runner = createMockRunner();
		const wrapped = wrapRegisteredTool(specialNameTool, runner);

		expect(wrapped.name).toBe("tool-with-special_chars.123");
	});
});

describe("与 Pi-Mono 一致性", () => {
	it("应该与 Pi-Mono 的包装行为一致", () => {
		const tool = createMockRegisteredTool("consistencyTool");
		const runner = createMockRunner();

		const wrapped = wrapRegisteredTool(tool, runner);

		// 基本结构
		expect(typeof wrapped.name).toBe("string");
		expect(typeof wrapped.description).toBe("string");
		expect(typeof wrapped.execute).toBe("function");

		// label 默认值处理
		expect(wrapped.label).toBe(tool.definition.label);

		// parameters 传递
		expect(wrapped.parameters).toBe(tool.definition.parameters);
	});
});
