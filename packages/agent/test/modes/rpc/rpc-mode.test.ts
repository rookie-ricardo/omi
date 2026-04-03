import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/modes/rpc/jsonl", () => ({
  attachJsonlLineReader: vi.fn(),
  serializeJsonLine: (value: unknown) => `${JSON.stringify(value)}\n`,
}));

import { attachJsonlLineReader } from "../../../src/modes/rpc/jsonl";
import { runRpcMode } from "../../../src/modes/rpc/rpc-mode";
import type { AgentSession } from "../../../src/agent-session";
import type { RpcCommand } from "../../../src/modes/rpc/rpc-types";

const attachJsonlLineReaderMock = vi.mocked(attachJsonlLineReader);

describe("RPC Mode", () => {
  let mockSession: AgentSession;
  let stdoutWrite: any;

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
    attachJsonlLineReaderMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockCommandStream(commands: RpcCommand[]) {
    const stream: AsyncGenerator<unknown, void, unknown> = (async function* () {
      for (const command of commands) {
        yield command;
      }
    })();
    attachJsonlLineReaderMock.mockReturnValue(stream);
  }

  describe("prompt command", () => {
    it("应该成功处理 prompt 命令", async () => {
      const command: RpcCommand = { type: "prompt", message: "Hello", id: "cmd-1" };
      mockCommandStream([command]);

      await runRpcMode(mockSession);

      expect(mockSession.prompt).toHaveBeenCalledWith("Hello");
      expect(stdoutWrite).toHaveBeenCalled();
    });
  });

  describe("abort command", () => {
    it("应该成功处理 abort 命令", async () => {
      mockCommandStream([{ type: "abort", id: "cmd-2" }]);

      await runRpcMode(mockSession);

      expect(mockSession.abort).toHaveBeenCalled();
    });
  });

  describe("get_state command", () => {
    it("应该返回正确的会话状态", async () => {
      mockCommandStream([{ type: "get_state", id: "cmd-3" }]);

      await runRpcMode(mockSession);

      expect(mockSession.getSessionStats).toHaveBeenCalled();
    });
  });

  describe("set_model command", () => {
    it("应该设置模型", async () => {
      mockCommandStream([{ type: "set_model", modelId: "new-model", id: "cmd-4" }]);

      await runRpcMode(mockSession);

      expect(mockSession.setModel).toHaveBeenCalledWith("new-model");
    });
  });

  describe("cycle_model command", () => {
    it("应该循环模型", async () => {
      mockCommandStream([{ type: "cycle_model", id: "cmd-5" }]);

      await runRpcMode(mockSession);

      expect(mockSession.cycleModel).toHaveBeenCalled();
    });
  });

  describe("fork command", () => {
    it("应该成功处理 fork 命令", async () => {
      mockCommandStream([{ type: "fork", historyEntryId: "entry-123", id: "cmd-6" }]);

      await runRpcMode(mockSession);

      expect(mockSession.fork).toHaveBeenCalledWith("entry-123");
    });
  });

  describe("steer command", () => {
    it("应该成功处理 steer 命令", async () => {
      mockCommandStream([{ type: "steer", message: "Change direction", id: "cmd-7" }]);

      await runRpcMode(mockSession);

      expect(mockSession.steer).toHaveBeenCalledWith("Change direction");
    });
  });

  describe("follow_up command", () => {
    it("应该成功处理 follow_up 命令", async () => {
      mockCommandStream([{ type: "follow_up", message: "Continue", id: "cmd-8" }]);

      await runRpcMode(mockSession);

      expect(mockSession.followUp).toHaveBeenCalledWith("Continue");
    });
  });

  describe("错误处理", () => {
    it("应该处理命令执行错误并返回错误响应", async () => {
      mockSession.prompt = vi.fn().mockRejectedValue(new Error("Test error"));
      mockCommandStream([{ type: "prompt", message: "Hello", id: "cmd-9" }]);

      await runRpcMode(mockSession);

      expect(mockSession.prompt).toHaveBeenCalled();
      expect(stdoutWrite).toHaveBeenCalled();
    });
  });
});
