import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  estimateTextTokens,
  calculateContextTokens,
  shouldCompact,
  isRetryableError,
  isOverflowError,
  extractRetryAfterDelay,
  createFileOps,
  extractFileOpsFromMessages,
  computeFileLists,
  formatFileOperations,
  estimateRuntimeMessageTokens,
  findTurnStartIndex,
  DEFAULT_COMPACTION_SETTINGS,
  type CompactionSettings,
  type FileOperations,
} from "../src/compaction";
import type { RuntimeMessage, SessionRuntimeMessageEnvelope } from "../src/messages";
import type { Usage } from "@mariozechner/pi-ai";

function makeUsage(input: number, output: number, extras: Partial<Usage> = {}): Usage {
  const cacheRead = extras.cacheRead ?? 0;
  const cacheWrite = extras.cacheWrite ?? 0;
  const totalTokens = extras.totalTokens ?? input + output + cacheRead + cacheWrite;
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens,
    cost: extras.cost ?? 0,
  } as Usage;
}

describe("Compaction", () => {
  describe("estimateTextTokens", () => {
    it("应该为空文本返回0", () => {
      expect(estimateTextTokens("")).toBe(0);
      expect(estimateTextTokens("   ")).toBe(0);
    });

    it("应该为非空文本返回至少1个token", () => {
      expect(estimateTextTokens("a")).toBeGreaterThanOrEqual(1);
    });

    it("应该基于文本长度估算token数", () => {
      const shortText = "hello";
      const longText = "hello world this is a longer text for testing token estimation";

      expect(estimateTextTokens(longText)).toBeGreaterThan(estimateTextTokens(shortText));
    });

    it("应该使用4字符每token的估算比例", () => {
      const text = "a".repeat(100);
      const expected = Math.ceil(100 / 4);

      expect(estimateTextTokens(text)).toBe(expected);
    });
  });

  describe("calculateContextTokens", () => {
    it("应该优先使用 totalTokens", () => {
      const usage = makeUsage(100, 50, { totalTokens: 200 });

      expect(calculateContextTokens(usage)).toBe(200);
    });

    it("应该在 totalTokens 不存在时计算总和", () => {
      const usage = makeUsage(100, 50);

      expect(calculateContextTokens(usage)).toBe(150);
    });

    it("应该包含缓存token", () => {
      const usage = makeUsage(100, 50, { cacheRead: 25, cacheWrite: 25 });

      expect(calculateContextTokens(usage)).toBe(200);
    });
  });

  describe("shouldCompact", () => {
    it("当压缩禁用时应该返回 false", () => {
      const settings: CompactionSettings = {
        enabled: false,
        reserveTokens: 1000,
        keepRecentTokens: 2000,
      };

      expect(shouldCompact(5000, 10000, settings)).toBe(false);
    });

    it("当上下文token低于阈值时应该返回 false", () => {
      const settings: CompactionSettings = {
        enabled: true,
        reserveTokens: 1000,
        keepRecentTokens: 2000,
      };

      // 上下文窗口 10000，预留 1000，阈值 9000
      // 当前 8000，低于阈值
      expect(shouldCompact(8000, 10000, settings)).toBe(false);
    });

    it("当上下文token超过阈值时应该返回 true", () => {
      const settings: CompactionSettings = {
        enabled: true,
        reserveTokens: 1000,
        keepRecentTokens: 2000,
      };

      // 上下文窗口 10000，预留 1000，阈值 9000
      // 当前 9500，超过阈值
      expect(shouldCompact(9500, 10000, settings)).toBe(true);
    });

    it("应该在边界值正确工作", () => {
      const settings: CompactionSettings = {
        enabled: true,
        reserveTokens: 1000,
        keepRecentTokens: 2000,
      };

      // 正好在阈值上
      expect(shouldCompact(9000, 10000, settings)).toBe(false);
    });
  });

  describe("isRetryableError", () => {
    it("应该识别重试错误 - rate limit", () => {
      const error = new Error("Rate limit exceeded");
      expect(isRetryableError(error)).toBe(true);
    });

    it("应该识别重试错误 - overloaded", () => {
      const error = new Error("Server overloaded");
      expect(isRetryableError(error)).toBe(true);
    });

    it("应该识别重试错误 - 500 错误", () => {
      const error = new Error("Internal server error 500");
      expect(isRetryableError(error)).toBe(true);
    });

    it("应该识别重试错误 - 网络错误", () => {
      const error = new Error("Network error occurred");
      expect(isRetryableError(error)).toBe(true);
    });

    it("应该识别重试错误 - 连接超时", () => {
      const error = new Error("Connection timeout");
      expect(isRetryableError(error)).toBe(true);
    });

    it("不应该将溢出错误识别为重试错误", () => {
      const error = new Error("Context length exceeded");
      expect(isRetryableError(error)).toBe(false);
    });

    it("应该处理字符串错误", () => {
      expect(isRetryableError("Some rate limit error")).toBe(true);
    });

    it("应该处理非错误对象", () => {
      expect(isRetryableError(null)).toBe(false);
      expect(isRetryableError(undefined)).toBe(false);
      expect(isRetryableError(123)).toBe(false);
    });
  });

  describe("isOverflowError", () => {
    it("应该识别溢出错误 - context length", () => {
      const error = new Error("Context length exceeded");
      expect(isOverflowError(error)).toBe(true);
    });

    it("应该识别溢出错误 - token limit", () => {
      const error = new Error("Token limit reached");
      expect(isOverflowError(error)).toBe(true);
    });

    it("不应该将普通错误识别为溢出错误", () => {
      const error = new Error("Some other error");
      expect(isOverflowError(error)).toBe(false);
    });
  });

  describe("extractRetryAfterDelay", () => {
    it("应该提取秒延迟", () => {
      const error = new Error("Please retry after 5s");
      expect(extractRetryAfterDelay(error)).toBe(5000);
    });

    it("应该提取毫秒延迟", () => {
      const error = new Error("Please retry after 500ms");
      expect(extractRetryAfterDelay(error)).toBe(500);
    });

    it("应该提取秒单位", () => {
      const error = new Error("Try again in 10 seconds");
      expect(extractRetryAfterDelay(error)).toBe(10000);
    });

    it("当没有延迟信息时返回 undefined", () => {
      const error = new Error("Some error");
      expect(extractRetryAfterDelay(error)).toBeUndefined();
    });

    it("应该处理不同的时间格式", () => {
      expect(extractRetryAfterDelay(new Error("retry after 5 sec"))).toBe(5000);
      expect(extractRetryAfterDelay(new Error("try again in 3s"))).toBe(3000);
      expect(extractRetryAfterDelay(new Error("wait 100ms"))).toBe(100);
    });
  });

  describe("createFileOps", () => {
    it("应该创建空的文件操作跟踪器", () => {
      const fileOps = createFileOps();

      expect(fileOps.read).toBeInstanceOf(Set);
      expect(fileOps.written).toBeInstanceOf(Set);
      expect(fileOps.edited).toBeInstanceOf(Set);
      expect(fileOps.read.size).toBe(0);
      expect(fileOps.written.size).toBe(0);
      expect(fileOps.edited.size).toBe(0);
    });
  });

  describe("extractFileOpsFromMessages", () => {
    it("应该从工具输出中提取读取操作", () => {
      const fileOps = createFileOps();
      const messages: RuntimeMessage[] = [
        {
          role: "runtimeToolOutput",
          content: "file content",
          details: {
            toolInput: {
              toolName: "read",
              args: { path: "/test/file.ts" },
            },
          },
        } as unknown as RuntimeMessage,
      ];

      extractFileOpsFromMessages(messages, fileOps);

      expect(fileOps.read.has("/test/file.ts")).toBe(true);
    });

    it("应该从工具输出中提取写入操作", () => {
      const fileOps = createFileOps();
      const messages: RuntimeMessage[] = [
        {
          role: "runtimeToolOutput",
          content: "written",
          details: {
            toolInput: {
              toolName: "write",
              args: { path: "/test/output.ts" },
            },
          },
        } as unknown as RuntimeMessage,
      ];

      extractFileOpsFromMessages(messages, fileOps);

      expect(fileOps.written.has("/test/output.ts")).toBe(true);
    });

    it("应该从工具输出中提取编辑操作", () => {
      const fileOps = createFileOps();
      const messages: RuntimeMessage[] = [
        {
          role: "runtimeToolOutput",
          content: "edited",
          details: {
            toolInput: {
              toolName: "edit",
              args: { path: "/test/edit.ts" },
            },
          },
        } as unknown as RuntimeMessage,
      ];

      extractFileOpsFromMessages(messages, fileOps);

      expect(fileOps.edited.has("/test/edit.ts")).toBe(true);
    });

    it("应该忽略非工具输出消息", () => {
      const fileOps = createFileOps();
      const messages: RuntimeMessage[] = [
        {
          role: "user",
          content: "Hello",
        } as unknown as RuntimeMessage,
        {
          role: "assistantTranscript",
          content: [{ type: "text", text: "Hi" }],
        } as unknown as RuntimeMessage,
      ];

      extractFileOpsFromMessages(messages, fileOps);

      expect(fileOps.read.size).toBe(0);
      expect(fileOps.written.size).toBe(0);
      expect(fileOps.edited.size).toBe(0);
    });

    it("应该处理缺少 path 参数的情况", () => {
      const fileOps = createFileOps();
      const messages: RuntimeMessage[] = [
        {
          role: "runtimeToolOutput",
          content: "result",
          details: {
            toolInput: {
              toolName: "read",
              args: { other: "param" },
            },
          },
        } as unknown as RuntimeMessage,
      ];

      extractFileOpsFromMessages(messages, fileOps);

      expect(fileOps.read.size).toBe(0);
    });
  });

  describe("computeFileLists", () => {
    it("应该分离读取和修改的文件", () => {
      const fileOps: FileOperations = {
        read: new Set(["/file1.ts", "/file2.ts"]),
        written: new Set(["/file2.ts"]),
        edited: new Set(["/file3.ts"]),
      };

      const { readFiles, modifiedFiles } = computeFileLists(fileOps);

      expect(readFiles).toContain("/file1.ts");
      expect(readFiles).not.toContain("/file2.ts");
      expect(modifiedFiles).toContain("/file2.ts");
      expect(modifiedFiles).toContain("/file3.ts");
    });

    it("应该对结果排序", () => {
      const fileOps: FileOperations = {
        read: new Set(["/z.ts", "/a.ts"]),
        written: new Set(),
        edited: new Set(),
      };

      const { readFiles } = computeFileLists(fileOps);

      expect(readFiles[0]).toBe("/a.ts");
      expect(readFiles[1]).toBe("/z.ts");
    });

    it("应该处理空的操作集", () => {
      const fileOps: FileOperations = {
        read: new Set(),
        written: new Set(),
        edited: new Set(),
      };

      const { readFiles, modifiedFiles } = computeFileLists(fileOps);

      expect(readFiles).toHaveLength(0);
      expect(modifiedFiles).toHaveLength(0);
    });
  });

  describe("formatFileOperations", () => {
    it("应该格式化读取文件", () => {
      const result = formatFileOperations(["/file1.ts", "/file2.ts"], []);

      expect(result).toContain("<read-files>");
      expect(result).toContain("/file1.ts");
      expect(result).toContain("/file2.ts");
      expect(result).toContain("</read-files>");
    });

    it("应该格式化修改文件", () => {
      const result = formatFileOperations([], ["/file3.ts"]);

      expect(result).toContain("<modified-files>");
      expect(result).toContain("/file3.ts");
      expect(result).toContain("</modified-files>");
    });

    it("应该同时格式化两种文件", () => {
      const result = formatFileOperations(["/file1.ts"], ["/file2.ts"]);

      expect(result).toContain("<read-files>");
      expect(result).toContain("<modified-files>");
    });

    it("应该在无文件时返回空字符串", () => {
      const result = formatFileOperations([], []);

      expect(result).toBe("");
    });
  });

  describe("estimateRuntimeMessageTokens", () => {
    it("应该为简单消息估算token", () => {
      const message: RuntimeMessage = {
        role: "user",
        content: "Hello",
      } as unknown as RuntimeMessage;

      const tokens = estimateRuntimeMessageTokens(message);

      expect(tokens).toBeGreaterThan(0);
    });

    it("应该为长消息估算更多token", () => {
      const shortMessage: RuntimeMessage = {
        role: "user",
        content: "Hi",
      } as unknown as RuntimeMessage;

      const longMessage: RuntimeMessage = {
        role: "user",
        content: "This is a much longer message with many words to test token estimation",
      } as unknown as RuntimeMessage;

      expect(estimateRuntimeMessageTokens(longMessage)).toBeGreaterThan(
        estimateRuntimeMessageTokens(shortMessage),
      );
    });
  });

  describe("findTurnStartIndex", () => {
    it("应该找到用户消息作为回合起点", () => {
      const envelopes: SessionRuntimeMessageEnvelope[] = [
        { message: { role: "user" } as unknown as RuntimeMessage },
        { message: { role: "assistantTranscript" } as unknown as RuntimeMessage },
        { message: { role: "user" } as unknown as RuntimeMessage },
      ] as SessionRuntimeMessageEnvelope[];

      const result = findTurnStartIndex(envelopes, 2, 0);

      expect(result).toBe(2);
    });

    it("应该正确处理分支摘要作为回合起点", () => {
      const envelopes: SessionRuntimeMessageEnvelope[] = [
        { message: { role: "user" } as unknown as RuntimeMessage },
        { message: { role: "branchSummary" } as unknown as RuntimeMessage },
        { message: { role: "assistantTranscript" } as unknown as RuntimeMessage },
      ] as SessionRuntimeMessageEnvelope[];

      const result = findTurnStartIndex(envelopes, 2, 0);

      expect(result).toBe(1);
    });

    it("当没有找到起点时返回 -1", () => {
      const envelopes: SessionRuntimeMessageEnvelope[] = [
        { message: { role: "assistantTranscript" } as unknown as RuntimeMessage },
        { message: { role: "runtimeToolOutput" } as unknown as RuntimeMessage },
      ] as SessionRuntimeMessageEnvelope[];

      const result = findTurnStartIndex(envelopes, 1, 0);

      expect(result).toBe(-1);
    });
  });

  describe("DEFAULT_COMPACTION_SETTINGS", () => {
    it("应该有正确的默认设置", () => {
      expect(DEFAULT_COMPACTION_SETTINGS.enabled).toBe(true);
      expect(DEFAULT_COMPACTION_SETTINGS.reserveTokens).toBe(16384);
      expect(DEFAULT_COMPACTION_SETTINGS.keepRecentTokens).toBe(20000);
    });
  });
});

