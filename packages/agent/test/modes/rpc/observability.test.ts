import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createRpcMetrics,
  recordCommandStart,
  recordCommandSuccess,
  recordCommandError,
  logRpcReady,
  logRpcShutdown,
} from "../../../src/modes/rpc/observability";
import type { Logger } from "../../../src/observability";
import type { RpcCommand, RpcResponse } from "../../../src/modes/rpc/rpc-types";

describe("RPC Observability", () => {
  let mockLogger: Logger;
  let infoSpy: ReturnType<typeof vi.fn>;
  let errorSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    infoSpy = vi.fn();
    errorSpy = vi.fn();
    mockLogger = {
      debug: vi.fn(),
      info: infoSpy,
      warn: vi.fn(),
      error: errorSpy,
    } as unknown as Logger;

    vi.spyOn(performance, "now")
      .mockReturnValueOnce(1000)  // recordCommandStart 调用
      .mockReturnValueOnce(1000)  // recordCommandStart 返回
      .mockReturnValueOnce(1100); // 后续调用
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("createRpcMetrics", () => {
    it("应该创建空的指标对象", () => {
      const metrics = createRpcMetrics();

      expect(metrics.commandsReceived).toBe(0);
      expect(metrics.commandsSucceeded).toBe(0);
      expect(metrics.commandsFailed).toBe(0);
      expect(metrics.commandLatencies).toBeInstanceOf(Map);
      expect(metrics.commandLatencies.size).toBe(0);
    });
  });

  describe("recordCommandStart", () => {
    it("应该记录命令开始", () => {
      const command: RpcCommand = { type: "prompt", message: "Hello", id: "cmd-1" };

      const result = recordCommandStart(mockLogger, command);

      expect(infoSpy).toHaveBeenCalledWith(
        "RPC command started",
        expect.objectContaining({
          commandId: "cmd-1",
          commandType: "prompt",
          hasMessage: true,
        }),
      );
      expect(result.startTime).toBe(1000);
      expect(result.commandId).toBe("cmd-1");
    });

    it("应该为没有 ID 的命令生成 ID", () => {
      const command: RpcCommand = { type: "get_state" };

      const result = recordCommandStart(mockLogger, command);

      expect(result.commandId).toMatch(/^cmd-/);
    });
  });

  describe("recordCommandSuccess", () => {
    it("应该记录成功的命令", () => {
      const response: RpcResponse = {
        id: "cmd-1",
        type: "response",
        command: "prompt",
        success: true,
        data: { result: "ok" },
      };

      recordCommandSuccess(mockLogger, "cmd-1", "prompt", 1000, response);

      expect(infoSpy).toHaveBeenCalledWith(
        "RPC command completed",
        expect.objectContaining({
          commandId: "cmd-1",
          commandType: "prompt",
          success: true,
          hasData: true,
        }),
      );
    });

    it("应该处理没有数据的响应", () => {
      const response: RpcResponse = {
        id: "cmd-1",
        type: "response",
        command: "abort",
        success: true,
      };

      recordCommandSuccess(mockLogger, "cmd-1", "abort", 1000, response);

      expect(infoSpy).toHaveBeenCalledWith(
        "RPC command completed",
        expect.objectContaining({
          hasData: false,
        }),
      );
    });
  });

  describe("recordCommandError", () => {
    it("应该记录失败的命令", () => {
      const error = new Error("Test error");

      recordCommandError(mockLogger, "cmd-1", "prompt", 1000, error);

      expect(errorSpy).toHaveBeenCalledWith(
        "RPC command failed",
        expect.objectContaining({
          commandId: "cmd-1",
          commandType: "prompt",
          success: false,
          error: "Test error",
          errorType: "Error",
        }),
      );
    });

    it("应该处理不同类型的错误", () => {
      const typeError = new TypeError("Type mismatch");

      recordCommandError(mockLogger, "cmd-2", "fork", 1000, typeError);

      expect(errorSpy).toHaveBeenCalledWith(
        "RPC command failed",
        expect.objectContaining({
          errorType: "TypeError",
        }),
      );
    });
  });

  describe("logRpcReady", () => {
    it("应该记录 RPC 就绪", () => {
      logRpcReady(mockLogger);

      expect(infoSpy).toHaveBeenCalledWith(
        "RPC mode ready",
        expect.objectContaining({
          pid: expect.any(Number),
          nodeVersion: expect.any(String),
        }),
      );
    });
  });

  describe("logRpcShutdown", () => {
    it("应该记录 RPC 关闭", () => {
      logRpcShutdown(mockLogger, "test reason");

      expect(infoSpy).toHaveBeenCalledWith(
        "RPC mode shutting down",
        expect.objectContaining({
          reason: "test reason",
        }),
      );
    });
  });
});
