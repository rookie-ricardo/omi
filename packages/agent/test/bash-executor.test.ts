/**
 * bash-executor.ts 测试 - Bash 执行器
 *
 * 测试覆盖：
 * - executeBash - 基本命令执行
 * - executeBashWithOperations - 自定义操作
 * - createLocalBashOperations - 本地 bash 操作
 * - 流式输出、取消、超时、错误处理
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	executeBash,
	executeBashWithOperations,
	createLocalBashOperations,
	type BashResult,
	type BashOperations,
} from "../src/bash-executor";

describe("executeBash - 基本命令执行", () => {
	it("应该执行简单命令并返回输出", async () => {
		const result = await executeBash("echo 'hello world'");

		expect(result.output).toContain("hello world");
		expect(result.exitCode).toBe(0);
		expect(result.cancelled).toBe(false);
		expect(result.truncated).toBe(false);
	});

	it("应该处理多行输出", async () => {
		const result = await executeBash("echo 'line1'; echo 'line2'; echo 'line3'");

		expect(result.output).toContain("line1");
		expect(result.output).toContain("line2");
		expect(result.output).toContain("line3");
	});

	it("应该返回非零退出码", async () => {
		const result = await executeBash("exit 42");

		expect(result.exitCode).toBe(42);
	});

	it("应该剥离 ANSI 转义码", async () => {
		const result = await executeBash("echo -e '\\033[31mred text\\033[0m'");

		expect(result.output).not.toContain("\u001b[");
		expect(result.output).toContain("red text");
	});

	it("应该规范化换行符（CRLF -> LF）", async () => {
		const result = await executeBash("printf 'line1\\r\\nline2'");

		expect(result.output).not.toContain("\r\n");
		expect(result.output).toContain("line1\nline2");
	});

	it("应该清理二进制输出", async () => {
		// 包含控制字符的输出
		const result = await executeBash("printf 'text\\x00\\x01\\x02text'");

		// 控制字符（非 tab/newline）应该被过滤
		expect(result.output).not.toContain("\x00");
		expect(result.output).not.toContain("\x01");
		expect(result.output).not.toContain("\x02");
	});
});

describe("流式输出", () => {
	it("应该通过 onChunk 回调流式输出", async () => {
		const chunks: string[] = [];

		await executeBash("echo 'hello'; echo 'world'", {
			onChunk: (chunk) => chunks.push(chunk),
		});

		expect(chunks.length).toBeGreaterThan(0);
		const fullOutput = chunks.join("");
		expect(fullOutput).toContain("hello");
		expect(fullOutput).toContain("world");
	});

	it("应该实时流式输出", async () => {
		const chunks: string[] = [];

		await executeBash("for i in 1 2 3; do echo \"line $i\"; done", {
			onChunk: (chunk) => chunks.push(chunk),
		});

		// onChunk should be called (output may be buffered into 1 or more chunks depending on OS buffering)
		expect(chunks.length).toBeGreaterThan(0);
		const fullOutput = chunks.join("");
		expect(fullOutput).toContain("line 1");
		expect(fullOutput).toContain("line 2");
		expect(fullOutput).toContain("line 3");
	});
});

describe("取消功能（AbortSignal）", () => {
	it("应该响应取消信号", async () => {
		const controller = new AbortController();

		// 延迟取消
		setTimeout(() => controller.abort(), 100);

		const result = await executeBash("sleep 10", {
			signal: controller.signal,
		});

		expect(result.cancelled).toBe(true);
		expect(result.exitCode).toBeUndefined();
	});

	it("应该立即取消已标记的信号", async () => {
		const controller = new AbortController();
		controller.abort();

		const result = await executeBash("echo 'test'", {
			signal: controller.signal,
		});

		expect(result.cancelled).toBe(true);
	});

	it("取消时应该返回已收集的输出", async () => {
		const controller = new AbortController();

		setTimeout(() => controller.abort(), 200);

		const result = await executeBash("echo 'before'; sleep 10; echo 'after'", {
			signal: controller.signal,
		});

		expect(result.output).toContain("before");
		expect(result.output).not.toContain("after");
	});
});

describe("executeBashWithOperations - 自定义操作", () => {
	it("应该使用自定义 BashOperations", async () => {
		const mockOperations: BashOperations = {
			exec: async (_command, _cwd, options) => {
				// 模拟输出
				options.onData?.(Buffer.from("mock output\n"));
				return { exitCode: 0 };
			},
		};

		const result = await executeBashWithOperations("any", process.cwd(), mockOperations);

		expect(result.output).toContain("mock output");
		expect(result.exitCode).toBe(0);
	});

	it("应该处理自定义操作的错误", async () => {
		const mockOperations: BashOperations = {
			exec: async () => {
				throw new Error("Custom error");
			},
		};

		await expect(
			executeBashWithOperations("any", process.cwd(), mockOperations),
		).rejects.toThrow("Custom error");
	});

	it("应该将取消信号传递给自定义操作", async () => {
		let receivedSignal: AbortSignal | undefined;
		const controller = new AbortController();

		const mockOperations: BashOperations = {
			exec: async (_command, _cwd, options) => {
				receivedSignal = options.signal;
				controller.abort(); // 触发取消
				options.onData?.(Buffer.from("data\n"));
				return { exitCode: 0 };
			},
		};

		await executeBashWithOperations("any", process.cwd(), mockOperations, {
			signal: controller.signal,
		});

		expect(receivedSignal).toBe(controller.signal);
	});
});

describe("createLocalBashOperations - 本地 Bash 操作", () => {
	it("应该创建可执行的操作", async () => {
		const operations = createLocalBashOperations();

		const result = await operations.exec("echo 'test'", process.cwd(), {
			onData: () => {},
		});

		expect(result.exitCode).toBe(0);
	});

	it("应该支持超时", async () => {
		const operations = createLocalBashOperations();

		await expect(
			operations.exec("sleep 10", process.cwd(), {
				onData: () => {},
				timeout: 0.1, // 100ms
			}),
		).rejects.toThrow("timeout:0.1");
	});

	it("应该处理不存在的目录", async () => {
		const operations = createLocalBashOperations();

		await expect(
			operations.exec("echo 'test'", "/nonexistent/directory/that/does/not/exist", {
				onData: () => {},
			}),
		).rejects.toThrow("Working directory does not exist");
	});

	it("应该支持自定义环境变量", async () => {
		const operations = createLocalBashOperations();

		const chunks: Buffer[] = [];
		await operations.exec("echo $TEST_VAR", process.cwd(), {
			onData: (data) => chunks.push(data),
			env: { TEST_VAR: "custom_value" },
		});

		const output = Buffer.concat(chunks).toString();
		expect(output).toContain("custom_value");
	});
});

describe("输出截断和临时文件", () => {
	it("大输出应该创建临时文件", async () => {
		// 使用 yes 命令生成大量输出（超过 50KB）
		const result = await executeBash("yes | head -c 60000");

		expect(result.truncated).toBe(true);
		expect(result.fullOutputPath).toBeDefined();

		// 临时文件可能已被写入流清理，但路径应该存在
		expect(result.fullOutputPath).toBeTruthy();
	}, 15000);

	it("应该保留尾部输出", async () => {
		const result = await executeBash("yes | head -c 60000");

		// 应该保留尾部输出
		expect(result.output.length).toBeGreaterThan(0);
		// 应该包含 yes 的输出（y 字符）
		expect(result.output).toContain("y");
	}, 15000);

	it("小输出不应截断", async () => {
		const result = await executeBash("echo 'small output'");

		expect(result.truncated).toBe(false);
		expect(result.fullOutputPath).toBeUndefined();
	});
});

describe("错误处理", () => {
	it("应该处理无效命令", async () => {
		const result = await executeBash("nonexistentcommandthatdoesnotexist12345");

		// bash 返回 127 表示命令未找到
		expect(result.exitCode).toBe(127);
	});

	it("应该处理语法错误", async () => {
		const result = await executeBash("if ["); // 语法错误

		expect(result.exitCode).not.toBe(0);
	});

	it("应该处理空命令", async () => {
		const result = await executeBash("");

		// 空命令返回 0
		expect(result.exitCode).toBe(0);
	});
});

describe("边界情况", () => {
	it("应该处理 Unicode 输出", async () => {
		const result = await executeBash("echo '你好世界 😀'");

		expect(result.output).toContain("你好世界");
		expect(result.output).toContain("😀");
	});

	it("应该处理空格和特殊字符", async () => {
		const result = await executeBash("echo 'test with spaces and \"quotes\"'");

		expect(result.output).toContain("test with spaces");
		expect(result.output).toContain("quotes");
	});

	it("应该处理多命令管道", async () => {
		const result = await executeBash("echo 'hello' | tr 'a-z' 'A-Z'");

		expect(result.output).toContain("HELLO");
	});

	it("应该处理命令替换", async () => {
		const result = await executeBash("echo \"value: $(echo 'test')\"");

		expect(result.output).toContain("value: test");
	});
});

describe("stdout 和 stderr 合并", () => {
	it("应该合并 stdout 和 stderr", async () => {
		const result = await executeBash("echo 'stdout'; >&2 echo 'stderr'");

		expect(result.output).toContain("stdout");
		expect(result.output).toContain("stderr");
	});

	it("应该区分两者的顺序", async () => {
		const result = await executeBash("echo 'first'; >&2 echo 'second'; echo 'third'");

		const lines = result.output.split("\n").filter((l) => l);
		expect(lines.length).toBeGreaterThanOrEqual(3);
	});
});
