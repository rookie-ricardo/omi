import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { OmiTool } from "@omi/core";
import { createEditTool, createLocalEditOperations, type EditOperations, type EditToolOptions } from "../src/edit";

describe("edit 工具", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `omi-edit-test-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("createEditTool", () => {
    it("应该创建一个 OmiTool 对象", () => {
      const tool = createEditTool(testDir);
      expect(tool).toBeDefined();
      expect(tool.name).toBe("edit");
      expect(typeof tool.execute).toBe("function");
    });

    it("应该使用传入的 cwd", () => {
      const tool = createEditTool(testDir);
      expect(tool.label).toBe("edit");
    });

    it("应该包含正确的 description", () => {
      const tool = createEditTool(testDir);
      expect(tool.description).toContain("Edit a file by replacing exact text");
    });

    it("应该包含必需的参数", () => {
      const tool = createEditTool(testDir);
      expect(tool.parameters).toBeDefined();
    });
  });

  describe("createLocalEditOperations", () => {
    it("应该返回包含必需方法的 EditOperations", () => {
      const ops = createLocalEditOperations();
      expect(typeof ops.readFile).toBe("function");
      expect(typeof ops.writeFile).toBe("function");
      expect(typeof ops.access).toBe("function");
    });

    it("应该能读取本地文件", async () => {
      const filePath = join(testDir, "test.txt");
      await writeFile(filePath, "Hello, World!");
      const ops = createLocalEditOperations();
      const buffer = await ops.readFile(filePath);
      expect(buffer.toString()).toBe("Hello, World!");
    });

    it("应该能写入本地文件", async () => {
      const filePath = join(testDir, "test.txt");
      await writeFile(filePath, "Original");
      const ops = createLocalEditOperations();
      await ops.writeFile(filePath, "Modified");
      const content = await ops.readFile(filePath);
      expect(content.toString()).toBe("Modified");
    });

    it("应该能检查文件访问权限", async () => {
      const filePath = join(testDir, "test.txt");
      await writeFile(filePath, "test");
      const ops = createLocalEditOperations();
      await expect(ops.access(filePath)).resolves.not.toThrow();
    });
  });

  describe("基本编辑功能", () => {
    it("应该能替换文件中的文本", async () => {
      const filePath = join(testDir, "test.txt");
      await writeFile(filePath, "Hello World");
      const tool = createEditTool(testDir);

      const result = await tool.execute("call-id", {
        path: "test.txt",
        oldText: "World",
        newText: "Omi",
      });

      const textContent = result.content.find((c) => c.type === "text");
      expect(textContent?.text).toContain("Successfully replaced");
      expect(result.details!.diff).toBeDefined();

      // 验证文件已修改
      const ops = createLocalEditOperations();
      const content = (await ops.readFile(filePath)).toString();
      expect(content).toBe("Hello Omi");
    });

    it("应该支持多行替换", async () => {
      const filePath = join(testDir, "multiline.txt");
      await writeFile(filePath, "Line 1\nLine 2\nLine 3");
      const tool = createEditTool(testDir);

      await tool.execute("call-id", {
        path: "multiline.txt",
        oldText: "Line 1\nLine 2",
        newText: "First and Second",
      });

      const ops = createLocalEditOperations();
      const content = (await ops.readFile(filePath)).toString();
      expect(content).toContain("First and Second");
      expect(content).toContain("Line 3");
    });

    it("应该在编辑后返回 diff", async () => {
      const filePath = join(testDir, "test.txt");
      await writeFile(filePath, "Original text");
      const tool = createEditTool(testDir);

      const result = await tool.execute("call-id", {
        path: "test.txt",
        oldText: "Original",
        newText: "Modified",
      });

      expect(result.details!.diff).toBeDefined();
      expect(result.details!.diff).toContain("Original");
      expect(result.details!.diff).toContain("Modified");
    });

    it("应该返回 firstChangedLine", async () => {
      const filePath = join(testDir, "test.txt");
      await writeFile(filePath, "Line 1\nLine 2\nLine 3");
      const tool = createEditTool(testDir);

      const result = await tool.execute("call-id", {
        path: "test.txt",
        oldText: "Line 2",
        newText: "Modified Line 2",
      });

      expect(result.details!.firstChangedLine).toBeDefined();
    });
  });

  describe("错误处理", () => {
    it("应该处理文件不存在的情况", async () => {
      const tool = createEditTool(testDir);
      await expect(
        tool.execute("call-id", {
          path: "nonexistent.txt",
          oldText: "text",
          newText: "new text",
        }),
      ).rejects.toThrow("File not found");
    });

    it("应该处理缺少必需参数", async () => {
      const tool = createEditTool(testDir);
      await expect(tool.execute("call-id", {} as any)).rejects.toThrow();
    });

    it("应该处理找不到匹配文本的情况", async () => {
      const filePath = join(testDir, "test.txt");
      await writeFile(filePath, "Hello World");
      const tool = createEditTool(testDir);

      await expect(
        tool.execute("call-id", {
          path: "test.txt",
          oldText: "NonExistent",
          newText: "New",
        }),
      ).rejects.toThrow("Could not find the exact text");
    });

    it("应该处理重复匹配的情况", async () => {
      const filePath = join(testDir, "test.txt");
      await writeFile(filePath, "foo bar foo baz");
      const tool = createEditTool(testDir);

      await expect(
        tool.execute("call-id", {
          path: "test.txt",
          oldText: "foo",
          newText: "replaced",
        }),
      ).rejects.toThrow("Found 2 occurrences");
    });

    it("应该处理替换后无变化的情况", async () => {
      const filePath = join(testDir, "test.txt");
      await writeFile(filePath, "Hello World");
      const tool = createEditTool(testDir);

      await expect(
        tool.execute("call-id", {
          path: "test.txt",
          oldText: "Hello World",
          newText: "Hello World", // 相同的内容
        }),
      ).rejects.toThrow("No changes made");
    });
  });

  describe("行尾处理", () => {
    it("应该保持 CRLF 行尾", async () => {
      const filePath = join(testDir, "crlf.txt");
      await writeFile(filePath, "Line 1\r\nLine 2");
      const tool = createEditTool(testDir);

      await tool.execute("call-id", {
        path: "crlf.txt",
        oldText: "Line 1",
        newText: "First",
      });

      const ops = createLocalEditOperations();
      const content = (await ops.readFile(filePath)).toString();
      expect(content).toContain("\r\n");
    });

    it("应该保持 LF 行尾", async () => {
      const filePath = join(testDir, "lf.txt");
      await writeFile(filePath, "Line 1\nLine 2");
      const tool = createEditTool(testDir);

      await tool.execute("call-id", {
        path: "lf.txt",
        oldText: "Line 1",
        newText: "First",
      });

      const ops = createLocalEditOperations();
      const content = (await ops.readFile(filePath)).toString();
      expect(content).toContain("\n");
      expect(content).not.toContain("\r\n");
    });
  });

  describe("BOM 处理", () => {
    it("应该保留 UTF-8 BOM", async () => {
      const filePath = join(testDir, "bom.txt");
      await writeFile(filePath, "\uFEFFHello World");
      const tool = createEditTool(testDir);

      await tool.execute("call-id", {
        path: "bom.txt",
        oldText: "Hello",
        newText: "Hi",
      });

      const ops = createLocalEditOperations();
      const content = (await ops.readFile(filePath)).toString();
      expect(content.startsWith("\uFEFF")).toBe(true);
    });
  });

  describe("模糊匹配", () => {
    it("应该支持智能引号匹配", async () => {
      const filePath = join(testDir, "smart-quotes.txt");
      await writeFile(filePath, '"Hello"');
      const tool = createEditTool(testDir);

      // 使用直引号替换弯引号
      await tool.execute("call-id", {
        path: "smart-quotes.txt",
        oldText: '"Hello"',
        newText: "'World'",
      });

      const ops = createLocalEditOperations();
      const content = (await ops.readFile(filePath)).toString();
      expect(content).toContain("World");
    });

    it("应该支持智能破折号匹配", async () => {
      const filePath = join(testDir, "dashes.txt");
      await writeFile(filePath, "Hello — World");
      const tool = createEditTool(testDir);

      await tool.execute("call-id", {
        path: "dashes.txt",
        oldText: "Hello — World",
        newText: "Hello - Universe",
      });

      const ops = createLocalEditOperations();
      const content = (await ops.readFile(filePath)).toString();
      expect(content).toContain("Universe");
    });

    it("应该忽略尾随空格差异", async () => {
      const filePath = join(testDir, "trailing.txt");
      await writeFile(filePath, "Hello   \nWorld");
      const tool = createEditTool(testDir);

      await tool.execute("call-id", {
        path: "trailing.txt",
        oldText: "Hello   ", // 有尾随空格
        newText: "Hi",
      });

      const ops = createLocalEditOperations();
      const content = (await ops.readFile(filePath)).toString();
      expect(content).toContain("Hi");
    });
  });

  describe("自定义 EditOperations", () => {
    it("应该支持自定义文件操作", async () => {
      const filePath = join(testDir, "mock.txt");
      await writeFile(filePath, "Original");
      const mockOps: EditOperations = {
        readFile: vi.fn().mockResolvedValue(Buffer.from("Original")),
        writeFile: vi.fn().mockResolvedValue(undefined),
        access: vi.fn().mockResolvedValue(undefined),
      };

      const tool = createEditTool(testDir, { operations: mockOps });
      await tool.execute("call-id", {
        path: "mock.txt",
        oldText: "Original",
        newText: "Modified",
      });

      expect(mockOps.readFile).toHaveBeenCalled();
      expect(mockOps.writeFile).toHaveBeenCalled();
    });
  });

  describe("AbortSignal 支持", () => {
    it("应该在已中止的 signal 时抛出错误", async () => {
      const filePath = join(testDir, "test.txt");
      await writeFile(filePath, "Hello World");
      const tool = createEditTool(testDir);
      const abortController = new AbortController();
      abortController.abort();

      await expect(
        tool.execute("call-id", { path: "test.txt", oldText: "Hello", newText: "Hi" }, abortController.signal),
      ).rejects.toThrow("Operation aborted");
    });
  });

  describe("路径解析", () => {
    it("应该支持相对路径", async () => {
      const filePath = join(testDir, "relative.txt");
      await writeFile(filePath, "Original");
      const tool = createEditTool(testDir);

      await tool.execute("call-id", {
        path: "relative.txt",
        oldText: "Original",
        newText: "Modified",
      });

      const ops = createLocalEditOperations();
      const content = (await ops.readFile(filePath)).toString();
      expect(content).toBe("Modified");
    });

    it("应该支持绝对路径", async () => {
      const filePath = join(testDir, "absolute.txt");
      await writeFile(filePath, "Original");
      const tool = createEditTool(testDir);

      await tool.execute("call-id", {
        path: filePath,
        oldText: "Original",
        newText: "Modified",
      });

      const ops = createLocalEditOperations();
      const content = (await ops.readFile(filePath)).toString();
      expect(content).toBe("Modified");
    });
  });
});

describe("EditOperations 接口", () => {
  it("应该定义必需的方法", () => {
    const ops: EditOperations = {
      readFile: async () => Buffer.from(""),
      writeFile: async () => {},
      access: async () => {},
    };
    expect(ops.readFile).toBeDefined();
    expect(ops.writeFile).toBeDefined();
    expect(ops.access).toBeDefined();
  });
});

describe("EditToolOptions 接口", () => {
  it("应该接受自定义 operations", () => {
    const customOps: EditOperations = {
      readFile: async () => Buffer.from(""),
      writeFile: async () => {},
      access: async () => {},
    };
    const options: EditToolOptions = {
      operations: customOps,
    };
    expect(options.operations).toBe(customOps);
  });
});
