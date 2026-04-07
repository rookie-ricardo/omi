import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWriteTool, createLocalWriteOperations, type WriteOperations, type WriteToolOptions } from "../src/write";

describe("write 工具", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `omi-write-test-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("createWriteTool", () => {
    it("应该创建一个 OmiTool 对象", () => {
      const tool = createWriteTool(testDir);
      expect(tool).toBeDefined();
      expect(tool.name).toBe("write");
      expect(typeof tool.execute).toBe("function");
    });

    it("应该使用传入的 cwd", () => {
      const tool = createWriteTool(testDir);
      expect(tool.label).toBe("write");
    });

    it("应该包含正确的 description", () => {
      const tool = createWriteTool(testDir);
      expect(tool.description).toContain("Writes a file to the local filesystem");
    });

    it("应该包含必需的参数", () => {
      const tool = createWriteTool(testDir);
      expect(tool.parameters).toBeDefined();
    });
  });

  describe("createLocalWriteOperations", () => {
    it("应该返回包含必需方法的 WriteOperations", () => {
      const ops = createLocalWriteOperations();
      expect(typeof ops.writeFile).toBe("function");
      expect(typeof ops.mkdir).toBe("function");
    });

    it("应该能写入本地文件", async () => {
      const filePath = join(testDir, "test.txt");
      const ops = createLocalWriteOperations();
      await ops.writeFile(filePath, "Hello, World!");
      const content = await readFile(filePath, "utf-8");
      expect(content).toBe("Hello, World!");
    });

    it("应该能创建目录", async () => {
      const ops = createLocalWriteOperations();
      const nestedDir = join(testDir, "nested/deep/dir");
      await ops.mkdir(nestedDir);
      const fs = await import("node:fs");
      expect(fs.existsSync(nestedDir)).toBe(true);
    });
  });

  describe("基本写入功能", () => {
    it("应该能创建新文件", async () => {
      const filePath = join(testDir, "new.txt");
      const tool = createWriteTool(testDir);

      const result = await tool.execute("call-id", {
        path: "new.txt",
        content: "Hello, World!",
      });

      const textContent = result.content.find((c) => c.type === "text");
      expect(textContent?.text).toContain("Successfully wrote");

      // 验证文件已创建
      const content = await readFile(filePath, "utf-8");
      expect(content).toBe("Hello, World!");
    });

    it("应该能覆盖已有文件", async () => {
      const filePath = join(testDir, "existing.txt");
      await writeFile(filePath, "Original content");
      const tool = createWriteTool(testDir);

      await tool.execute("call-id", {
        path: "existing.txt",
        content: "New content",
      });

      const content = await readFile(filePath, "utf-8");
      expect(content).toBe("New content");
    });

    it("应该返回写入的字节数", async () => {
      const filePath = join(testDir, "bytes.txt");
      const tool = createWriteTool(testDir);

      const result = await tool.execute("call-id", {
        path: "bytes.txt",
        content: "Hello",
      });

      expect(result.details!.bytes).toBe(5);
    });

    it("应该能写入多行内容", async () => {
      const filePath = join(testDir, "multiline.txt");
      const tool = createWriteTool(testDir);
      const content = "Line 1\nLine 2\nLine 3";

      await tool.execute("call-id", {
        path: "multiline.txt",
        content,
      });

      const fileContent = await readFile(filePath, "utf-8");
      expect(fileContent).toBe(content);
    });
  });

  describe("目录创建", () => {
    it("应该自动创建父目录", async () => {
      const tool = createWriteTool(testDir);
      const nestedPath = "nested/dir/file.txt";

      await tool.execute("call-id", {
        path: nestedPath,
        content: "Content in nested dir",
      });

      const fullPath = join(testDir, nestedPath);
      const content = await readFile(fullPath, "utf-8");
      expect(content).toBe("Content in nested dir");
    });

    it("应该支持绝对路径", async () => {
      const filePath = join(testDir, "absolute.txt");
      const tool = createWriteTool(testDir);

      await tool.execute("call-id", {
        path: filePath,
        content: "Absolute path content",
      });

      const content = await readFile(filePath, "utf-8");
      expect(content).toBe("Absolute path content");
    });
  });

  describe("错误处理", () => {
    it("应该处理缺少 path 参数", async () => {
      const tool = createWriteTool(testDir);
      await expect(tool.execute("call-id", { content: "test" } as any)).rejects.toThrow();
    });

    it("应该处理缺少 content 参数", async () => {
      const tool = createWriteTool(testDir);
      await expect(tool.execute("call-id", { path: "test.txt" } as any)).rejects.toThrow();
    });

    it("应该处理空字符串 content", async () => {
      const tool = createWriteTool(testDir);
      const result = await tool.execute("call-id", {
        path: "empty.txt",
        content: "",
      });
      expect((result.content[0] as { type: "text"; text: string }).text).toContain("Successfully wrote");
      expect(result.details!.bytes).toBe(0);
    });

    it("应该能写入 Unicode 内容", async () => {
      const tool = createWriteTool(testDir);
      await tool.execute("call-id", {
        path: "unicode.txt",
        content: "中文测试 🎉 émojis",
      });

      const content = await readFile(join(testDir, "unicode.txt"), "utf-8");
      expect(content).toBe("中文测试 🎉 émojis");
    });

    it("应该能写入大文件内容", async () => {
      const tool = createWriteTool(testDir);
      const largeContent = "x".repeat(10000);

      const result = await tool.execute("call-id", {
        path: "large.txt",
        content: largeContent,
      }) as { details: { bytes: number } };

      expect(result.details!.bytes).toBe(10000);
    });
  });

  describe("自定义 WriteOperations", () => {
    it("应该支持自定义文件操作", async () => {
      const mockOps: WriteOperations = {
        writeFile: vi.fn().mockResolvedValue(undefined),
        mkdir: vi.fn().mockResolvedValue(undefined),
      };

      const tool = createWriteTool(testDir, { operations: mockOps });
      await tool.execute("call-id", {
        path: "mock.txt",
        content: "Mock content",
      });

      expect(mockOps.writeFile).toHaveBeenCalled();
      expect(mockOps.mkdir).toHaveBeenCalled();
    });
  });

  describe("AbortSignal 支持", () => {
    it("应该在已中止的 signal 时抛出错误", async () => {
      const tool = createWriteTool(testDir);
      const abortController = new AbortController();
      abortController.abort();

      await expect(
        tool.execute("call-id", { path: "test.txt", content: "content" }, abortController.signal),
      ).rejects.toThrow("Operation aborted");
    });
  });

  describe("字节计算", () => {
    it("应该正确计算 ASCII 字节", async () => {
      const tool = createWriteTool(testDir);
      const result = await tool.execute("call-id", {
        path: "ascii.txt",
        content: "Hello",
      });
      expect(result.details!.bytes).toBe(5);
    });

    it("应该正确计算 Unicode 字节", async () => {
      const tool = createWriteTool(testDir);
      const result = await tool.execute("call-id", {
        path: "unicode.txt",
        content: "你好",
      });
      // UTF-8 中 "你好" 是 6 字节
      expect(result.details!.bytes).toBe(6);
    });

    it("应该正确计算混合内容字节", async () => {
      const tool = createWriteTool(testDir);
      const result = await tool.execute("call-id", {
        path: "mixed.txt",
        content: "Hello 世界 123",
      });
      // 计算实际字节数
      expect(result.details!.bytes).toBe(Buffer.byteLength("Hello 世界 123", "utf-8"));
    });
  });
});

describe("WriteOperations 接口", () => {
  it("应该定义必需的方法", () => {
    const ops: WriteOperations = {
      writeFile: async () => {},
      mkdir: async () => {},
    };
    expect(ops.writeFile).toBeDefined();
    expect(ops.mkdir).toBeDefined();
  });
});

describe("WriteToolOptions 接口", () => {
  it("应该接受自定义 operations", () => {
    const customOps: WriteOperations = {
      writeFile: async () => {},
      mkdir: async () => {},
    };
    const options: WriteToolOptions = {
      operations: customOps,
    };
    expect(options.operations).toBe(customOps);
  });
});

describe("WriteToolDetails 接口", () => {
  it("应该包含 bytes 字段", () => {
    const details = { bytes: 100 };
    expect(details.bytes).toBe(100);
  });
});
