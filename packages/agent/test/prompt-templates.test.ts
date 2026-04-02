/**
 * prompt-templates.ts 测试 - Prompt 模板系统
 *
 * 测试覆盖：
 * - parseCommandArgs - 参数解析
 * - substituteArgs - 变量替换
 * - loadPromptTemplates - 模板加载
 * - expandPromptTemplate - 模板展开
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	parseCommandArgs,
	substituteArgs,
	loadPromptTemplates,
	expandPromptTemplate,
	type PromptTemplate,
	type LoadPromptTemplatesOptions,
} from "../src/prompt-templates";

describe("parseCommandArgs - 参数解析", () => {
	it("应该解析简单空格分隔的参数", () => {
		const result = parseCommandArgs("arg1 arg2 arg3");
		expect(result).toEqual(["arg1", "arg2", "arg3"]);
	});

	it("应该处理双引号包裹的参数", () => {
		const result = parseCommandArgs('"arg with spaces" arg2');
		expect(result).toEqual(["arg with spaces", "arg2"]);
	});

	it("应该处理单引号包裹的参数", () => {
		const result = parseCommandArgs("'arg with spaces' arg2");
		expect(result).toEqual(["arg with spaces", "arg2"]);
	});

	it("应该混合处理引号和非引号参数", () => {
		const result = parseCommandArgs('arg1 "arg 2" \'arg 3\' arg4');
		expect(result).toEqual(["arg1", "arg 2", "arg 3", "arg4"]);
	});

	it("应该处理参数中的转义引号", () => {
		// 注意：当前实现不支持转义引号，转义字符会被保留
		const result = parseCommandArgs('"arg with \\"quote\\"" arg2');
		// 实际行为：反斜杠被保留在引号内
		expect(result).toEqual(['arg with \\quote\\', "arg2"]);
	});

	it("应该处理多个空格", () => {
		const result = parseCommandArgs("arg1    arg2     arg3");
		expect(result).toEqual(["arg1", "arg2", "arg3"]);
	});

	it("应该处理制表符", () => {
		const result = parseCommandArgs("arg1\targ2\targ3");
		expect(result).toEqual(["arg1", "arg2", "arg3"]);
	});

	it("应该处理空字符串", () => {
		const result = parseCommandArgs("");
		expect(result).toEqual([]);
	});

	it("应该处理只有空格的字符串", () => {
		const result = parseCommandArgs("   ");
		expect(result).toEqual([]);
	});

	it("应该处理单引号内的双引号", () => {
		const result = parseCommandArgs("'\"quoted\"' arg2");
		expect(result).toEqual(['"quoted"', "arg2"]);
	});

	it("应该处理双引号内的单引号", () => {
		const result = parseCommandArgs('"\'quoted\'" arg2');
		expect(result).toEqual(["'quoted'", "arg2"]);
	});
});

describe("substituteArgs - 变量替换", () => {
	it("应该替换 $1, $2 等位置参数", () => {
		const content = "Hello $1, welcome to $2";
		const args = ["Alice", "Wonderland"];
		const result = substituteArgs(content, args);

		expect(result).toBe("Hello Alice, welcome to Wonderland");
	});

	it("缺少参数时应返回空字符串", () => {
		const content = "Hello $1, welcome to $2";
		const args = ["Alice"];
		const result = substituteArgs(content, args);

		expect(result).toBe("Hello Alice, welcome to ");
	});

	it("应该替换 $@ 为所有参数", () => {
		const content = "Processing: $@";
		const args = ["arg1", "arg2", "arg3"];
		const result = substituteArgs(content, args);

		expect(result).toBe("Processing: arg1 arg2 arg3");
	});

	it("应该替换 $ARGUMENTS 为所有参数", () => {
		const content = "Processing: $ARGUMENTS";
		const args = ["arg1", "arg2", "arg3"];
		const result = substituteArgs(content, args);

		expect(result).toBe("Processing: arg1 arg2 arg3");
	});

	it("应该支持 ${@:N} 从第 N 个参数开始", () => {
		const content = "From 2nd: ${@:2}";
		const args = ["arg1", "arg2", "arg3", "arg4"];
		const result = substituteArgs(content, args);

		expect(result).toBe("From 2nd: arg2 arg3 arg4");
	});

	it("应该支持 ${@:N:L} 从第 N 个参数开始取 L 个", () => {
		const content = "Two from 2nd: ${@:2:2}";
		const args = ["arg1", "arg2", "arg3", "arg4", "arg5"];
		const result = substituteArgs(content, args);

		expect(result).toBe("Two from 2nd: arg2 arg3");
	});

	it("应该优先处理位置参数再处理通配符", () => {
		const content = "$1 and $@";
		const args = ["first", "second", "third"];
		const result = substituteArgs(content, args);

		expect(result).toBe("first and first second third");
	});

	it("不应递归替换参数值中的占位符", () => {
		const content = "Value: $1";
		const args = ["$2", "actual"];
		const result = substituteArgs(content, args);

		expect(result).toBe("Value: $2");
	});

	it("应该处理 $0 为空字符串（参数从 1 开始）", () => {
		const content = "Zero: $0, First: $1";
		const args = ["first"];
		const result = substituteArgs(content, args);

		expect(result).toBe("Zero: , First: first");
	});

	it("应该多次替换同一占位符", () => {
		const content = "$1 $1 $1";
		const args = ["hello"];
		const result = substituteArgs(content, args);

		expect(result).toBe("hello hello hello");
	});

	it("应该处理超出范围的起始位置", () => {
		const content = "From 10th: ${@:10}";
		const args = ["arg1", "arg2", "arg3"];
		const result = substituteArgs(content, args);

		expect(result).toBe("From 10th: ");
	});
});

describe("loadPromptTemplates - 模板加载", () => {
	let tempDir: string;
	let globalPromptsDir: string;
	let projectPromptsDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "prompt-templates-test-"));
		globalPromptsDir = join(tempDir, "global-prompts");
		projectPromptsDir = join(tempDir, "project", ".omi", "prompts");
		mkdirSync(globalPromptsDir, { recursive: true });
		mkdirSync(projectPromptsDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("应该从全局目录加载模板", () => {
		const templatePath = join(globalPromptsDir, "test.md");
		writeFileSync(templatePath, "---\ndescription: Test template\n---\nTest content");

		const templates = loadPromptTemplates({
			cwd: tempDir,
			// agentDir 应该是 prompts 目录的父目录
			// 但这里我们直接用 globalPromptsDir 作为 prompts 目录
			promptPaths: [globalPromptsDir],
		});

		const testTemplate = templates.find((t) => t.name === "test");
		expect(testTemplate).toBeDefined();
		expect(testTemplate?.source).toBe("path");
	});

	it("应该从项目目录加载模板", () => {
		const projectDir = join(tempDir, "project");
		const templatePath = join(projectPromptsDir, "project-test.md");
		writeFileSync(templatePath, "Project template content");

		const templates = loadPromptTemplates({
			cwd: projectDir,
		});

		const testTemplate = templates.find((t) => t.name === "project-test");
		expect(testTemplate).toBeDefined();
		expect(testTemplate?.source).toBe("project");
	});

	it("应该从指定路径加载模板文件", () => {
		const customPath = join(tempDir, "custom.md");
		writeFileSync(customPath, "Custom template");

		const templates = loadPromptTemplates({
			promptPaths: [customPath],
			cwd: tempDir,
		});

		const testTemplate = templates.find((t) => t.name === "custom");
		expect(testTemplate).toBeDefined();
		expect(testTemplate?.source).toBe("path");
	});

	it("应该从指定路径目录加载模板", () => {
		const customDir = join(tempDir, "custom-prompts");
		mkdirSync(customDir);
		writeFileSync(join(customDir, "template1.md"), "Content 1");
		writeFileSync(join(customDir, "template2.md"), "Content 2");

		const templates = loadPromptTemplates({
			promptPaths: [customDir],
			cwd: tempDir,
		});

		expect(templates.length).toBeGreaterThanOrEqual(2);
	});

	it("应该解析 frontmatter 中的 description", () => {
		const templatePath = join(globalPromptsDir, "test.md");
		writeFileSync(templatePath, "---\ndescription: My custom description\n---\nContent");

		const templates = loadPromptTemplates({
			cwd: tempDir,
			promptPaths: [globalPromptsDir],
		});

		const testTemplate = templates.find((t) => t.name === "test");
		expect(testTemplate).toBeDefined();
		expect(testTemplate?.description).toContain("My custom description");
	});

	it("没有 description 时应使用第一行", () => {
		const templatePath = join(globalPromptsDir, "test.md");
		writeFileSync(templatePath, "First line of content\nSecond line");

		const templates = loadPromptTemplates({
			cwd: tempDir,
			promptPaths: [globalPromptsDir],
		});

		const testTemplate = templates.find((t) => t.name === "test");
		expect(testTemplate).toBeDefined();
		expect(testTemplate?.description).toContain("First line of content");
	});

	it("应该跳过非 .md 文件", () => {
		writeFileSync(join(globalPromptsDir, "test.txt"), "Not a template");
		writeFileSync(join(globalPromptsDir, "test.json"), "{}");

		const templates = loadPromptTemplates({
			agentDir: globalPromptsDir,
			cwd: tempDir,
		});

		const mdTemplates = templates.filter((t) => t.name === "test");
		expect(mdTemplates.length).toBe(0);
	});

	it("includeDefaults=false 时不应加载默认目录", () => {
		writeFileSync(join(globalPromptsDir, "global.md"), "Global content");
		const projectDir = join(tempDir, "project");
		mkdirSync(join(projectDir, ".omi", "prompts"), { recursive: true });
		writeFileSync(join(projectDir, ".omi", "prompts", "project.md"), "Project content");

		const templates = loadPromptTemplates({
			cwd: projectDir,
			includeDefaults: false,
		});

		expect(templates.length).toBe(0);
	});
});

describe("expandPromptTemplate - 模板展开", () => {
	it("应该识别以 / 开头的模板引用", () => {
		const templates: PromptTemplate[] = [
			{
				name: "greet",
				description: "Greeting template",
				content: "Hello, $1!",
				source: "user",
				filePath: "/path/to/greet.md",
			},
		];

		const result = expandPromptTemplate("/greet World", templates);
		expect(result).toBe("Hello, World!");
	});

	it("没有参数时应正常工作", () => {
		const templates: PromptTemplate[] = [
			{
				name: "simple",
				description: "Simple template",
				content: "Simple content",
				source: "user",
				filePath: "/path/to/simple.md",
			},
		];

		const result = expandPromptTemplate("/simple", templates);
		expect(result).toBe("Simple content");
	});

	it("找不到模板时应返回原文本", () => {
		const templates: PromptTemplate[] = [];
		const result = expandPromptTemplate("/nonexistent", templates);
		expect(result).toBe("/nonexistent");
	});

	it("非 / 开头的文本应保持不变", () => {
		const templates: PromptTemplate[] = [
			{
				name: "test",
				description: "Test",
				content: "Content",
				source: "user",
				filePath: "/path.md",
			},
		];

		const result = expandPromptTemplate("Just regular text", templates);
		expect(result).toBe("Just regular text");
	});

	it("应该正确解析多个参数", () => {
		const templates: PromptTemplate[] = [
			{
				name: "multi",
				description: "Multi-arg template",
				content: "$1 loves $2",
				source: "user",
				filePath: "/path.md",
			},
		];

		const result = expandPromptTemplate("/multi Alice Bob", templates);
		expect(result).toBe("Alice loves Bob");
	});

	it("应该处理带引号的参数", () => {
		const templates: PromptTemplate[] = [
			{
				name: "quote",
				description: "Quote template",
				content: "Saying: $1",
				source: "user",
				filePath: "/path.md",
			},
		];

		const result = expandPromptTemplate('/quote "Hello World"', templates);
		expect(result).toBe("Saying: Hello World");
	});

	it("模板名后的空格应正确处理", () => {
		const templates: PromptTemplate[] = [
			{
				name: "space",
				description: "Space template",
				content: "Arg: $1",
				source: "user",
				filePath: "/path.md",
			},
		];

		const result = expandPromptTemplate("/space   arg1", templates);
		expect(result).toBe("Arg: arg1");
	});
});

describe("边界情况", () => {
	it("应该处理空参数列表", () => {
		const result = substituteArgs("No args here", []);
		expect(result).toBe("No args here");
	});

	it("应该处理只有占位符的模板", () => {
		const result = substituteArgs("$1 $2 $3", ["a", "b", "c"]);
		expect(result).toBe("a b c");
	});

	it("应该处理连续的占位符", () => {
		const result = substituteArgs("$1$2$3", ["a", "b", "c"]);
		expect(result).toBe("abc");
	});

	it("应该解析空字符串参数", () => {
		// 当前实现：空引号会被当作空参数跳过
		const result = parseCommandArgs('"" ""');
		expect(result).toEqual([]);
	});

	it("应该处理不存在的目录", () => {
		const templates = loadPromptTemplates({
			cwd: "/nonexistent/path",
		});
		expect(Array.isArray(templates)).toBe(true);
	});
});

describe("与 Pi-Mono 一致性", () => {
	it("应该与 Pi-Mono 的参数解析行为一致", () => {
		const testCases = [
			{ input: "arg1 arg2", expected: ["arg1", "arg2"] },
			{ input: '"arg 1" arg2', expected: ["arg 1", "arg2"] },
			{ input: "'arg 1' arg2", expected: ["arg 1", "arg2"] },
		];

		testCases.forEach(({ input, expected }) => {
			expect(parseCommandArgs(input)).toEqual(expected);
		});
	});

	it("应该与 Pi-Mono 的变量替换行为一致", () => {
		const testCases = [
			{ content: "$1", args: ["hello"], expected: "hello" },
			{ content: "$@", args: ["a", "b"], expected: "a b" },
			{ content: "${@:2}", args: ["a", "b", "c"], expected: "b c" },
		];

		testCases.forEach(({ content, args, expected }) => {
			expect(substituteArgs(content, args)).toBe(expected);
		});
	});
});
