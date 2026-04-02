/**
 * event-bus.ts 测试 - 事件总线
 *
 * 测试覆盖：
 * - createEventBus - 创建事件总线
 * - emit/on - 发布订阅模式
 * - 取消订阅 - 返回的取消函数
 * - clear - 清除所有监听器
 * - 错误处理
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createEventBus, type EventBus, type EventBusController } from "../src/event-bus";

describe("createEventBus - 创建事件总线", () => {
	it("应该创建一个事件总线", () => {
		const bus = createEventBus();

		expect(bus).toBeDefined();
		expect(bus.emit).toBeInstanceOf(Function);
		expect(bus.on).toBeInstanceOf(Function);
		expect(bus.clear).toBeInstanceOf(Function);
	});

	it("应该符合 EventBus 接口", () => {
		const bus: EventBus = createEventBus();

		expect(bus.emit).toBeDefined();
		expect(bus.on).toBeDefined();
	});

	it("应该符合 EventBusController 接口", () => {
		const bus: EventBusController = createEventBus();

		expect(bus.emit).toBeDefined();
		expect(bus.on).toBeDefined();
		expect(bus.clear).toBeDefined();
	});
});

describe("emit/on - 发布订阅模式", () => {
	let bus: EventBusController;

	beforeEach(() => {
		bus = createEventBus();
	});

	it("应该发送事件到监听器", () => {
		const handler = vi.fn();

		bus.on("test", handler);
		bus.emit("test", "data");

		expect(handler).toHaveBeenCalledWith("data");
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it("应该支持多个监听器", () => {
		const handler1 = vi.fn();
		const handler2 = vi.fn();

		bus.on("test", handler1);
		bus.on("test", handler2);
		bus.emit("test", "data");

		expect(handler1).toHaveBeenCalledWith("data");
		expect(handler2).toHaveBeenCalledWith("data");
	});

	it("应该支持多个事件", () => {
		const handler1 = vi.fn();
		const handler2 = vi.fn();

		bus.on("event1", handler1);
		bus.on("event2", handler2);

		bus.emit("event1", "data1");
		bus.emit("event2", "data2");

		expect(handler1).toHaveBeenCalledWith("data1");
		expect(handler2).toHaveBeenCalledWith("data2");
	});

	it("应该支持异步处理器", async () => {
		const handler = vi.fn(async (data: unknown) => {
			await new Promise((resolve) => setTimeout(resolve, 10));
			return (data as string).toUpperCase();
		});

		bus.on("test", handler);
		bus.emit("test", "hello");

		// 等待异步处理
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(handler).toHaveBeenCalledWith("hello");
	});

	it("没有监听器时应该静默处理", () => {
		expect(() => bus.emit("nonexistent", "data")).not.toThrow();
	});

	it("应该传递任意数据类型", () => {
		const handler = vi.fn();

		bus.on("test", handler);

		// 字符串
		bus.emit("test", "string");
		// 数字
		bus.emit("test", 123);
		// 对象
		bus.emit("test", { key: "value" });
		// 数组
		bus.emit("test", [1, 2, 3]);
		// null
		bus.emit("test", null);
		// undefined
		bus.emit("test", undefined);

		expect(handler).toHaveBeenCalledTimes(6);
	});
});

describe("取消订阅", () => {
	let bus: EventBusController;

	beforeEach(() => {
		bus = createEventBus();
	});

	it("on 方法应该返回取消函数", () => {
		const unsubscribe = bus.on("test", () => {});

		expect(unsubscribe).toBeInstanceOf(Function);
	});

	it("调用取消函数应该停止监听", () => {
		const handler = vi.fn();
		const unsubscribe = bus.on("test", handler);

		unsubscribe();
		bus.emit("test", "data");

		expect(handler).not.toHaveBeenCalled();
	});

	it("应该只取消指定的监听器", () => {
		const handler1 = vi.fn();
		const handler2 = vi.fn();

		const unsubscribe1 = bus.on("test", handler1);
		bus.on("test", handler2);

		unsubscribe1();
		bus.emit("test", "data");

		expect(handler1).not.toHaveBeenCalled();
		expect(handler2).toHaveBeenCalledTimes(1);
	});

	it("多次调用取消函数应该是安全的", () => {
		const handler = vi.fn();
		const unsubscribe = bus.on("test", handler);

		unsubscribe();
		unsubscribe();
		unsubscribe();

		bus.emit("test", "data");
		expect(handler).not.toHaveBeenCalled();
	});

	it("应该能取消所有监听器", () => {
		const handler1 = vi.fn();
		const handler2 = vi.fn();
		const handler3 = vi.fn();

		const unsubscribe1 = bus.on("test", handler1);
		const unsubscribe2 = bus.on("test", handler2);
		const unsubscribe3 = bus.on("test", handler3);

		unsubscribe1();
		unsubscribe2();
		unsubscribe3();

		bus.emit("test", "data");

		expect(handler1).not.toHaveBeenCalled();
		expect(handler2).not.toHaveBeenCalled();
		expect(handler3).not.toHaveBeenCalled();
	});
});

describe("clear - 清除所有监听器", () => {
	let bus: EventBusController;

	beforeEach(() => {
		bus = createEventBus();
	});

	it("应该清除所有事件的所有监听器", () => {
		const handler1 = vi.fn();
		const handler2 = vi.fn();
		const handler3 = vi.fn();

		bus.on("event1", handler1);
		bus.on("event2", handler2);
		bus.on("event3", handler3);

		bus.clear();

		bus.emit("event1", "data1");
		bus.emit("event2", "data2");
		bus.emit("event3", "data3");

		expect(handler1).not.toHaveBeenCalled();
		expect(handler2).not.toHaveBeenCalled();
		expect(handler3).not.toHaveBeenCalled();
	});

	it("clear 后应该能添加新监听器", () => {
		const handler1 = vi.fn();
		const handler2 = vi.fn();

		bus.on("test", handler1);
		bus.clear();
		bus.on("test", handler2);

		bus.emit("test", "data");

		expect(handler1).not.toHaveBeenCalled();
		expect(handler2).toHaveBeenCalledTimes(1);
	});

	it("多次调用 clear 应该是安全的", () => {
		const handler = vi.fn();

		bus.on("test", handler);
		bus.clear();
		bus.clear();
		bus.clear();

		bus.emit("test", "data");

		expect(handler).not.toHaveBeenCalled();
	});
});

describe("错误处理", () => {
	let bus: EventBusController;
	let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		bus = createEventBus();
		consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		consoleErrorSpy.mockRestore();
	});

	it("应该捕获处理器中的同步错误", () => {
		const handler = vi.fn(() => {
			throw new Error("Handler error");
		});

		bus.on("test", handler);
		bus.emit("test", "data");

		expect(consoleErrorSpy).toHaveBeenCalledWith(
			"Event handler error (test):",
			expect.any(Error),
		);
	});

	it("应该捕获处理器中的异步错误", async () => {
		const handler = vi.fn(async () => {
			throw new Error("Async handler error");
		});

		bus.on("test", handler);
		bus.emit("test", "data");

		// 等待异步处理
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(consoleErrorSpy).toHaveBeenCalledWith(
			"Event handler error (test):",
			expect.any(Error),
		);
	});

	it("一个处理器出错不应影响其他处理器", () => {
		const handler1 = vi.fn(() => {
			throw new Error("Error 1");
		});
		const handler2 = vi.fn();
		const handler3 = vi.fn();

		bus.on("test", handler1);
		bus.on("test", handler2);
		bus.on("test", handler3);

		bus.emit("test", "data");

		expect(handler1).toHaveBeenCalled();
		expect(handler2).toHaveBeenCalled();
		expect(handler3).toHaveBeenCalled();
	});

	it("错误处理器不应被调用", () => {
		const errorHandler = vi.fn();
		const normalHandler = vi.fn(() => {
			throw new Error("Test error");
		});

		bus.on("test", normalHandler);
		bus.on("error", errorHandler);

		bus.emit("test", "data");

		expect(normalHandler).toHaveBeenCalled();
		expect(errorHandler).not.toHaveBeenCalled();
	});
});

describe("边界情况", () => {
	it("应该处理空事件名", () => {
		const bus = createEventBus();
		const handler = vi.fn();

		bus.on("", handler);
		bus.emit("", "data");

		expect(handler).toHaveBeenCalledWith("data");
	});

	it("应该处理特殊字符事件名", () => {
		const bus = createEventBus();
		const handler = vi.fn();

		bus.on("event:with/special-chars", handler);
		bus.emit("event:with/special-chars", "data");

		expect(handler).toHaveBeenCalledWith("data");
	});

	it("应该处理 undefined 数据", () => {
		const bus = createEventBus();
		const handler = vi.fn();

		bus.on("test", handler);
		bus.emit("test", undefined);

		expect(handler).toHaveBeenCalledWith(undefined);
	});

	it("应该处理 null 数据", () => {
		const bus = createEventBus();
		const handler = vi.fn();

		bus.on("test", handler);
		bus.emit("test", null);

		expect(handler).toHaveBeenCalledWith(null);
	});

	it("应该处理大量监听器", () => {
		const bus = createEventBus();
		const handlers = Array.from({ length: 1000 }, () => vi.fn());

		handlers.forEach((handler) => bus.on("test", handler));
		bus.emit("test", "data");

		handlers.forEach((handler) => {
			expect(handler).toHaveBeenCalledWith("data");
		});
	});

	it("应该处理高频事件", () => {
		const bus = createEventBus();
		const handler = vi.fn();

		bus.on("test", handler);

		// 发送 1000 个事件
		for (let i = 0; i < 1000; i++) {
			bus.emit("test", i);
		}

		expect(handler).toHaveBeenCalledTimes(1000);
	});
});

describe("与 Pi-Mono 一致性", () => {
	it("应该与 Pi-Mono 的 event-bus 功能一致", () => {
		const bus = createEventBus();

		// 基本功能
		expect(typeof bus.emit).toBe("function");
		expect(typeof bus.on).toBe("function");
		expect(typeof bus.clear).toBe("function");

		// on 返回取消函数
		const unsubscribe = bus.on("test", () => {});
		expect(typeof unsubscribe).toBe("function");
	});
});
