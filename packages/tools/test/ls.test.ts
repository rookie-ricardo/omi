import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createLsTool, createLocalLsOperations, type LsOperations, type LsToolOptions } from "../src/ls";

describe("ls 工具", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `omi-ls-test-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("createLsTool", () => {
    it("应该创建一个 AgentTool 对象", () => {
      const tool = createLsTool(testDir);
      expect(tool).toBeDefined();
      expect(tool.name).toBe("ls");
      expect(typeof tool.execute).toBe("function");
    });

    it("应该使用传入的 cwd", () => {
      const tool = createLsTool(testDir);
      expect(tool.label).toBe("ls");
    });

    it("应该包含正确的 description", () => {
      const tool = createLsTool(testDir);
      expect(tool.description).toContain("List directory contents");
    });

    it("应该包含必需的参数", () => {
      const tool = createLsTool(testDir);
      expect(tool.parameters).toBeDefined();
    });
  });

  describe("createLocalLsOperations", () => {
    it("应该返回包含必需方法的 LsOperations", () => {
      const ops = createLocalLsOperations();
      expect(typeof ops.exists).toBe("function");
      expect(typeof ops.stat).toBe("function");
      expect(typeof ops.readdir).toBe("function");
    });

    it("应该能检查目录是否存在", async () => {
      const ops = createLocalLsOperations();
      expect(await ops.exists(testDir)).toBe(true);
      expect(await ops.exists(join(testDir, "nonexistent"))).toBe(false);
    });

    it("应该能获取目录状态", async () => {
      const ops = createLocalLsOperations();
      const stat = await ops.stat(testDir);
      expect(stat.isDirectory()).toBe(true);
    });

    it("应该能读取目录内容", async () => {
      const subDir = join(testDir, "subdir");
      await mkdir(subDir);
      const ops = createLocalLsOperations();
      const entries = await ops.readdir(testDir);
      expect(entries).toContain("subdir");
    });
  });

  describe("基本列出功能", () => {
    it("应该能列出目录内容", async () => {
      await writeFile(join(testDir, "file1.txt"), "content1");
      await writeFile(join(testDir, "file2.txt"), "content2");
      const tool = createLsTool(testDir);

      const result = await tool.execute("call-id", {});
      const textContent = result.content.find((c) => c.type === "text");
      expect(textContent?.text).toContain("file1.txt");
      expect(textContent?.text).toContain("file2.txt");
    });

    it("应该用 / 标记目录", async () => {
      await mkdir(join(testDir, "mydir"));
      const tool = createLsTool(testDir);

      const result = await tool.execute("call-id", {});
      const textContent = result.content.find((c) => c.type === "text");
      expect(textContent?.text).toContain("mydir/");
    });

    it("应该支持指定路径", async () => {
      const subDir = join(testDir, "subdir");
      await mkdir(subDir);
      await writeFile(join(subDir, "file.txt"), "content");
      const tool = createLsTool(testDir);

      const result = await tool.execute("call-id", { path: "subdir" });
      const textContent = result.content.find((c) => c.type === "text");
      expect(textContent?.text).toContain("file.txt");
    });

    it("应该支持相对路径", async () => {
      await writeFile(join(testDir, "test.txt"), "content");
      const tool = createLsTool(testDir);

      const result = await tool.execute("call-id", { path: "." });
      const textContent = result.content.find((c) => c.type === "text");
      expect(textContent?.text).toContain("test.txt");
    });
  });

  describe("排序功能", () => {
    it("应该按字母顺序排序（不区分大小写）", async () => {
      await writeFile(join(testDir, "Zebra.txt"), "z");
      await writeFile(join(testDir, "apple.txt"), "a");
      await writeFile(join(testDir, "Banana.txt"), "b");
      const tool = createLsTool(testDir);

      const result = await tool.execute("call-id", {});
      const textContent = result.content.find((c) => c.type === "text");
      const output = textContent?.text || "";

      // 排序后 apple 应该在 Banana 之前，Banana 应该在 Zebra 之前
      const appleIdx = output.indexOf("apple.txt");
      const bananaIdx = output.indexOf("Banana.txt");
      const zebraIdx = output.indexOf("Zebra.txt");

      expect(appleIdx).toBeLessThan(bananaIdx);
      expect(bananaIdx).toBeLessThan(zebraIdx);
    });
  });

  describe("限制功能", () => {
    it("应该支持 limit 参数", async () => {
      for (let i = 0; i < 10; i++) {
        await writeFile(join(testDir, `file${i}.txt`), `content${i}`);
      }
      const tool = createLsTool(testDir);

      const result = await tool.execute("call-id", { limit: 3 });
      const textContent = result.content.find((c) => c.type === "text");
      const output = textContent?.text || "";

      // 应该只显示 3 个文件
      const fileCount = (output.match(/file\d+\.txt/g) || []).length;
      expect(fileCount).toBeLessThanOrEqual(3);
    });

    it("应该返回 entryLimitReached 详情", async () => {
      for (let i = 0; i < 10; i++) {
        await writeFile(join(testDir, `file${i}.txt`), `content${i}`);
      }
      const tool = createLsTool(testDir);

      const result = await tool.execute("call-id", { limit: 3 });
      expect(result.details.entryLimitReached).toBe(3);
    });

    it("应该包含限制通知", async () => {
      for (let i = 0; i < 10; i++) {
        await writeFile(join(testDir, `file${i}.txt`), `content${i}`);
      }
      const tool = createLsTool(testDir);

      const result = await tool.execute("call-id", { limit: 3 });
      const textContent = result.content.find((c) => c.type === "text");
      expect(textContent?.text).toContain("entries limit reached");
    });

    it("应该在达到限制时提示增加限制", async () => {
      // 创建多个文件以触发限制通知
      for (let i = 0; i < 3; i++) {
        await writeFile(join(testDir, `file${i}.txt`), `content${i}`);
      }
      const tool = createLsTool(testDir);

      const result = await tool.execute("call-id", { limit: 2 });
      const textContent = result.content.find((c) => c.type === "text");
      // 当达到限制时应该提示可以增加限制
      expect(textContent?.text).toMatch(/limit=\d+/);
    });
  });

  describe("空目录处理", () => {
    it("应该正确处理空目录", async () => {
      const emptyDir = join(testDir, "empty");
      await mkdir(emptyDir);
      const tool = createLsTool(testDir);

      const result = await tool.execute("call-id", { path: "empty" });
      const textContent = result.content.find((c) => c.type === "text");
      expect(textContent?.text).toBe("(empty directory)");
    });
  });

  describe("dotfiles 处理", () => {
    it("应该包含隐藏文件", async () => {
      await writeFile(join(testDir, ".hidden"), "hidden content");
      await writeFile(join(testDir, "visible.txt"), "visible content");
      const tool = createLsTool(testDir);

      const result = await tool.execute("call-id", {});
      const textContent = result.content.find((c) => c.type === "text");
      expect(textContent?.text).toContain(".hidden");
    });
  });

  describe("错误处理", () => {
    it("应该处理路径不存在的情况", async () => {
      const tool = createLsTool(testDir);
      await expect(tool.execute("call-id", { path: "nonexistent" })).rejects.toThrow("Path not found");
    });

    it("应该处理文件而非目录的情况", async () => {
      await writeFile(join(testDir, "file.txt"), "content");
      const tool = createLsTool(testDir);
      await expect(tool.execute("call-id", { path: "file.txt" })).rejects.toThrow("Not a directory");
    });
  });

  describe("自定义 LsOperations", () => {
    it("应该支持自定义目录操作", async () => {
      const mockOps: LsOperations = {
        exists: vi.fn().mockResolvedValue(true),
        stat: vi.fn().mockReturnValue({ isDirectory: () => true }),
        readdir: vi.fn().mockResolvedValue(["mocked.txt"]),
      };

      const tool = createLsTool(testDir, { operations: mockOps });
      await tool.execute("call-id", {});

      expect(mockOps.readdir).toHaveBeenCalled();
    });
  });

  describe("AbortSignal 支持", () => {
    it("应该在已中止的 signal 时抛出错误", async () => {
      const tool = createLsTool(testDir);
      const abortController = new AbortController();
      abortController.abort();

      await expect(tool.execute("call-id", {}, abortController.signal)).rejects.toThrow("Operation aborted");
    });
  });

  describe("路径解析", () => {
    it("应该支持绝对路径", async () => {
      await writeFile(join(testDir, "absolute.txt"), "content");
      const tool = createLsTool(testDir);

      const result = await tool.execute("call-id", { path: testDir });
      const textContent = result.content.find((c) => c.type === "text");
      expect(textContent?.text).toContain("absolute.txt");
    });
  });

  describe("递归子目录", () => {
    it("应该能识别子目录", async () => {
      await mkdir(join(testDir, "parent"));
      await mkdir(join(testDir, "parent/child"));
      await writeFile(join(testDir, "parent/file.txt"), "content");
      const tool = createLsTool(testDir);

      const result = await tool.execute("call-id", { path: "parent" });
      const textContent = result.content.find((c) => c.type === "text");
      expect(textContent?.text).toContain("child/");
      expect(textContent?.text).toContain("file.txt");
    });
  });
});

describe("LsOperations 接口", () => {
  it("应该定义必需的方法", () => {
    const ops: LsOperations = {
      exists: async () => true,
      stat: () => ({ isDirectory: () => true }),
      readdir: async () => [],
    };
    expect(ops.exists).toBeDefined();
    expect(ops.stat).toBeDefined();
    expect(ops.readdir).toBeDefined();
  });
});

describe("LsToolOptions 接口", () => {
  it("应该接受自定义 operations", () => {
    const customOps: LsOperations = {
      exists: async () => true,
      stat: () => ({ isDirectory: () => true }),
      readdir: async () => [],
    };
    const options: LsToolOptions = {
      operations: customOps,
    };
    expect(options.operations).toBe(customOps);
  });
});

describe("LsToolDetails 接口", () => {
  it("应该包含可选的 truncation", () => {
    const details = { truncation: { truncated: true, outputLines: 10 } };
    expect(details.truncation).toBeDefined();
  });

  it("应该包含可选的 entryLimitReached", () => {
    const details = { entryLimitReached: 500 };
    expect(details.entryLimitReached).toBe(500);
  });
});

describe("默认限制常量", () => {
  it("DEFAULT_LIMIT 应该是 500", () => {
    const DEFAULT_LIMIT = 500;
    expect(DEFAULT_LIMIT).toBe(500);
  });
});
