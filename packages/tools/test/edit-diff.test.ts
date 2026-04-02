/**
 * edit-diff.ts 测试 - 编辑 Diff 工具
 *
 * 测试覆盖：
 * - fuzzyFindText - 模糊匹配
 * - normalizeForFuzzyMatch - Unicode 规范化
 * - detectLineEnding - 行尾检测
 * - generateDiffString - Diff 生成
 * - computeEditDiff - 完整编辑 diff 计算
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	fuzzyFindText,
	normalizeForFuzzyMatch,
	detectLineEnding,
	normalizeToLF,
	restoreLineEndings,
	stripBom,
	generateDiffString,
	computeEditDiff,
	type FuzzyMatchResult,
} from "../src/edit-diff";

describe("normalizeForFuzzyMatch - Unicode 规范化", () => {
	it("应该移除每行尾部的空白", () => {
		const input = "line1   \nline2\t\nline3";
		const result = normalizeForFuzzyMatch(input);
		expect(result).toBe("line1\nline2\nline3");
	});

	it("应该将弯引号规范化为直引号", () => {
		const input = "Hello\u2019world\u201Ctest\u201D";
		const result = normalizeForFuzzyMatch(input);
		expect(result).toBe("Hello'world\"test\"");
	});

	it("应该将 Unicode 破折号规范化为连字符", () => {
		const input = "test\u2014em\u2013en";
		const result = normalizeForFuzzyMatch(input);
		expect(result).toBe("test-em-en");
	});

	it("应该将 Unicode 空格规范化为普通空格", () => {
		const input = "test\u00A0space\u2002here";
		const result = normalizeForFuzzyMatch(input);
		expect(result).toBe("test space here");
	});

	it("应该执行 NFKC 规范化", () => {
		// 全角字符转半角
		const input = "Ｔｅｓｔ";
		const result = normalizeForFuzzyMatch(input);
		expect(result).toBe("Test");
	});

	it("空字符串应保持空", () => {
		const result = normalizeForFuzzyMatch("");
		expect(result).toBe("");
	});
});

describe("fuzzyFindText - 模糊匹配", () => {
	it("应该找到精确匹配", () => {
		const content = "hello world\nfoo bar";
		const oldText = "hello world\n";
		const result = fuzzyFindText(content, oldText);

		expect(result.found).toBe(true);
		expect(result.usedFuzzyMatch).toBe(false);
		expect(result.index).toBe(0);
		expect(result.contentForReplacement).toBe(content);
	});

	it("应该使用模糊匹配处理尾随空格差异", () => {
		const content = "hello world   \nfoo bar";
		const oldText = "hello world\n";
		const result = fuzzyFindText(content, oldText);

		expect(result.found).toBe(true);
		expect(result.usedFuzzyMatch).toBe(true);
		expect(result.index).toBe(0);
	});

	it("应该使用模糊匹配处理弯引号差异", () => {
		const content = "It\u2019s a test";
		const oldText = "It's a test";
		const result = fuzzyFindText(content, oldText);

		expect(result.found).toBe(true);
		expect(result.usedFuzzyMatch).toBe(true);
	});

	it("应该使用模糊匹配处理破折号差异", () => {
		const content = "page\u20141\u20135";
		const oldText = "page-1-5";
		const result = fuzzyFindText(content, oldText);

		expect(result.found).toBe(true);
		expect(result.usedFuzzyMatch).toBe(true);
	});

	it("找不到时应返回 not found", () => {
		const content = "hello world";
		const oldText = "goodbye";
		const result = fuzzyFindText(content, oldText);

		expect(result.found).toBe(false);
		expect(result.index).toBe(-1);
		expect(result.matchLength).toBe(0);
	});

	it("应返回正确的匹配长度", () => {
		const content = "hello world test";
		const oldText = "world";
		const result = fuzzyFindText(content, oldText);

		expect(result.found).toBe(true);
		expect(result.matchLength).toBe(5);
	});

	it("应返回用于替换的内容", () => {
		const content = "hello   \nworld";
		const oldText = "hello\n";
		const result = fuzzyFindText(content, oldText);

		expect(result.contentForReplacement).toBe("hello\nworld");
	});
});

describe("detectLineEnding - 行尾检测", () => {
	it("应该检测 CRLF 行尾", () => {
		const content = "line1\r\nline2\r\n";
		const result = detectLineEnding(content);
		expect(result).toBe("\r\n");
	});

	it("应该检测 LF 行尾", () => {
		const content = "line1\nline2\n";
		const result = detectLineEnding(content);
		expect(result).toBe("\n");
	});

	it("当 CRLF 先出现时应检测 CRLF", () => {
		const content = "line1\r\nline2\n";
		const result = detectLineEnding(content);
		expect(result).toBe("\r\n");
	});

	it("当 LF 先出现时应检测 LF", () => {
		const content = "line1\nline2\r\n";
		const result = detectLineEnding(content);
		expect(result).toBe("\n");
	});

	it("无换行符时应默认 LF", () => {
		const content = "single line";
		const result = detectLineEnding(content);
		expect(result).toBe("\n");
	});

	it("空字符串应默认 LF", () => {
		const result = detectLineEnding("");
		expect(result).toBe("\n");
	});
});

describe("normalizeToLF 和 restoreLineEndings - 行尾转换", () => {
	it("应该将 CRLF 转换为 LF", () => {
		const content = "line1\r\nline2\r\n";
		const result = normalizeToLF(content);
		expect(result).toBe("line1\nline2\n");
	});

	it("应该将 CR 转换为 LF", () => {
		const content = "line1\rline2\r";
		const result = normalizeToLF(content);
		expect(result).toBe("line1\nline2\n");
	});

	it("应该将 LF 转换为 CRLF", () => {
		const content = "line1\nline2\n";
		const result = restoreLineEndings(content, "\r\n");
		expect(result).toBe("line1\r\nline2\r\n");
	});

	it("CRLF 内容应保持 CRLF", () => {
		const content = "line1\nline2\n";
		const result = restoreLineEndings(content, "\n");
		expect(result).toBe("line1\nline2\n");
	});
});

describe("stripBom - BOM 处理", () => {
	it("应该移除 UTF-8 BOM", () => {
		const content = "\uFEFFhello world";
		const result = stripBom(content);
		expect(result.bom).toBe("\uFEFF");
		expect(result.text).toBe("hello world");
	});

	it("无 BOM 时应保持不变", () => {
		const content = "hello world";
		const result = stripBom(content);
		expect(result.bom).toBe("");
		expect(result.text).toBe("hello world");
	});

	it("仅 BOM 应返回空文本", () => {
		const content = "\uFEFF";
		const result = stripBom(content);
		expect(result.bom).toBe("\uFEFF");
		expect(result.text).toBe("");
	});
});

describe("generateDiffString - Diff 生成", () => {
	it("应该生成单行修改的 diff", () => {
		const oldContent = "line1\nline2\nline3";
		const newContent = "line1\nmodified\nline3";
		const result = generateDiffString(oldContent, newContent);

		expect(result.diff).toContain("-2 line2");
		expect(result.diff).toContain("+2 modified");
		expect(result.firstChangedLine).toBe(2);
	});

	it("应该生成添加行的 diff", () => {
		const oldContent = "line1\nline3";
		const newContent = "line1\nline2\nline3";
		const result = generateDiffString(oldContent, newContent);

		expect(result.diff).toContain("+2 line2");
		expect(result.firstChangedLine).toBe(2);
	});

	it("应该生成删除行的 diff", () => {
		const oldContent = "line1\nline2\nline3";
		const newContent = "line1\nline3";
		const result = generateDiffString(oldContent, newContent);

		expect(result.diff).toContain("-2 line2");
		expect(result.firstChangedLine).toBe(2);
	});

	it("应该显示上下文行", () => {
		const oldContent = "line1\nline2\nline3\nline4\nline5";
		const newContent = "line1\nline2\nmodified\nline4\nline5";
		const result = generateDiffString(oldContent, newContent, 2);

		// 应该包含上下文行
		expect(result.diff).toContain("line1");
		expect(result.diff).toContain("line2");
	});

	it("相同内容应返回空 diff", () => {
		const content = "line1\nline2\nline3";
		const result = generateDiffString(content, content);

		expect(result.diff).toBe("");
		expect(result.firstChangedLine).toBeUndefined();
	});

	it("应该处理大文件 diff", () => {
		const oldLines = Array.from({ length: 100 }, (_, i) => `line ${i}`);
		const newLines = [...oldLines];
		newLines[50] = "modified line 50";

		const result = generateDiffString(oldLines.join("\n"), newLines.join("\n"));

		// 由于上下文限制，大文件 diff 会显示省略号
		expect(result.diff).toContain("...");
		expect(result.diff).toContain("- 51 line 50");
		expect(result.diff).toContain("+ 51 modified line 50");
		expect(result.firstChangedLine).toBe(51); // 行号从 1 开始，index 50 是第 51 行
	});
});

describe("computeEditDiff - 完整编辑 diff 计算（需要文件系统）", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "edit-diff-test-"));
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("应该计算简单替换的 diff", async () => {
		const content = "line1\nline2\nline3";
		const testFile = join(tempDir, "test.txt");
		writeFileSync(testFile, content);

		const result = await computeEditDiff(testFile, "line2", "modified", tempDir);

		expect("error" in result ? result.error : undefined).toBeUndefined();
		if (!("error" in result)) {
			expect(result.diff).toContain("-2 line2");
			expect(result.diff).toContain("+2 modified");
		}
	});

	it("应该使用模糊匹配处理尾随空格", async () => {
		const content = "hello   \nworld";
		const testFile = join(tempDir, "test.txt");
		writeFileSync(testFile, content);

		const result = await computeEditDiff(testFile, "hello", "hi", tempDir);

		expect("error" in result ? result.error : undefined).toBeUndefined();
		if (!("error" in result)) {
			expect(result.diff).toContain("hi");
		}
	});

	it("找不到文本时应返回错误", async () => {
		const content = "hello world";
		const testFile = join(tempDir, "test.txt");
		writeFileSync(testFile, content);

		const result = await computeEditDiff(testFile, "goodbye", "new", tempDir);

		expect("error" in result && result.error).toContain("Could not find");
	});

	it("多次出现时应返回错误", async () => {
		const content = "hello\nhello\nworld";
		const testFile = join(tempDir, "test.txt");
		writeFileSync(testFile, content);

		const result = await computeEditDiff(testFile, "hello", "hi", tempDir);

		expect("error" in result && result.error).toContain("2 occurrences");
	});

	it("无变化时应返回错误", async () => {
		const content = "hello world";
		const testFile = join(tempDir, "test.txt");
		writeFileSync(testFile, content);

		const result = await computeEditDiff(testFile, "hello world", "hello world", tempDir);

		expect("error" in result && result.error).toContain("No changes");
	});

	it("文件不存在时应返回错误", async () => {
		const result = await computeEditDiff("nonexistent.txt", "old", "new", tempDir);

		expect("error" in result && result.error).toContain("File not found");
	});

	it("应该处理带 BOM 的文件", async () => {
		const content = "\uFEFFhello\nworld";
		const testFile = join(tempDir, "test.txt");
		writeFileSync(testFile, content);

		const result = await computeEditDiff(testFile, "hello", "hi", tempDir);

		expect("error" in result ? result.error : undefined).toBeUndefined();
		if (!("error" in result)) {
			expect(result.diff).toContain("hi");
		}
	});
});

describe("边界情况", () => {
	it("空字符串模糊匹配", () => {
		const result = fuzzyFindText("", "");
		expect(result.found).toBe(true);
	});

	it("空内容检测行尾", () => {
		const result = detectLineEnding("");
		expect(result).toBe("\n");
	});

	it("空内容生成 diff", () => {
		const result = generateDiffString("", "");
		expect(result.diff).toBe("");
	});

	it("多字节字符模糊匹配", () => {
		const content = "你好世界\n测试";
		const oldText = "你好世界\n";
		const result = fuzzyFindText(content, oldText);

		expect(result.found).toBe(true);
	});

	it("Emoji 字符规范化", () => {
		const input = "test 😀 😀";
		const result = normalizeForFuzzyMatch(input);
		// NFKC 可能会规范化某些 emoji
		expect(result.length).toBeGreaterThan(0);
	});
});
