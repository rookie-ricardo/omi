import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { OmiTool } from "@omi/core";
import type { TextContent, ImageContent } from "@mariozechner/pi-ai";
import { createReadTool, createLocalReadOperations, type ReadOperations, type ReadToolOptions } from "../src/read";

describe("read 工具", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `omi-read-test-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("createReadTool", () => {
    it("应该创建一个 OmiTool 对象", () => {
      const tool = createReadTool(testDir);
      expect(tool).toBeDefined();
      expect(tool.name).toBe("read");
      expect(typeof tool.execute).toBe("function");
    });

    it("应该使用传入的 cwd", () => {
      const tool = createReadTool(testDir);
      expect(tool.label).toBe("read");
    });

    it("应该包含正确的 description", () => {
      const tool = createReadTool(testDir);
      expect(tool.description).toContain("Read the contents of a file");
    });

    it("应该包含 path 参数", () => {
      const tool = createReadTool(testDir);
      expect(tool.parameters).toBeDefined();
    });
  });

  describe("createLocalReadOperations", () => {
    it("应该返回包含必需方法的 ReadOperations", () => {
      const ops = createLocalReadOperations();
      expect(typeof ops.readFile).toBe("function");
      expect(typeof ops.access).toBe("function");
      expect(typeof ops.detectImageMimeType).toBe("function");
    });

    it("应该能读取本地文件", async () => {
      const filePath = join(testDir, "test.txt");
      await writeFile(filePath, "Hello, World!");
      const ops = createLocalReadOperations();
      const buffer = await ops.readFile(filePath);
      expect(buffer.toString()).toBe("Hello, World!");
    });

    it("应该能检查文件访问权限", async () => {
      const filePath = join(testDir, "test.txt");
      await writeFile(filePath, "test");
      const ops = createLocalReadOperations();
      await expect(ops.access(filePath)).resolves.not.toThrow();
    });

    it("应该能检测图像 MIME 类型", async () => {
      // 创建最小的 PNG 文件
      const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
      const pngFile = join(testDir, "test.png");
      await writeFile(pngFile, pngHeader);
      const ops = createLocalReadOperations();
      const mimeType = await ops.detectImageMimeType!(pngFile);
      expect(mimeType).toBe("image/png");
    });
  });

  describe("读取文本文件", () => {
    it("应该正确读取文件内容", async () => {
      const filePath = join(testDir, "test.txt");
      await writeFile(filePath, "Line 1\nLine 2\nLine 3");
      const tool = createReadTool(testDir);

      const result = await tool.execute("call-id", { path: "test.txt" });
      expect(result.content).toBeDefined();
      expect(result.content.length).toBeGreaterThan(0);

      const textContent = result.content.find((c): c is TextContent => c.type === "text");
      expect(textContent?.text).toContain("Line 1");
    });

    it("应该支持 offset 参数", async () => {
      const filePath = join(testDir, "test.txt");
      await writeFile(filePath, "Line 1\nLine 2\nLine 3");
      const tool = createReadTool(testDir);

      const result = await tool.execute("call-id", { path: "test.txt", offset: 2 });
      const textContent = result.content.find((c): c is TextContent => c.type === "text");
      expect(textContent?.text).toContain("Line 2");
    });

    it("应该支持 limit 参数", async () => {
      const filePath = join(testDir, "test.txt");
      await writeFile(filePath, "Line 1\nLine 2\nLine 3");
      const tool = createReadTool(testDir);

      const result = await tool.execute("call-id", { path: "test.txt", limit: 1 });
      const textContent = result.content.find((c): c is TextContent => c.type === "text");
      expect(textContent?.text).toContain("Line 1");
      expect(textContent?.text).not.toContain("Line 2");
    });

    it("应该对大文件进行截断", async () => {
      const lines: string[] = [];
      for (let i = 0; i < 1000; i++) {
        lines.push(`Line ${i + 1}`);
      }
      const filePath = join(testDir, "large.txt");
      await writeFile(filePath, lines.join("\n"));
      const tool = createReadTool(testDir);

      const result = await tool.execute("call-id", { path: "large.txt" });
      const textContent = result.content.find((c): c is TextContent => c.type === "text");
      expect(textContent?.text).toBeDefined();
    });

    it("应该处理不存在的文件并报错", async () => {
      const tool = createReadTool(testDir);
      await expect(tool.execute("call-id", { path: "nonexistent.txt" })).rejects.toThrow();
    });

    it("应该处理缺少 path 参数", async () => {
      const tool = createReadTool(testDir);
      await expect(tool.execute("call-id", {} as any)).rejects.toThrow();
    });
  });

  describe("读取图像文件", () => {
    it("应该检测图像文件", async () => {
      // 创建最小 PNG
      const pngContent = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.from([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]),
        Buffer.from([0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01]),
        Buffer.from([0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53]),
        Buffer.from([0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41]),
        Buffer.from([0x54, 0x08, 0xd7, 0x63, 0xf8, 0xff, 0xff, 0x3f, 0x00, 0x05, 0xfe, 0x02, 0xfe]),
        Buffer.from([0xdc, 0xcc, 0x59, 0xe7, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]),
      ]);
      const pngFile = join(testDir, "image.png");
      await writeFile(pngFile, pngContent);

      const tool = createReadTool(testDir, { autoResizeImages: false });
      const result = await tool.execute("call-id", { path: "image.png" });

      // 应该返回文本和图像内容
      expect(result.content.some((c) => c.type === "image")).toBe(true);
    });

    it("应该支持关闭图像自动调整大小", async () => {
      const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const pngFile = join(testDir, "small.png");
      await writeFile(pngFile, pngHeader);

      const tool = createReadTool(testDir, { autoResizeImages: false });
      const result = await tool.execute("call-id", { path: "small.png" });
      expect(result.content).toBeDefined();
    });
  });

  describe("自定义 ReadOperations", () => {
    it("应该支持自定义文件读取操作", async () => {
      const mockOps: ReadOperations = {
        readFile: vi.fn().mockResolvedValue(Buffer.from("Mock content")),
        access: vi.fn().mockResolvedValue(undefined),
      };

      const tool = createReadTool(testDir, { operations: mockOps });
      await tool.execute("call-id", { path: "mock.txt" });

      expect(mockOps.readFile).toHaveBeenCalled();
      expect(mockOps.access).toHaveBeenCalled();
    });

    it("应该支持没有 detectImageMimeType 的操作", async () => {
      const mockOps: ReadOperations = {
        readFile: vi.fn().mockResolvedValue(Buffer.from("Test content")),
        access: vi.fn().mockResolvedValue(undefined),
        // 不包含 detectImageMimeType
      };

      const tool = createReadTool(testDir, { operations: mockOps });
      const result = await tool.execute("call-id", { path: "test.txt" });

      const textContent = result.content.find((c): c is TextContent => c.type === "text");
      expect(textContent?.text).toContain("Test content");
    });
  });

  describe("AbortSignal 支持", () => {
    it("应该在已中止的 signal 时抛出错误", async () => {
      const tool = createReadTool(testDir);
      const abortController = new AbortController();
      abortController.abort();

      await expect(tool.execute("call-id", { path: "test.txt" }, abortController.signal)).rejects.toThrow(
        "Operation aborted",
      );
    });
  });

  describe("路径解析", () => {
    it("应该支持相对路径", async () => {
      const filePath = join(testDir, "relative.txt");
      await writeFile(filePath, "Relative path test");
      const tool = createReadTool(testDir);

      const result = await tool.execute("call-id", { path: "relative.txt" });
      const textContent = result.content.find((c): c is TextContent => c.type === "text");
      expect(textContent?.text).toContain("Relative path test");
    });

    it("应该支持绝对路径", async () => {
      const filePath = join(testDir, "absolute.txt");
      await writeFile(filePath, "Absolute path test");
      const tool = createReadTool(testDir);

      const result = await tool.execute("call-id", { path: filePath });
      const textContent = result.content.find((c): c is TextContent => c.type === "text");
      expect(textContent?.text).toContain("Absolute path test");
    });
  });

  describe("offset 边界情况", () => {
    it("应该处理越界的 offset", async () => {
      const filePath = join(testDir, "test.txt");
      await writeFile(filePath, "Line 1\nLine 2");
      const tool = createReadTool(testDir);

      await expect(tool.execute("call-id", { path: "test.txt", offset: 100 })).rejects.toThrow(
        /beyond end of file/,
      );
    });

    it("应该支持 offset=1 从头开始", async () => {
      const filePath = join(testDir, "test.txt");
      await writeFile(filePath, "Line 1\nLine 2");
      const tool = createReadTool(testDir);

      const result = await tool.execute("call-id", { path: "test.txt", offset: 1 });
      const textContent = result.content.find((c): c is TextContent => c.type === "text");
      expect(textContent?.text).toContain("Line 1");
    });
  });
});

describe("ReadOperations 接口", () => {
  it("应该定义必需的方法", () => {
    const ops: ReadOperations = {
      readFile: async () => Buffer.from(""),
      access: async () => {},
    };
    expect(ops.readFile).toBeDefined();
    expect(ops.access).toBeDefined();
  });

  it("应该允许可选的 detectImageMimeType", () => {
    const ops: ReadOperations = {
      readFile: async () => Buffer.from(""),
      access: async () => {},
      detectImageMimeType: async (path) => {
        return path.endsWith(".png") ? "image/png" : null;
      },
    };
    expect(typeof ops.detectImageMimeType).toBe("function");
  });
});

describe("ReadToolOptions 接口", () => {
  it("应该接受 autoResizeImages 选项", () => {
    const options: ReadToolOptions = {
      autoResizeImages: false,
    };
    expect(options.autoResizeImages).toBe(false);
  });

  it("应该接受自定义 operations", () => {
    const customOps: ReadOperations = {
      readFile: async () => Buffer.from(""),
      access: async () => {},
    };
    const options: ReadToolOptions = {
      operations: customOps,
    };
    expect(options.operations).toBe(customOps);
  });
});
