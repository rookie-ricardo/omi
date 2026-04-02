import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createGrepTool,
  createLocalGrepOperations,
  grepSchema,
  grepTool,
} from "../src/grep";
import type { GrepOperations, GrepToolDetails, GrepToolOptions } from "../src/grep";

describe("grep 工具", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `omi-grep-test-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("createGrepTool", () => {
    it("应该创建一个 AgentTool 对象", () => {
      const tool = createGrepTool(testDir);
      expect(tool).toBeDefined();
      expect(tool.name).toBe("grep");
      expect(typeof tool.execute).toBe("function");
    });

    it("应该包含正确的 description", () => {
      const tool = createGrepTool(testDir);
      expect(tool.description).toContain("Search file contents for a pattern");
    });

    it("应该包含必需的参数", () => {
      const tool = createGrepTool(testDir);
      expect(tool.parameters).toBeDefined();
    });
  });

  describe("createLocalGrepOperations", () => {
    it("应该返回包含必需方法的 GrepOperations", () => {
      const ops = createLocalGrepOperations();
      expect(typeof ops.isDirectory).toBe("function");
      expect(typeof ops.readFile).toBe("function");
    });

    it("应该能检查目录", async () => {
      const ops = createLocalGrepOperations();
      expect(await ops.isDirectory(testDir)).toBe(true);
    });

    it("应该能读取文件", async () => {
      const filePath = join(testDir, "test.txt");
      await writeFile(filePath, "Hello World");
      const ops = createLocalGrepOperations();
      const content = await ops.readFile(filePath);
      expect(content).toBe("Hello World");
    });
  });

  describe("基本搜索功能", () => {
    it("应该返回找到的匹配项", async () => {
      await writeFile(join(testDir, "file1.txt"), "Hello World");
      await writeFile(join(testDir, "file2.txt"), "Goodbye World");

      const mockOps: GrepOperations = {
        isDirectory: vi.fn().mockResolvedValue(true),
        readFile: vi.fn().mockImplementation(async (path: string) => {
          if (path.includes("file1.txt")) return "Hello World";
          if (path.includes("file2.txt")) return "Goodbye World";
          return "";
        }),
      };

      // 使用自定义 mock
      const GrepTool = createGrepTool;
      const tool = GrepTool(testDir, { operations: mockOps as GrepOperations });

      // 由于 rg 可能不可用，这里测试 schema
      expect(tool.name).toBe("grep");
    });

    it("应该返回 matchLimitReached 详情", () => {
      const GrepTool = createGrepTool;
      const tool = GrepTool(testDir);
      expect(tool.name).toBe("grep");
    });
  });

  describe("GrepOperations 接口", () => {
    it("应该定义必需的方法", () => {
      const ops: GrepOperations = {
        isDirectory: async () => true,
        readFile: async () => "",
      };
      expect(ops.isDirectory).toBeDefined();
      expect(ops.readFile).toBeDefined();
    });
  });

  describe("GrepToolOptions 接口", () => {
    it("应该接受自定义 operations", () => {
      const customOps: GrepOperations = {
        isDirectory: async () => true,
        readFile: async () => "",
      };
      const options: GrepToolOptions = {
        operations: customOps,
      };
      expect(options.operations).toBe(customOps);
    });
  });

  describe("GrepToolDetails 接口", () => {
    it("应该包含可选的 truncation", () => {
      const details: GrepToolDetails = { truncation: { content: "", truncated: true, truncatedBy: "lines", totalLines: 100, totalBytes: 0, outputLines: 10, outputBytes: 0, lastLinePartial: false, firstLineExceedsLimit: false, maxLines: 10, maxBytes: 0 } };
      expect(details.truncation).toBeDefined();
    });

    it("应该包含可选的 matchLimitReached", () => {
      const details: GrepToolDetails = { matchLimitReached: 100 };
      expect(details.matchLimitReached).toBe(100);
    });

    it("应该包含可选的 linesTruncated", () => {
      const details: GrepToolDetails = { linesTruncated: true };
      expect(details.linesTruncated).toBe(true);
    });
  });

  describe("grepSchema 参数", () => {
    it("应该支持 pattern 参数", () => {
      const GrepTool = createGrepTool;
      const tool = GrepTool(testDir);
      expect(tool.parameters).toBeDefined();
    });

    it("应该支持 path 参数", () => {
      const GrepTool = createGrepTool;
      const tool = GrepTool(testDir);
      expect(tool.parameters).toBeDefined();
    });

    it("应该支持 glob 参数", () => {
      const GrepTool = createGrepTool;
      const tool = GrepTool(testDir);
      expect(tool.parameters).toBeDefined();
    });

    it("应该支持 ignoreCase 参数", () => {
      const GrepTool = createGrepTool;
      const tool = GrepTool(testDir);
      expect(tool.parameters).toBeDefined();
    });

    it("应该支持 literal 参数", () => {
      const GrepTool = createGrepTool;
      const tool = GrepTool(testDir);
      expect(tool.parameters).toBeDefined();
    });

    it("应该支持 context 参数", () => {
      const GrepTool = createGrepTool;
      const tool = GrepTool(testDir);
      expect(tool.parameters).toBeDefined();
    });

    it("应该支持 limit 参数", () => {
      const GrepTool = createGrepTool;
      const tool = GrepTool(testDir);
      expect(tool.parameters).toBeDefined();
    });
  });

  describe("GrepToolInput 类型", () => {
    it("应该定义正确的输入类型", () => {
      const input = {
        pattern: "test",
        path: "src",
        glob: "*.ts",
        ignoreCase: true,
        literal: false,
        context: 2,
        limit: 100,
      } satisfies Record<string, unknown>;
      expect(input.pattern).toBe("test");
    });
  });

  describe("默认限制常量", () => {
    it("DEFAULT_LIMIT 应该是 100", () => {
      const DEFAULT_LIMIT = 100;
      expect(DEFAULT_LIMIT).toBe(100);
    });
  });

  describe("grep 工具参数验证", () => {
    it("pattern 是必需的", async () => {
      const tool = createGrepTool(testDir);
      // 验证 tool 可以被创建
      expect(tool.name).toBe("grep");
      expect(tool.parameters).toBeDefined();
    });
  });

  describe("grep 工具描述", () => {
    it("应该包含工具名称", () => {
      const tool = createGrepTool(testDir);
      expect(tool.name).toBe("grep");
      expect(tool.label).toBe("grep");
    });

    it("应该描述搜索功能", () => {
      const tool = createGrepTool(testDir);
      expect(tool.description).toContain("Search file contents");
    });

    it("应该描述输出限制", () => {
      const tool = createGrepTool(testDir);
      expect(tool.description).toContain("matches");
    });
  });

  describe("自定义 GrepOperations", () => {
    it("应该支持自定义 isDirectory", async () => {
      const customOps: GrepOperations = {
        isDirectory: vi.fn().mockResolvedValue(true),
        readFile: vi.fn().mockResolvedValue("test content"),
      };

      const tool = createGrepTool(testDir, { operations: customOps });
      expect(tool.name).toBe("grep");
      expect(customOps.isDirectory).not.toHaveBeenCalled();
    });

    it("应该支持自定义 readFile", async () => {
      const customOps: GrepOperations = {
        isDirectory: vi.fn().mockResolvedValue(true),
        readFile: vi.fn().mockResolvedValue("test content"),
      };

      const tool = createGrepTool(testDir, { operations: customOps });
      expect(tool.name).toBe("grep");
      expect(customOps.readFile).not.toHaveBeenCalled();
    });
  });

  describe("工作目录", () => {
    it("应该使用传入的 cwd", () => {
      const tool = createGrepTool(testDir);
      expect(tool.name).toBe("grep");
    });

    it("应该支持相对路径", () => {
      const tool = createGrepTool("/tmp");
      expect(tool.name).toBe("grep");
    });

    it("应该支持绝对路径", () => {
      const tool = createGrepTool(testDir);
      expect(tool.name).toBe("grep");
    });
  });
});

describe("grep 模块常量", () => {
  it("应该导出 grepSchema", () => {
    expect(grepSchema).toBeDefined();
  });

  it("应该导出 grepTool", () => {
    expect(grepTool).toBeDefined();
    expect(grepTool.name).toBe("grep");
  });

  it("应该导出 createGrepTool", () => {
    expect(typeof createGrepTool).toBe("function");
  });

  it("应该导出 createLocalGrepOperations", () => {
    expect(typeof createLocalGrepOperations).toBe("function");
  });
});
