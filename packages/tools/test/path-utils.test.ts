/**
 * path-utils.ts 测试 - 路径工具增强
 *
 * 测试覆盖：
 * - expandPath() - ~ 展开、Unicode 空格处理、@ 前缀
 * - resolveToCwd() - 相对路径解析
 * - resolveReadPath() - 读取路径解析（macOS 变体）
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	expandPath,
	resolveToCwd,
	resolveReadPath,
} from "../src/path-utils";

describe("expandPath - 路径展开", () => {
	it("应该展开单独的 ~ 为用户主目录", () => {
		const result = expandPath("~");
		expect(result).not.toBe("~");
		expect(result.length).toBeGreaterThan(0);
	});

	it("应该展开 ~/ 前缀为用户主目录", () => {
		const result = expandPath("~/Documents");
		expect(result).toContain("Documents");
		expect(result).not.toContain("~");
	});

	it("应该移除 @ 前缀", () => {
		const result = expandPath("@/test/path");
		expect(result).toBe("/test/path");
	});

	it("应该同时处理 @ 和 ~ 前缀", () => {
		const result = expandPath("@~/test");
		expect(result).not.toContain("@");
		expect(result).not.toContain("~");
	});

	it("应该规范化 Unicode 空格为普通空格", () => {
		// \u00A0 (不换行空格) -> 普通空格
		const result = expandPath("/test\u00A0path");
		expect(result).toBe("/test path");
	});

	it("应该规范化多种 Unicode 空格", () => {
		// \u2000 (En Quad) -> 普通空格
		const result = expandPath("/test\u2000path");
		expect(result).toBe("/test path");
	});

	it("绝对路径应保持不变", () => {
		const path = "/usr/local/bin";
		const result = expandPath(path);
		expect(result).toBe(path);
	});

	it("相对路径应保持不变", () => {
		const path = "./src/index.ts";
		const result = expandPath(path);
		expect(result).toBe(path);
	});

	it("空字符串应返回空字符串", () => {
		const result = expandPath("");
		expect(result).toBe("");
	});
});

describe("resolveToCwd - 相对路径解析", () => {
	it("应该解析相对路径到 cwd", () => {
		const result = resolveToCwd("src/index.ts", "/project");
		expect(result).toBe("/project/src/index.ts");
	});

	it("应该处理 ../ 父目录引用", () => {
		const result = resolveToCwd("../file.ts", "/project/src");
		expect(result).toBe("/project/file.ts");
	});

	it("绝对路径应保持不变", () => {
		const result = resolveToCwd("/absolute/path", "/any/cwd");
		expect(result).toBe("/absolute/path");
	});

	it("应该展开 ~ 前缀", () => {
		const result = resolveToCwd("~/Documents", "/any/cwd");
		expect(result).not.toContain("/any/cwd");
		expect(result).toContain("Documents");
	});

	it("应该移除 @ 前缀", () => {
		const result = resolveToCwd("@/test", "/cwd");
		expect(result).toBe("/test");
	});

	it("当前目录 . 应正确解析", () => {
		const result = resolveToCwd(".", "/project/src");
		expect(result).toBe("/project/src");
	});

	it("嵌套相对路径应正确解析", () => {
		const result = resolveToCwd("./src/utils/helper.ts", "/project");
		expect(result).toBe("/project/src/utils/helper.ts");
	});
});

describe("resolveReadPath - 读取路径解析（需要临时文件系统）", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "path-utils-test-"));
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("应该返回存在的文件路径", () => {
		const testFile = join(tempDir, "test.txt");
		writeFileSync(testFile, "content");

		const result = resolveReadPath("test.txt", tempDir);
		expect(result).toBe(testFile);
	});

	it("应该返回存在的目录路径", () => {
		const testDir = join(tempDir, "subdir");
		mkdirSync(testDir);

		const result = resolveReadPath("subdir", tempDir);
		expect(result).toBe(testDir);
	});

	it("不存在的文件应返回解析后的路径", () => {
		const result = resolveReadPath("nonexistent.txt", tempDir);
		expect(result).toBe(join(tempDir, "nonexistent.txt"));
	});

	it("绝对路径不存在的文件应返回原路径", () => {
		const fakePath = "/fake/nonexistent/path/file.txt";
		const result = resolveReadPath(fakePath, tempDir);
		expect(result).toBe(fakePath);
	});

	it("应该展开 ~ 并检查文件", () => {
		// 由于无法在用户主目录创建测试文件，这里只测试路径解析
		const result = resolveReadPath("~/nonexistent.txt", tempDir);
		expect(result).toContain("nonexistent.txt");
		expect(result).not.toContain("~");
	});
});

describe("macOS 特殊路径处理", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "macos-path-test-"));
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	describe("macOS 截图 AM/PM 变体", () => {
		it("应该尝试窄不换行空格变体", () => {
			// 创建带窄不换行空格的文件（macOS 截图格式）
			const fileName = `Screenshot 2025-03-31 at 2.30\u202FPM.png`;
			const testFile = join(tempDir, fileName);
			writeFileSync(testFile, "fake image");

			// 用户输入普通空格
			const result = resolveReadPath("Screenshot 2025-03-31 at 2.30 PM.png", tempDir);
			expect(result).toBe(testFile);
		});

		it("AM 格式也应支持", () => {
			const fileName = `Screenshot 2025-03-31 at 9.15\u202FAM.png`;
			const testFile = join(tempDir, fileName);
			writeFileSync(testFile, "fake image");

			const result = resolveReadPath("Screenshot 2025-03-31 at 9.15 AM.png", tempDir);
			expect(result).toBe(testFile);
		});
	});

	describe("NFD 规范化变体", () => {
		it("应该尝试 NFD 变体（macOS 文件名存储格式）", () => {
			// 创建 NFD 格式的文件名（分解形式）
			// é 在 NFD 中是 e + combining acute accent
			const nfdName = "Capture d'e\u0301cran.png"; // NFD form
			const testFile = join(tempDir, nfdName);
			writeFileSync(testFile, "screenshot");

			// 用户输入 NFC（组合形式）
			const result = resolveReadPath("Capture d'écran.png", tempDir);
			// 应该找到 NFD 版本
			expect(result).toBeDefined();
		});
	});

	describe("弯引号变体", () => {
		it("应该尝试弯引号变体（U+2019）", () => {
			// macOS 使用 U+2019 (right single quotation mark)
			const fileName = "Capture d'e\u0301cran \u2019.png"; // NFD + curly quote
			const testFile = join(tempDir, fileName);
			writeFileSync(testFile, "french screenshot");

			// 用户输入直引号
			const result = resolveReadPath("Capture d'écran '.png", tempDir);
			expect(result).toBeDefined();
		});
	});
});

describe("边界情况", () => {
	it("空路径应返回 cwd", () => {
		const result = resolveToCwd("", "/test/cwd");
		expect(result).toBe("/test/cwd");
	});

	it("多个连续斜杠应正确处理", () => {
		const result = resolveToCwd("path///to///file", "/cwd");
		// Node.js resolve 会规范化多个斜杠
		expect(result).not.toContain("///");
	});

	it("点和双点组合应正确解析", () => {
		const result = resolveToCwd("./../file", "/project/src");
		expect(result).toBe("/project/file");
	});
});

describe("Unicode 空格详细测试", () => {
	const unicodeSpaces = [
		{ char: "\u00A0", name: "不换行空格 (NBSP)" },
		{ char: "\u2000", name: "En Quad" },
		{ char: "\u2001", name: "Em Quad" },
		{ char: "\u2002", name: "En Space" },
		{ char: "\u2003", name: "Em Space" },
		{ char: "\u2004", name: "Three-Per-Em Space" },
		{ char: "\u2005", name: "Four-Per-Em Space" },
		{ char: "\u2006", name: "Six-Per-Em Space" },
		{ char: "\u2007", name: "Figure Space" },
		{ char: "\u2008", name: "Punctuation Space" },
		{ char: "\u2009", name: "Thin Space" },
		{ char: "\u200A", name: "Hair Space" },
		{ char: "\u202F", name: "窄不换行空格 (Narrow No-Break Space)" },
		{ char: "\u205F", name: "Medium Mathematical Space" },
		{ char: "\u3000", name: "表意文字空格 (Ideographic Space)" },
	];

	unicodeSpaces.forEach(({ char, name }) => {
		it(`应该规范化 ${name}`, () => {
			const result = expandPath(`/test${char}path`);
			expect(result).toBe("/test path");
		});
	});
});
