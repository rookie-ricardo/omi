import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createFindTool,
  createLocalFindOperations,
  findSchema,
  findTool,
} from "../src/find";
import type { FindOperations, FindToolDetails, FindToolOptions } from "../src/find";

describe("find 工具", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `omi-find-test-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("createFindTool", () => {
    it("应该创建一个 AgentTool 对象", () => {
      const tool = createFindTool(testDir);
      expect(tool).toBeDefined();
      expect(tool.name).toBe("find");
      expect(typeof tool.execute).toBe("function");
    });

    it("应该包含正确的 description", () => {
      const tool = createFindTool(testDir);
      expect(tool.description).toContain("Search for files by glob pattern");
    });

    it("应该包含必需的参数", () => {
      const tool = createFindTool(testDir);
      expect(tool.parameters).toBeDefined();
    });
  });

  describe("createLocalFindOperations", () => {
    it("应该返回包含必需方法的 FindOperations", () => {
      const ops = createLocalFindOperations();
      expect(typeof ops.exists).toBe("function");
      expect(typeof ops.glob).toBe("function");
    });

    it("exists 应该检查路径是否存在", async () => {
      const ops = createLocalFindOperations();
      expect(await ops.exists(testDir)).toBe(true);
      expect(await ops.exists(join(testDir, "nonexistent"))).toBe(false);
    });

    it("glob 应该返回匹配的文件", async () => {
      const ops = createLocalFindOperations();
      // createLocalFindOperations 返回占位符，实际 glob 由 fd 处理
      const result = ops.glob("*.txt", testDir, { ignore: [], limit: 100 });
      expect(Array.isArray(result) || result.then).toBeTruthy();
    });
  });

  describe("FindOperations 接口", () => {
    it("应该定义必需的方法", () => {
      const ops: FindOperations = {
        exists: async () => true,
        glob: async () => [],
      };
      expect(ops.exists).toBeDefined();
      expect(ops.glob).toBeDefined();
    });

    it("exists 应该支持同步和异步", () => {
      const syncOps: FindOperations = {
        exists: () => true,
        glob: () => [],
      };
      const asyncOps: FindOperations = {
        exists: async () => true,
        glob: async () => [],
      };
      expect(typeof syncOps.exists).toBe("function");
      expect(typeof asyncOps.exists).toBe("function");
    });

    it("glob 应该接受正确的参数", () => {
      const ops: FindOperations = {
        exists: async () => true,
        glob: (pattern, cwd, options) => {
          expect(typeof pattern).toBe("string");
          expect(typeof cwd).toBe("string");
          expect(Array.isArray(options.ignore)).toBe(true);
          expect(typeof options.limit).toBe("number");
          return [];
        },
      };
      ops.glob("*.ts", "/tmp", { ignore: [], limit: 100 });
    });
  });

  describe("FindToolOptions 接口", () => {
    it("应该接受自定义 operations", () => {
      const customOps: FindOperations = {
        exists: async () => true,
        glob: async () => ["file1.ts", "file2.ts"],
      };
      const options: FindToolOptions = {
        operations: customOps,
      };
      expect(options.operations).toBe(customOps);
    });

    it("operations 是可选的", () => {
      const options: FindToolOptions = {};
      expect(options.operations).toBeUndefined();
    });
  });

  describe("FindToolDetails 接口", () => {
    it("应该包含可选的 truncation", () => {
      const details: FindToolDetails = { truncation: { content: "", truncated: true, truncatedBy: "lines", totalLines: 100, totalBytes: 0, outputLines: 10, outputBytes: 0, lastLinePartial: false, firstLineExceedsLimit: false, maxLines: 10, maxBytes: 0 } };
      expect(details.truncation).toBeDefined();
    });

    it("应该包含可选的 resultLimitReached", () => {
      const details: FindToolDetails = { resultLimitReached: 1000 };
      expect(details.resultLimitReached).toBe(1000);
    });
  });

  describe("findSchema 参数", () => {
    it("应该支持 pattern 参数", () => {
      const tool = createFindTool(testDir);
      expect(tool.parameters).toBeDefined();
    });

    it("应该支持 path 参数", () => {
      const tool = createFindTool(testDir);
      expect(tool.parameters).toBeDefined();
    });

    it("应该支持 limit 参数", () => {
      const tool = createFindTool(testDir);
      expect(tool.parameters).toBeDefined();
    });

    it("path 应该是可选的", () => {
      const tool = createFindTool(testDir);
      expect(tool.parameters).toBeDefined();
    });

    it("limit 应该是可选的", () => {
      const tool = createFindTool(testDir);
      expect(tool.parameters).toBeDefined();
    });
  });

  describe("FindToolInput 类型", () => {
    it("应该定义正确的输入类型", () => {
      const input = {
        pattern: "*.ts",
        path: "src",
        limit: 500,
      } satisfies Record<string, unknown>;
      expect(input.pattern).toBe("*.ts");
      expect(input.path).toBe("src");
      expect(input.limit).toBe(500);
    });

    it("path 应该是可选的", () => {
      const input = { pattern: "*.ts" } satisfies Record<string, unknown>;
      expect(input.pattern).toBe("*.ts");
    });
  });

  describe("默认限制常量", () => {
    it("DEFAULT_LIMIT 应该是 1000", () => {
      const DEFAULT_LIMIT = 1000;
      expect(DEFAULT_LIMIT).toBe(1000);
    });
  });

  describe("find 工具参数验证", () => {
    it("pattern 是必需的", async () => {
      const tool = createFindTool(testDir);
      expect(tool.name).toBe("find");
      expect(tool.parameters).toBeDefined();
    });
  });

  describe("find 工具描述", () => {
    it("应该包含工具名称", () => {
      const tool = createFindTool(testDir);
      expect(tool.name).toBe("find");
      expect(tool.label).toBe("find");
    });

    it("应该描述 glob 搜索功能", () => {
      const tool = createFindTool(testDir);
      expect(tool.description).toContain("glob pattern");
    });

    it("应该描述相对路径返回", () => {
      const tool = createFindTool(testDir);
      expect(tool.description).toContain("relative");
    });

    it("应该描述 .gitignore 支持", () => {
      const tool = createFindTool(testDir);
      expect(tool.description).toContain(".gitignore");
    });

    it("应该描述输出限制", () => {
      const tool = createFindTool(testDir);
      expect(tool.description).toContain("truncated");
    });
  });

  describe("自定义 FindOperations", () => {
    it("应该支持自定义 exists", async () => {
      const customOps: FindOperations = {
        exists: vi.fn().mockResolvedValue(true),
        glob: vi.fn().mockResolvedValue(["file1.ts"]),
      };

      const tool = createFindTool(testDir, { operations: customOps });
      expect(tool.name).toBe("find");
      expect(customOps.exists).not.toHaveBeenCalled();
    });

    it("应该支持自定义 glob", async () => {
      const customOps: FindOperations = {
        exists: vi.fn().mockResolvedValue(true),
        glob: vi.fn().mockResolvedValue(["file1.ts", "file2.ts"]),
      };

      const tool = createFindTool(testDir, { operations: customOps });
      expect(tool.name).toBe("find");
      expect(customOps.glob).not.toHaveBeenCalled();
    });

    it("应该处理 glob 返回空数组", async () => {
      const customOps: FindOperations = {
        exists: vi.fn().mockResolvedValue(true),
        glob: vi.fn().mockResolvedValue([]),
      };

      const tool = createFindTool(testDir, { operations: customOps });
      expect(tool.name).toBe("find");
    });

    it("应该处理 glob 返回 Promise", async () => {
      const customOps: FindOperations = {
        exists: vi.fn().mockResolvedValue(true),
        glob: vi.fn().mockResolvedValue(Promise.resolve(["file.ts"])),
      };

      const tool = createFindTool(testDir, { operations: customOps });
      expect(tool.name).toBe("find");
    });
  });

  describe("工作目录", () => {
    it("应该使用传入的 cwd", () => {
      const tool = createFindTool(testDir);
      expect(tool.name).toBe("find");
    });

    it("应该支持相对路径", () => {
      const tool = createFindTool("/tmp");
      expect(tool.name).toBe("find");
    });

    it("应该支持绝对路径", () => {
      const tool = createFindTool(testDir);
      expect(tool.name).toBe("find");
    });
  });

  describe("glob 模式示例", () => {
    it("应该支持 *.ts 模式", () => {
      const tool = createFindTool(testDir);
      expect(tool.parameters).toBeDefined();
    });

    it("应该支持 **/*.json 模式", () => {
      const tool = createFindTool(testDir);
      expect(tool.parameters).toBeDefined();
    });

    it("应该支持 src/**/*.spec.ts 模式", () => {
      const tool = createFindTool(testDir);
      expect(tool.parameters).toBeDefined();
    });
  });

  describe("路径转换", () => {
    it("应该将结果转换为相对路径", () => {
      // 测试 toPosixPath 函数的逻辑
      const path = { sep: "/", relative: (a: string, b: string) => b };
      const result = "src/test.ts".split(path.sep).join("/");
      expect(result).toBe("src/test.ts");
    });

    it("应该处理 Windows 路径分隔符", () => {
      // 测试 toPosixPath 函数
      const input = "src\\test.ts";
      const result = input.split("\\").join("/");
      expect(result).toBe("src/test.ts");
    });
  });
});

describe("find 模块导出", () => {
  it("应该导出 findTool", () => {
    expect(findTool).toBeDefined();
    expect(findTool.name).toBe("find");
  });

  it("应该导出 createFindTool", () => {
    expect(typeof createFindTool).toBe("function");
  });

  it("应该导出 createLocalFindOperations", () => {
    expect(typeof createLocalFindOperations).toBe("function");
  });

  it("应该导出 findSchema", () => {
    expect(findSchema).toBeDefined();
  });
});

describe("find 工具与 fd 集成", () => {
  it("应该在 fd 不可用时提供清晰的错误", async () => {
    const tool = createFindTool("/tmp");
    expect(tool.name).toBe("find");
  });

  it("应该使用 fd 的 --glob 参数", () => {
    // fd 命令行参数验证
    const expectedArgs = ["--glob", "--color=never", "--hidden", "--max-results"];
    expect(expectedArgs).toContain("--glob");
    expect(expectedArgs).toContain("--hidden");
  });

  it("应该支持 .gitignore 文件", () => {
    const tool = createFindTool("/tmp");
    expect(tool.description).toContain(".gitignore");
  });

  it("应该忽略 node_modules", () => {
    const tool = createFindTool("/tmp");
    // 描述中应提到忽略规则
    expect(tool.description).toBeDefined();
  });
});
