import { describe, expect, it } from "vitest";
import { type Message } from "@mariozechner/pi-ai";

import type { ProviderConfig } from "@omi/core";

import { buildAgentInitialState, createModelFromConfig } from "../src/providers";

describe("providers", () => {
  it("builds a built-in OpenAI model from pi-ai", () => {
    const model = createModelFromConfig(makeConfig({ type: "openai", model: "gpt-4.1-mini" }));
    expect(model.provider).toBe("openai");
    expect(model.api).toBe("openai-responses");
    expect(model.baseUrl).toBe("https://api.openai.com/v1");
  });

  it("builds a built-in OpenRouter model from pi-ai", () => {
    const model = createModelFromConfig(
      makeConfig({ type: "openrouter", model: "openai/gpt-4o-mini" }),
    );
    expect(model.provider).toBe("openrouter");
    expect(model.api).toBe("openai-completions");
  });

  it("builds a custom OpenAI-compatible model", () => {
    const model = createModelFromConfig(
      makeConfig({
        type: "openai-compatible",
        model: "gpt-oss:20b",
        baseUrl: "http://localhost:11434/v1",
      }),
    );
    expect(model.provider).toBe("openai-compatible");
    expect(model.api).toBe("openai-completions");
    expect(model.baseUrl).toBe("http://localhost:11434/v1");
  });

  it("includes historical runtime messages in the agent initial state", () => {
    const historyMessages: Message[] = [
      {
        role: "user",
        content: [{ type: "text", text: "previous user" }],
        timestamp: 1,
      },
    ];

    const initialState = buildAgentInitialState({
      runId: "run_1",
      sessionId: "session_1",
      workspaceRoot: "/workspace",
      prompt: "current prompt",
      historyMessages,
      providerConfig: makeConfig({ type: "anthropic" }),
      enabledTools: [],
    });

    expect(initialState.messages).toEqual([
      expect.objectContaining({
        role: "user",
        content: [{ type: "text", text: "previous user" }],
      }),
    ]);
  });
});

function makeConfig(overrides: Partial<ProviderConfig>): ProviderConfig {
  return {
    id: "provider_1",
    name: "Test Provider",
    type: "anthropic",
    baseUrl: "",
    apiKey: "test-api-key",
    model: "claude-sonnet-4-20250514",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}
