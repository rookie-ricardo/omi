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
    expect(onToolDecision).toHaveBeenCalledWith("run_2:1", "rejected");
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
