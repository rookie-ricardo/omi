import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  MemoryDenialTracker,
  buildDenialKey,
  parseDenialKey,
  contextToDenialKey,
  getDefaultDenialTracker,
  resetDefaultDenialTracker,
  type DenialRecord,
} from "../src/permissions/tracking";
import type { PermissionContext } from "../src/permissions/rules";

describe("permissions/tracking", () => {
  // ============================================================================
  // MemoryDenialTracker
  // ============================================================================
  describe("MemoryDenialTracker", () => {
    let tracker: MemoryDenialTracker;

    beforeEach(() => {
      tracker = new MemoryDenialTracker(3, 60_000);
    });

    describe("recordDenial", () => {
      it("应该记录第一次拒绝", () => {
        tracker.recordDenial("test-key", "test reason");
        expect(tracker.getDenialCount("test-key")).toBe(1);

        const record = tracker.getDenialRecord("test-key");
        expect(record?.count).toBe(1);
        expect(record?.lastReason).toBe("test reason");
        expect(record?.retryCount).toBe(0);
      });

      it("应该递增拒绝计数", () => {
        tracker.recordDenial("test-key");
        tracker.recordDenial("test-key");
        tracker.recordDenial("test-key");
        expect(tracker.getDenialCount("test-key")).toBe(3);
      });

      it("应该在时间窗口外重置计数", () => {
        const shortTracker = new MemoryDenialTracker(3, 100);

        shortTracker.recordDenial("test-key");
        expect(shortTracker.getDenialCount("test-key")).toBe(1);

        // 模拟时间流逝
        vi.useFakeTimers();
        vi.setSystemTime(Date.now() + 200);

        shortTracker.recordDenial("test-key");
        expect(shortTracker.getDenialCount("test-key")).toBe(1); // 重置后重新计数

        vi.useRealTimers();
      });
    });

    describe("getDenialRecord", () => {
      it("应该返回完整的拒绝记录", () => {
        tracker.recordDenial("test-key", "reason 1");
        tracker.recordDenial("test-key", "reason 2");

        const record = tracker.getDenialRecord("test-key");
        expect(record).not.toBeNull();
        expect(record?.count).toBe(2);
        expect(record?.lastReason).toBe("reason 2");
        expect(record?.retryCount).toBe(0);
      });

      it("应该对不存在的 key 返回 null", () => {
        expect(tracker.getDenialRecord("nonexistent")).toBeNull();
      });
    });

    describe("recordRetry", () => {
      it("应该递增重试计数", () => {
        tracker.recordDenial("test-key");
        tracker.recordRetry("test-key");
        tracker.recordRetry("test-key");

        const record = tracker.getDenialRecord("test-key");
        expect(record?.retryCount).toBe(2);
      });

      it("应该对不存在的 key 无操作", () => {
        expect(() => tracker.recordRetry("nonexistent")).not.toThrow();
      });
    });

    describe("clear", () => {
      it("应该清除特定 key 的记录", () => {
        tracker.recordDenial("key1");
        tracker.recordDenial("key2");

        tracker.clear("key1");
        expect(tracker.getDenialCount("key1")).toBe(0);
        expect(tracker.getDenialCount("key2")).toBe(1);
      });
    });

    describe("clearAll", () => {
      it("应该清除所有记录", () => {
        tracker.recordDenial("key1");
        tracker.recordDenial("key2");
        tracker.recordDenial("key3");

        tracker.clearAll();
        expect(tracker.getDenialCount("key1")).toBe(0);
        expect(tracker.getDenialCount("key2")).toBe(0);
        expect(tracker.getDenialCount("key3")).toBe(0);
      });
    });

    describe("getAllRecords", () => {
      it("应该返回所有活跃记录", () => {
        tracker.recordDenial("key1");
        tracker.recordDenial("key2");

        const records = tracker.getAllRecords();
        expect(records.length).toBe(2);
        expect(records.map((r) => r.key).sort()).toEqual(["key1", "key2"]);
      });

      it("应该返回记录副本而非原始引用", () => {
        tracker.recordDenial("key1");
        const records = tracker.getAllRecords();

        records[0].record.count = 999;
        const original = tracker.getDenialRecord("key1");
        expect(original?.count).toBe(1); // 原始值未改变
      });
    });

    describe("hasExceededThreshold", () => {
      it("应该在达到阈值时返回 true", () => {
        tracker.recordDenial("test-key");
        tracker.recordDenial("test-key");
        expect(tracker.hasExceededThreshold("test-key", 3)).toBe(false);
      });

      it("应该在未达到阈值时返回 false", () => {
        tracker.recordDenial("test-key");
        expect(tracker.hasExceededThreshold("test-key", 3)).toBe(false);
      });

      it("应该在达到时返回 true (相等)", () => {
        tracker.recordDenial("test-key");
        tracker.recordDenial("test-key");
        tracker.recordDenial("test-key");
        expect(tracker.hasExceededThreshold("test-key", 3)).toBe(true);
      });
    });

    describe("边界情况", () => {
      it("应该处理空字符串 key", () => {
        tracker.recordDenial("");
        expect(tracker.getDenialCount("")).toBe(1);
      });

      it("应该处理特殊字符 key", () => {
        tracker.recordDenial("session:tool:/path");
        expect(tracker.getDenialCount("session:tool:/path")).toBe(1);
      });

      it("应该支持自定义阈值", () => {
        const customTracker = new MemoryDenialTracker(10);
        for (let i = 0; i < 10; i++) {
          customTracker.recordDenial("test-key");
        }
        expect(customTracker.hasExceededThreshold("test-key", 10)).toBe(true);
        expect(customTracker.hasExceededThreshold("test-key", 11)).toBe(false);
      });
    });
  });

  // ============================================================================
  // buildDenialKey
  // ============================================================================
  describe("buildDenialKey", () => {
    it("应该构建基本的 denial key", () => {
      expect(buildDenialKey("session-1", "bash")).toBe("session-1:bash");
    });

    it("应该支持可选后缀", () => {
      expect(buildDenialKey("session-1", "bash", "sub-path")).toBe("session-1:bash:sub-path");
    });

    it("后缀应该支持包含冒号的路径", () => {
      expect(buildDenialKey("s1", "tool", "/path:with:colons")).toBe("s1:tool:/path:with:colons");
    });
  });

  // ============================================================================
  // parseDenialKey
  // ============================================================================
  describe("parseDenialKey", () => {
    it("应该解析有效的 denial key", () => {
      const result = parseDenialKey("session-1:bash");
      expect(result.sessionId).toBe("session-1");
      expect(result.toolName).toBe("bash");
      expect(result.suffix).toBeUndefined();
    });

    it("应该解析带后缀的 denial key", () => {
      const result = parseDenialKey("session-1:bash:/etc/passwd");
      expect(result.sessionId).toBe("session-1");
      expect(result.toolName).toBe("bash");
      expect(result.suffix).toBe("/etc/passwd");
    });

    it("应该处理无效的 denial key", () => {
      const result = parseDenialKey("invalid-key-without-colon");
      expect(result.sessionId).toBe("unknown");
      expect(result.toolName).toBe("invalid-key-without-colon");
    });

    it("后缀应该保留完整路径", () => {
      const result = parseDenialKey("s1:t:/a:b:c");
      expect(result.suffix).toBe("/a:b:c");
    });
  });

  // ============================================================================
  // contextToDenialKey
  // ============================================================================
  describe("contextToDenialKey", () => {
    it("应该从上下文构建 denial key", () => {
      const context: PermissionContext = {
        toolName: "bash",
        input: { command: "ls" },
        sessionId: "test-session",
        planMode: false,
      };
      expect(contextToDenialKey(context)).toBe("test-session:bash");
    });
  });

  // ============================================================================
  // Default Tracker
  // ============================================================================
  describe("default denial tracker", () => {
    beforeEach(() => {
      resetDefaultDenialTracker();
    });

    afterEach(() => {
      resetDefaultDenialTracker();
    });

    it("getDefaultDenialTracker 应该返回单例", () => {
      const tracker1 = getDefaultDenialTracker();
      const tracker2 = getDefaultDenialTracker();
      expect(tracker1).toBe(tracker2);
    });

    it("resetDefaultDenialTracker 应该重置单例", () => {
      const tracker1 = getDefaultDenialTracker();
      resetDefaultDenialTracker();
      const tracker2 = getDefaultDenialTracker();
      expect(tracker1).not.toBe(tracker2);
    });
  });
});
