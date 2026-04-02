import { describe, it, expect, vi, beforeEach } from "vitest";
import { runRpcMode } from "../src/modes/rpc/rpc-mode";
import type { AgentSession } from "../src/agent-session";
import type { RpcCommand } from "../src/modes/rpc/rpc-types";

describe("RPC Mode", () => {
  let mockSession: AgentSession;
  let stdoutWrite: ReturnType<typeof vi.spyOn>;
  let stdinMock: { [Symbol.asyncIterator](): AsyncIterator<unknown> };

  beforeEach(() => {
    mockSession = {
      prompt: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
      setModel: vi.fn(),
      cycleModel: vi.fn().mockReturnValue({ modelId: "test-model" }),
      getSessionStats: vi.fn().mockReturnValue({
        sessionId: "test-session",
        totalMessages: 10,
      }),
      abortBash: vi.fn(),
      fork: vi.fn().mockResolvedValue({ sessionId: "forked-session" }),
      steer: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
    } as unknown as AgentSession;

    stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("prompt command", () => {
    it("应该成功处理 prompt 命令", async () => {
      const command: RpcCommand = { type: "prompt", message: "Hello", id: "cmd-1" };
      stdinMock = {
        async *[Symbol.asyncIterator]() {
          yield command;
          // 永远等待，模拟持续运行
          await new Promise(() => {});
        },
      };

      vi.spyOn(process.stdin, "on").mockReturnValue(process.stdin);
      vi.spyOn(process.stdin, "once").mockReturnValue(process.stdin);

      const runPromise = runRpcMode(mockSession);

      // 等待一下让初始化完成
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockSession.prompt).toHaveBeenCalledWith("Hello");
      expect(stdoutWrite).toHaveBeenCalled();

      // 清理
      runPromise.catch(() => {});
    });
  });

  describe("abort command", () => {
    it("应该成功处理 abort 命令", async () => {
      const command: RpcCommand = { type: "abort", id: "cmd-2" };

      vi.spyOn(process.stdin, "on").mockReturnValue(process.stdin);
      vi.spyOn(process.stdin, "once").mockReturnValue(process.stdin);

      const runPromise = runRpcMode(mockSession);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockSession.abort).toHaveBeenCalled();

      runPromise.catch(() => {});
    });
  });

  describe("get_state command", () => {
    it("应该返回正确的会话状态", async () => {
      const command: RpcCommand = { type: "get_state", id: "cmd-3" };

      vi.spyOn(process.stdin, "on").mockReturnValue(process.stdin);
      vi.spyOn(process.stdin, "once").mockReturnValue(process.stdin);

      const runPromise = runRpcMode(mockSession);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockSession.getSessionStats).toHaveBeenCalled();

      runPromise.catch(() => {});
    });
  });

  describe("set_model command", () => {
    it("应该设置模型", async () => {
      const command: RpcCommand = { type: "set_model", modelId: "new-model", id: "cmd-4" };

      vi.spyOn(process.stdin, "on").mockReturnValue(process.stdin);
      vi.spyOn(process.stdin, "once").mockReturnValue(process.stdin);

      const runPromise = runRpcMode(mockSession);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockSession.setModel).toHaveBeenCalledWith("new-model");

      runPromise.catch(() => {});
    });
  });

  describe("cycle_model command", () => {
    it("应该循环模型", async () => {
      const command: RpcCommand = { type: "cycle_model", id: "cmd-5" };

      vi.spyOn(process.stdin, "on").mockReturnValue(process.stdin);
      vi.spyOn(process.stdin, "once").mockReturnValue(process.stdin);

      const runPromise = runRpcMode(mockSession);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockSession.cycleModel).toHaveBeenCalled();

      runPromise.catch(() => {});
    });
  });

  describe("fork command", () => {
    it("应该成功处理 fork 命令", async () => {
      const command: RpcCommand = { type: "fork", historyEntryId: "entry-123", id: "cmd-6" };

      vi.spyOn(process.stdin, "on").mockReturnValue(process.stdin);
      vi.spyOn(process.stdin, "once").mockReturnValue(process.stdin);

      const runPromise = runRpcMode(mockSession);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockSession.fork).toHaveBeenCalledWith("entry-123");

      runPromise.catch(() => {});
    });
  });

  describe("steer command", () => {
    it("应该成功处理 steer 命令", async () => {
      const command: RpcCommand = { type: "steer", message: "Change direction", id: "cmd-7" };

      vi.spyOn(process.stdin, "on").mockReturnValue(process.stdin);
      vi.spyOn(process.stdin, "once").mockReturnValue(process.stdin);

      const runPromise = runRpcMode(mockSession);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockSession.steer).toHaveBeenCalledWith("Change direction");

      runPromise.catch(() => {});
    });
  });

  describe("follow_up command", () => {
    it("应该成功处理 follow_up 命令", async () => {
      const command: RpcCommand = { type: "follow_up", message: "Continue", id: "cmd-8" };

      vi.spyOn(process.stdin, "on").mockReturnValue(process.stdin);
      vi.spyOn(process.stdin, "once").mockReturnValue(process.stdin);

      const runPromise = runRpcMode(mockSession);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockSession.followUp).toHaveBeenCalledWith("Continue");

      runPromise.catch(() => {});
    });
  });

  describe("错误处理", () => {
    it("应该处理命令执行错误并返回错误响应", async () => {
      mockSession.prompt = vi.fn().mockRejectedValue(new Error("Test error"));
      const command: RpcCommand = { type: "prompt", message: "Hello", id: "cmd-9" };

      vi.spyOn(process.stdin, "on").mockReturnValue(process.stdin);
      vi.spyOn(process.stdin, "once").mockReturnValue(process.stdin);

      const runPromise = runRpcMode(mockSession);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockSession.prompt).toHaveBeenCalled();
      // 错误响应会被写入 stdout
      expect(stdoutWrite).toHaveBeenCalled();

      runPromise.catch(() => {});
    });
  });
});
