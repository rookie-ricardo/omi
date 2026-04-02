/**
 * truncate.ts 测试 - 输出截断工具
 *
 * 测试覆盖：
 * - truncateHead() - 从头部截断
 * - truncateTail() - 从尾部截断
 * - truncateLine() - 单行截断
 * - formatSize() - 格式化字节大小
 * - 边界情况和错误处理
 */

import { describe, it, expect } from "vitest";
import {
	truncateHead,
	truncateTail,
	truncateLine,
	formatSize,
	DEFAULT_MAX_LINES,
	DEFAULT_MAX_BYTES,
	GREP_MAX_LINE_LENGTH,
	type TruncationResult,
} from "../src/truncate";

describe("truncateHead - 从头部截断", () => {
	it("不应该截断小内容", () => {
		const content = "hello\nworld";
		const result = truncateHead(content);

		expect(result.truncated).toBe(false);
		expect(result.truncatedBy).toBeNull();
		expect(result.content).toBe(content);
		expect(result.totalLines).toBe(2);
		expect(result.outputLines).toBe(2);
	});

	it("应该按行数限制截断", () => {
		const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
		const result = truncateHead(lines, { maxLines: 10 });

		expect(result.truncated).toBe(true);
		expect(result.truncatedBy).toBe("lines");
		expect(result.outputLines).toBe(10);
		expect(result.totalLines).toBe(100);
	});

	it("应该按字节数限制截断", () => {
		// 创建一个行数少但字节数多的内容
		const longLine = "a".repeat(60000); // 超过默认 50KB
		const result = truncateHead(longLine, { maxLines: 1000 });

		expect(result.truncated).toBe(true);
		expect(result.truncatedBy).toBe("bytes");
		expect(result.outputBytes).toBeLessThanOrEqual(DEFAULT_MAX_BYTES);
	});

	it("第一行超过字节限制时应返回空内容", () => {
		const content = "x".repeat(60000); // 超过默认 50KB
		const result = truncateHead(content);

		expect(result.truncated).toBe(true);
		expect(result.truncatedBy).toBe("bytes");
		expect(result.content).toBe("");
		expect(result.outputLines).toBe(0);
		expect(result.firstLineExceedsLimit).toBe(true);
	});

	it("应正确返回原始统计信息", () => {
		const content = "a\nb\nc\nd\ne";
		const result = truncateHead(content, { maxLines: 3 });

		expect(result.totalLines).toBe(5);
		expect(result.totalBytes).toBe(Buffer.byteLength(content, "utf-8"));
		expect(result.maxLines).toBe(3);
	});
});

describe("truncateTail - 从尾部截断", () => {
	it("不应该截断小内容", () => {
		const content = "hello\nworld";
		const result = truncateTail(content);

		expect(result.truncated).toBe(false);
		expect(result.truncatedBy).toBeNull();
		expect(result.content).toBe(content);
	});

	it("应该按行数限制从尾部截断", () => {
		const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
		const result = truncateTail(lines, { maxLines: 10 });

		expect(result.truncated).toBe(true);
		expect(result.truncatedBy).toBe("lines");
		expect(result.outputLines).toBe(10);
		// 应该是最后 10 行
		expect(result.content).toContain("line 99");
		expect(result.content).not.toContain("line 0");
	});

	it("应该按字节数限制从尾部截断", () => {
		const longLine = "a".repeat(60000);
		const result = truncateTail(longLine, { maxLines: 1000 });

		expect(result.truncated).toBe(true);
		expect(result.truncatedBy).toBe("bytes");
		expect(result.outputBytes).toBeLessThanOrEqual(DEFAULT_MAX_BYTES);
	});

	it("单行超过字节限制时应返回部分行", () => {
		const content = "prefix\n" + "x".repeat(60000);
		const result = truncateTail(content, { maxLines: 100 });

		expect(result.truncated).toBe(true);
		expect(result.truncatedBy).toBe("bytes");
		expect(result.lastLinePartial).toBe(true);
		// 应该是最后一行的部分内容
		expect(result.content.length).toBeGreaterThan(0);
	});

	it("应正确计算 UTF-8 多字节字符", () => {
		// 测试 emoji 等多字节字符
		const emoji = "😀".repeat(10000); // 每个 emoji 4 字节
		const result = truncateTail(emoji, { maxBytes: 100 });

		expect(result.truncated).toBe(true);
		// 应该不破坏 UTF-8 字符边界
		expect(() => Buffer.from(result.content, "utf-8")).not.toThrow();
	});
});

