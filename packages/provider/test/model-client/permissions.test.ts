import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderConfig } from "@omi/core";

let lastAgentConfig: any;
let nextPrompt: ((config: any) => Promise<void>) | null = null;

vi.mock("@mariozechner/pi-agent-core", () => {
  return {
    Agent: vi.fn().mockImplementation((config: any) => {
      lastAgentConfig = config;
      return {
        subscribe: vi.fn(),
        prompt: vi.fn(async () => {
          if (nextPrompt) {
            await nextPrompt(config);
          }
        }),
        abort: vi.fn(),
      };
    }),
  };
});

import { PiAiModelClient } from "../../src/model-client/pi-ai-client";

describe("PiAiModelClient permission integration", () => {
  afterEach(() => {
    lastAgentConfig = undefined;
    nextPrompt = null;
    vi.clearAllMocks();
  });

  it("filters model-visible tools to the enabled tool subset", async () => {
    const client = new PiAiModelClient();
    const config = makeProviderConfig();

    await client.run(
      {
        runId: "run_1",
        sessionId: "session_1",
        prompt: "test",
        historyMessages: [],
        providerConfig: config,
        enabledTools: ["read"],
      },
      {},
    );

    expect(lastAgentConfig).toBeDefined();
    expect(lastAgentConfig.initialState.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "read",
    ]);
  });

  it("blocks tool execution before the model reaches tool dispatch", async () => {
    const client = new PiAiModelClient();
    const config = makeProviderConfig();
    const onToolCallStart = vi.fn();
    const onToolDecision = vi.fn();

    nextPrompt = async (agentConfig: any) => {
      await agentConfig.beforeToolCall({
        toolCall: { name: "bash" },
        args: { command: "rm -rf /" },
      });
    };

    await client.run(
      {
        runId: "run_2",
        sessionId: "session_1",
        prompt: "test",
        historyMessages: [],
        providerConfig: config,
        preflightToolCheck: async () => "blocked by policy",
      },
      {
        onToolCallStart,
        onToolDecision,
      },
    );

    expect(onToolCallStart).not.toHaveBeenCalled();
    expect(onToolDecision).toHaveBeenCalledTimes(1);
    const [toolCallId, decision] = onToolDecision.mock.calls[0] ?? [];
    expect(toolCallId).toMatch(/^run_2:tool:fallback:[a-f0-9]{16}$/);
    expect(decision).toBe("rejected");
  });

  it("uses provider tool event id as stable toolCallId instead of sequence order", async () => {
    const client = new PiAiModelClient();
    const config = makeProviderConfig();
    const onToolDecision = vi.fn();

    nextPrompt = async (agentConfig: any) => {
      await agentConfig.beforeToolCall({
        toolCall: { name: "bash", id: "event-b" },
        args: { command: "echo b" },
      });
      await agentConfig.beforeToolCall({
        toolCall: { name: "bash", id: "event-a" },
        args: { command: "echo a" },
      });
    };

    await client.run(
      {
        runId: "run_3",
        sessionId: "session_1",
        prompt: "test",
        historyMessages: [],
        providerConfig: config,
        preflightToolCheck: async () => "blocked by policy",
      },
      {
        onToolDecision,
      },
    );

    expect(onToolDecision.mock.calls).toEqual([
      ["run_3:tool:event-b", "rejected"],
      ["run_3:tool:event-a", "rejected"],
    ]);
  });

  it("awaits async onToolCallStart and blocks when approval is rejected", async () => {
    const client = new PiAiModelClient();
    const config = makeProviderConfig();
    const callOrder: string[] = [];
    const onToolDecision = vi.fn();
    let beforeToolCallResult: { block?: boolean; reason?: string } | null = null;

    nextPrompt = async (agentConfig: any) => {
      callOrder.push("before");
      beforeToolCallResult = await agentConfig.beforeToolCall({
        toolCall: { name: "bash", id: "approval-event" },
        args: { command: "echo denied" },
      });
      callOrder.push("after");
    };

    await client.run(
      {
        runId: "run_4",
        sessionId: "session_1",
        prompt: "test",
        historyMessages: [],
        providerConfig: config,
      },
      {
        onToolCallStart: async (toolCallId) => {
          callOrder.push("callback-start");
          await Promise.resolve();
          callOrder.push("callback-end");
          setTimeout(() => {
            client.rejectTool(toolCallId);
          }, 0);
        },
        onToolDecision,
      },
    );

    expect(callOrder).toEqual(["before", "callback-start", "callback-end", "after"]);
    expect(beforeToolCallResult).toEqual({
      block: true,
      reason: "Tool execution rejected by user.",
    });
    expect(onToolDecision).toHaveBeenCalledWith("run_4:tool:approval-event", "rejected");
  });
});

function makeProviderConfig(): ProviderConfig {
  const now = new Date().toISOString();
  return {
    id: "provider_1",
    name: "Test Provider",
    type: "anthropic",
    protocol: "anthropic-messages",
    baseUrl: "https://api.anthropic.com",
    apiKey: "test-api-key",
    model: "claude-sonnet-4-20250514",
    createdAt: now,
    updatedAt: now,
  };
}
