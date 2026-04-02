import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createLogger,
  type LogLevel,
  type LogEntry,
} from "../src/observability";

describe("Observability", () => {
  describe("createLogger", () => {
    let consoleLogSpy: ReturnType<typeof vi.spyOn>;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
    let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
    let consoleDebugSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      consoleDebugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("应该创建具有正确组件名称的日志记录器", () => {
      const logger = createLogger({ component: "test-component" });

      expect(logger).toHaveProperty("debug");
      expect(logger).toHaveProperty("info");
      expect(logger).toHaveProperty("warn");
      expect(logger).toHaveProperty("error");
    });

    it("应该输出 info 级别日志", () => {
      const logger = createLogger({ component: "test" });

      logger.info("Test message");

      expect(consoleLogSpy).toHaveBeenCalled();
      const logCall = consoleLogSpy.mock.calls[0][0];
      expect(logCall).toContain("[INFO]");
      expect(logCall).toContain("[test]");
      expect(logCall).toContain("Test message");
    });

    it("应该输出 error 级别日志", () => {
      const logger = createLogger({ component: "test" });

      logger.error("Error message");

      expect(consoleErrorSpy).toHaveBeenCalled();
      const logCall = consoleErrorSpy.mock.calls[0][0];
      expect(logCall).toContain("[ERROR]");
      expect(logCall).toContain("Error message");
    });

    it("应该输出 warn 级别日志", () => {
      const logger = createLogger({ component: "test" });

      logger.warn("Warning message");

      expect(consoleWarnSpy).toHaveBeenCalled();
      const logCall = consoleWarnSpy.mock.calls[0][0];
      expect(logCall).toContain("[WARN]");
    });

    it("应该输出 debug 级别日志", () => {
      const logger = createLogger({ component: "test", minLevel: "debug" });

      logger.debug("Debug message");

      expect(consoleDebugSpy).toHaveBeenCalled();
      const logCall = consoleDebugSpy.mock.calls[0][0];
      expect(logCall).toContain("[DEBUG]");
    });

    it("应该根据 minLevel 过滤日志", () => {
      const logger = createLogger({ component: "test", minLevel: "warn" });

      logger.debug("Debug message");
      logger.info("Info message");
      logger.warn("Warning message");
      logger.error("Error message");

      expect(consoleDebugSpy).not.toHaveBeenCalled();
      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it("应该在日志中包含上下文", () => {
      const logger = createLogger({ component: "test" });
      const context = { userId: "123", action: "login" };

      logger.info("User action", context);

      expect(consoleLogSpy).toHaveBeenCalled();
      const logCall = consoleLogSpy.mock.calls[0][0];
      expect(logCall).toContain("userId");
      expect(logCall).toContain("123");
    });

    it("应该在日志中包含时间戳", () => {
      const logger = createLogger({ component: "test" });

      logger.info("Test");

      expect(consoleLogSpy).toHaveBeenCalled();
      const logCall = consoleLogSpy.mock.calls[0][0];
      // ISO 时间戳格式检查
      expect(logCall).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it("应该支持禁用控制台输出", () => {
      const logger = createLogger({ component: "test", enableConsole: false });

      logger.info("Test message");

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it("应该正确处理嵌套上下文对象", () => {
      const logger = createLogger({ component: "test" });
      const context = {
        nested: { key: "value" },
        array: [1, 2, 3],
      };

      logger.info("Nested context", context);

      expect(consoleLogSpy).toHaveBeenCalled();
      const logCall = consoleLogSpy.mock.calls[0][0];
      expect(logCall).toContain("nested");
    });
  });
});