describe("truncateLine - 单行截断", () => {
	it("不应该截断短行", () => {
		const line = "short line";
		const result = truncateLine(line);

		expect(result.wasTruncated).toBe(false);
		expect(result.text).toBe(line);
	});

	it("应该截断长行并添加标记", () => {
		const longLine = "a".repeat(1000);
		const result = truncateLine(longLine, 100);

		expect(result.wasTruncated).toBe(true);
		expect(result.text.length).toBeLessThan(longLine.length);
		expect(result.text).toContain("... [truncated]");
	});

	it("应使用默认 GREP_MAX_LINE_LENGTH", () => {
		const longLine = "x".repeat(1000);
		const result = truncateLine(longLine);

		expect(result.wasTruncated).toBe(true);
		// 默认 500 + "... [truncated]" 长度
		expect(result.text.length).toBe(500 + "... [truncated]".length);
	});

	it("截断后的文本长度应正确", () => {
		const longLine = "a".repeat(600);
		const maxChars = 200;
		const result = truncateLine(longLine, maxChars);

		expect(result.text).toBe("a".repeat(200) + "... [truncated]");
		expect(result.text.length).toBe(maxChars + "... [truncated]".length);
	});
});

describe("formatSize - 格式化字节大小", () => {
	it("应正确格式化字节", () => {
		expect(formatSize(0)).toBe("0B");
		expect(formatSize(512)).toBe("512B");
		expect(formatSize(1023)).toBe("1023B");
	});

	it("应正确格式化 KB", () => {
		expect(formatSize(1024)).toBe("1.0KB");
		expect(formatSize(1536)).toBe("1.5KB");
		expect(formatSize(10240)).toBe("10.0KB");
	});

	it("应正确格式化 MB", () => {
		expect(formatSize(1024 * 1024)).toBe("1.0MB");
		expect(formatSize(2.5 * 1024 * 1024)).toBe("2.5MB");
	});

	it("应正确格式化 50KB", () => {
		expect(formatSize(DEFAULT_MAX_BYTES)).toBe("50.0KB");
	});
});

describe("边界情况", () => {
	it("空字符串处理", () => {
		const result = truncateHead("");
		expect(result.content).toBe("");
		expect(result.truncated).toBe(false);
		expect(result.totalLines).toBe(1);
	});

	it("单行无换行符", () => {
		const content = "single line without newline";
		const result = truncateHead(content);
		expect(result.content).toBe(content);
		expect(result.totalLines).toBe(1);
	});

	it("仅换行符的内容", () => {
		const content = "\n\n\n";
		const result = truncateHead(content);
		expect(result.totalLines).toBe(4);
	});

	it("连续换行符", () => {
		const content = "a\n\n\nb";
		const result = truncateHead(content, { maxLines: 3 });
		expect(result.outputLines).toBe(3);
	});

	it("最后一个字符是换行符", () => {
		const content = "line1\nline2\n";
		const result = truncateHead(content);
		// split("\n") 会产生 3 个元素: ["line1", "line2", ""]
		expect(result.totalLines).toBe(3);
	});
});

describe("UTF-8 多字节字符处理", () => {
	it("应正确处理中文", () => {
		const content = "你好世界\n".repeat(100);
		const result = truncateHead(content, { maxLines: 10 });
		expect(result.outputLines).toBe(10);
	});

	it("应正确处理 emoji", () => {
		const content = "😀😁😂".repeat(100);
		const result = truncateHead(content, { maxBytes: 100 });
		// 应该不破坏 UTF-8 编码
		expect(() => Buffer.from(result.content, "utf-8")).not.toThrow();
	});

	it("混合 ASCII 和多字节字符", () => {
		const content = "abc你好😀\n".repeat(50);
		const result = truncateHead(content, { maxLines: 10 });
		expect(result.outputLines).toBe(10);
	});
});