describe("Compaction", () => {
  describe("estimateTextTokens", () => {
    it("应该为空文本返回0", () => {
      expect(estimateTextTokens("")).toBe(0);
      expect(estimateTextTokens("   ")).toBe(0);
    });

    it("应该为非空文本返回至少1个token", () => {
      expect(estimateTextTokens("a")).toBeGreaterThanOrEqual(1);
    });

    it("应该基于文本长度估算token数", () => {
      const shortText = "hello";
      const longText = "hello world this is a longer text for testing token estimation";

      expect(estimateTextTokens(longText)).toBeGreaterThan(estimateTextTokens(shortText));
    });

    it("应该使用4字符每token的估算比例", () => {
      const text = "a".repeat(100);
      const expected = Math.ceil(100 / 4);

      expect(estimateTextTokens(text)).toBe(expected);
    });
  });

  describe("calculateContextTokens", () => {
    it("应该优先使用 totalTokens", () => {
      const usage = makeUsage(100, 50, { totalTokens: 200 });

      expect(calculateContextTokens(usage)).toBe(200);
    });

    it("应该在 totalTokens 不存在时计算总和", () => {
      const usage = makeUsage(100, 50);

      expect(calculateContextTokens(usage)).toBe(150);
    });

    it("应该包含缓存token", () => {
      const usage = makeUsage(100, 50, { cacheRead: 25, cacheWrite: 25 });

      expect(calculateContextTokens(usage)).toBe(200);
    });
  });

  describe("shouldCompact", () => {
    it("当压缩禁用时应该返回 false", () => {
      const settings: CompactionSettings = {
        enabled: false,
        reserveTokens: 1000,
        keepRecentTokens: 2000,
      };

      expect(shouldCompact(5000, 10000, settings)).toBe(false);
    });

    it("当上下文token低于阈值时应该返回 false", () => {
      const settings: CompactionSettings = {
        enabled: true,
        reserveTokens: 1000,
        keepRecentTokens: 2000,
      };

      // 上下文窗口 10000，预留 1000，阈值 9000
      // 当前 8000，低于阈值
      expect(shouldCompact(8000, 10000, settings)).toBe(false);
    });

    it("当上下文token超过阈值时应该返回 true", () => {
      const settings: CompactionSettings = {
        enabled: true,
        reserveTokens: 1000,
        keepRecentTokens: 2000,
      };

      // 上下文窗口 10000，预留 1000，阈值 9000
      // 当前 9500，超过阈值
      expect(shouldCompact(9500, 10000, settings)).toBe(true);
    });

    it("应该在边界值正确工作", () => {
      const settings: CompactionSettings = {
        enabled: true,
        reserveTokens: 1000,
        keepRecentTokens: 2000,
      };

      // 正好在阈值上
      expect(shouldCompact(9000, 10000, settings)).toBe(false);
    });
  });

  describe("isRetryableError", () => {
    it("应该识别重试错误 - rate limit", () => {
      const error = new Error("Rate limit exceeded");
      expect(isRetryableError(error)).toBe(true);
    });

    it("应该识别重试错误 - overloaded", () => {
      const error = new Error("Server overloaded");
      expect(isRetryableError(error)).toBe(true);
    });

    it("应该识别重试错误 - 500 错误", () => {
      const error = new Error("Internal server error 500");
      expect(isRetryableError(error)).toBe(true);
    });

    it("应该识别重试错误 - 网络错误", () => {
      const error = new Error("Network error occurred");
      expect(isRetryableError(error)).toBe(true);
    });

    it("应该识别重试错误 - 连接超时", () => {
      const error = new Error("Connection timeout");
      expect(isRetryableError(error)).toBe(true);
    });

    it("不应该将溢出错误识别为重试错误", () => {
      const error = new Error("Context length exceeded");
      expect(isRetryableError(error)).toBe(false);
    });

    it("应该处理字符串错误", () => {
      expect(isRetryableError("Some rate limit error")).toBe(true);
    });

    it("应该处理非错误对象", () => {
      expect(isRetryableError(null)).toBe(false);
      expect(isRetryableError(undefined)).toBe(false);
      expect(isRetryableError(123)).toBe(false);
    });
  });

  describe("isOverflowError", () => {
    it("应该识别溢出错误 - context length", () => {
      const error = new Error("Context length exceeded");
      expect(isOverflowError(error)).toBe(true);
    });

    it("应该识别溢出错误 - token limit", () => {
      const error = new Error("Token limit reached");
      expect(isOverflowError(error)).toBe(true);
    });

    it("不应该将普通错误识别为溢出错误", () => {
      const error = new Error("Some other error");
      expect(isOverflowError(error)).toBe(false);
    });
  });

  describe("extractRetryAfterDelay", () => {
    it("应该提取秒延迟", () => {
      const error = new Error("Please retry after 5s");
      expect(extractRetryAfterDelay(error)).toBe(5000);
    });

    it("应该提取毫秒延迟", () => {
      const error = new Error("Please retry after 500ms");
      expect(extractRetryAfterDelay(error)).toBe(500);
    });

    it("应该提取秒单位", () => {
      const error = new Error("Try again in 10 seconds");
      expect(extractRetryAfterDelay(error)).toBe(10000);
    });

    it("当没有延迟信息时返回 undefined", () => {
      const error = new Error("Some error");
      expect(extractRetryAfterDelay(error)).toBeUndefined();
    });

    it("应该处理不同的时间格式", () => {
      expect(extractRetryAfterDelay(new Error("retry after 5 sec"))).toBe(5000);
      expect(extractRetryAfterDelay(new Error("try again in 3s"))).toBe(3000);
      expect(extractRetryAfterDelay(new Error("wait 100ms"))).toBe(100);
    });
  });

  describe("createFileOps", () => {
    it("应该创建空的文件操作跟踪器", () => {
      const fileOps = createFileOps();

      expect(fileOps.read).toBeInstanceOf(Set);
      expect(fileOps.written).toBeInstanceOf(Set);
      expect(fileOps.edited).toBeInstanceOf(Set);
      expect(fileOps.read.size).toBe(0);
      expect(fileOps.written.size).toBe(0);
      expect(fileOps.edited.size).toBe(0);
    });
  });

  describe("extractFileOpsFromMessages", () => {
    it("应该从工具输出中提取读取操作", () => {
      const fileOps = createFileOps();
      const messages: RuntimeMessage[] = [
        {
          role: "runtimeToolOutput",
          content: "file content",
          details: {
            toolInput: {
              toolName: "read",
              args: { path: "/test/file.ts" },
            },
          },
        } as unknown as RuntimeMessage,
      ];

      extractFileOpsFromMessages(messages, fileOps);

      expect(fileOps.read.has("/test/file.ts")).toBe(true);
    });

    it("应该从工具输出中提取写入操作", () => {
      const fileOps = createFileOps();
      const messages: RuntimeMessage[] = [
        {
          role: "runtimeToolOutput",
          content: "written",
          details: {
            toolInput: {
              toolName: "write",
              args: { path: "/test/output.ts" },
            },
          },
        } as unknown as RuntimeMessage,
      ];

      extractFileOpsFromMessages(messages, fileOps);

      expect(fileOps.written.has("/test/output.ts")).toBe(true);
    });

    it("应该从工具输出中提取编辑操作", () => {
      const fileOps = createFileOps();
      const messages: RuntimeMessage[] = [
        {
          role: "runtimeToolOutput",
          content: "edited",
          details: {
            toolInput: {
              toolName: "edit",
              args: { path: "/test/edit.ts" },
            },
          },
        } as unknown as RuntimeMessage,
      ];

      extractFileOpsFromMessages(messages, fileOps);

      expect(fileOps.edited.has("/test/edit.ts")).toBe(true);
    });

    it("应该忽略非工具输出消息", () => {
      const fileOps = createFileOps();
      const messages: RuntimeMessage[] = [
        {
          role: "user",
          content: "Hello",
        } as unknown as RuntimeMessage,
        {
          role: "assistantTranscript",
          content: [{ type: "text", text: "Hi" }],
        } as unknown as RuntimeMessage,
      ];

      extractFileOpsFromMessages(messages, fileOps);

      expect(fileOps.read.size).toBe(0);
      expect(fileOps.written.size).toBe(0);
      expect(fileOps.edited.size).toBe(0);
    });

    it("应该处理缺少 path 参数的情况", () => {
      const fileOps = createFileOps();
      const messages: RuntimeMessage[] = [
        {
          role: "runtimeToolOutput",
          content: "result",
          details: {
            toolInput: {
              toolName: "read",
              args: { other: "param" },
            },
          },
        } as unknown as RuntimeMessage,
      ];

      extractFileOpsFromMessages(messages, fileOps);

      expect(fileOps.read.size).toBe(0);
    });
  });

  describe("computeFileLists", () => {
    it("应该分离读取和修改的文件", () => {
      const fileOps: FileOperations = {
        read: new Set(["/file1.ts", "/file2.ts"]),
        written: new Set(["/file2.ts"]),
        edited: new Set(["/file3.ts"]),
      };

      const { readFiles, modifiedFiles } = computeFileLists(fileOps);

      expect(readFiles).toContain("/file1.ts");
      expect(readFiles).not.toContain("/file2.ts");
      expect(modifiedFiles).toContain("/file2.ts");
      expect(modifiedFiles).toContain("/file3.ts");
    });

    it("应该对结果排序", () => {
      const fileOps: FileOperations = {
        read: new Set(["/z.ts", "/a.ts"]),
        written: new Set(),
        edited: new Set(),
      };

      const { readFiles } = computeFileLists(fileOps);

      expect(readFiles[0]).toBe("/a.ts");
      expect(readFiles[1]).toBe("/z.ts");
    });

    it("应该处理空的操作集", () => {
      const fileOps: FileOperations = {
        read: new Set(),
        written: new Set(),
        edited: new Set(),
      };

      const { readFiles, modifiedFiles } = computeFileLists(fileOps);

      expect(readFiles).toHaveLength(0);
      expect(modifiedFiles).toHaveLength(0);
    });
  });

  describe("formatFileOperations", () => {
    it("应该格式化读取文件", () => {
      const result = formatFileOperations(["/file1.ts", "/file2.ts"], []);

      expect(result).toContain("<read-files>");
      expect(result).toContain("/file1.ts");
      expect(result).toContain("/file2.ts");
      expect(result).toContain("</read-files>");
    });

    it("应该格式化修改文件", () => {
      const result = formatFileOperations([], ["/file3.ts"]);

      expect(result).toContain("<modified-files>");
      expect(result).toContain("/file3.ts");
      expect(result).toContain("</modified-files>");
    });

    it("应该同时格式化两种文件", () => {
      const result = formatFileOperations(["/file1.ts"], ["/file2.ts"]);

      expect(result).toContain("<read-files>");
      expect(result).toContain("<modified-files>");
    });

    it("应该在无文件时返回空字符串", () => {
      const result = formatFileOperations([], []);

      expect(result).toBe("");
    });
  });

  describe("estimateRuntimeMessageTokens", () => {
    it("应该为简单消息估算token", () => {
      const message: RuntimeMessage = {
        role: "user",
        content: "Hello",
      } as unknown as RuntimeMessage;

      const tokens = estimateRuntimeMessageTokens(message);

      expect(tokens).toBeGreaterThan(0);
    });

    it("应该为长消息估算更多token", () => {
      const shortMessage: RuntimeMessage = {
        role: "user",
        content: "Hi",
      } as unknown as RuntimeMessage;

      const longMessage: RuntimeMessage = {
        role: "user",
        content: "This is a much longer message with many words to test token estimation",
      } as unknown as RuntimeMessage;

      expect(estimateRuntimeMessageTokens(longMessage)).toBeGreaterThan(
        estimateRuntimeMessageTokens(shortMessage),
      );
    });
  });

  describe("findTurnStartIndex", () => {
    it("应该找到用户消息作为回合起点", () => {
      const envelopes: SessionRuntimeMessageEnvelope[] = [
        { message: { role: "user" } as unknown as RuntimeMessage },
        { message: { role: "assistantTranscript" } as unknown as RuntimeMessage },
        { message: { role: "user" } as unknown as RuntimeMessage },
      ] as SessionRuntimeMessageEnvelope[];

      const result = findTurnStartIndex(envelopes, 2, 0);

      expect(result).toBe(2);
    });

    it("应该正确处理分支摘要作为回合起点", () => {
      const envelopes: SessionRuntimeMessageEnvelope[] = [
        { message: { role: "user" } as unknown as RuntimeMessage },
        { message: { role: "branchSummary" } as unknown as RuntimeMessage },
        { message: { role: "assistantTranscript" } as unknown as RuntimeMessage },
      ] as SessionRuntimeMessageEnvelope[];

      const result = findTurnStartIndex(envelopes, 2, 0);

      expect(result).toBe(1);
    });

    it("当没有找到起点时返回 -1", () => {
      const envelopes: SessionRuntimeMessageEnvelope[] = [
        { message: { role: "assistantTranscript" } as unknown as RuntimeMessage },
        { message: { role: "runtimeToolOutput" } as unknown as RuntimeMessage },
      ] as SessionRuntimeMessageEnvelope[];

      const result = findTurnStartIndex(envelopes, 1, 0);

      expect(result).toBe(-1);
    });
  });

  describe("DEFAULT_COMPACTION_SETTINGS", () => {
    it("应该有正确的默认设置", () => {
      expect(DEFAULT_COMPACTION_SETTINGS.enabled).toBe(true);
      expect(DEFAULT_COMPACTION_SETTINGS.reserveTokens).toBe(16384);
      expect(DEFAULT_COMPACTION_SETTINGS.keepRecentTokens).toBe(20000);
    });
  });
});
