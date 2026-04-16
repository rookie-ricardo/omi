import { describe, expect, it } from "vitest";

import type { ProviderConfig } from "@omi/core";

import { createModelFromConfig } from "../src/model-registry";

describe("model registry", () => {
  it("builds a built-in OpenAI model from pi-ai", () => {
    const model = createModelFromConfig(
      makeConfig({ name: "openai", protocol: "openai-responses", model: "gpt-4.1-mini" }),
    );
    expect(model.provider).toBe("openai");
    expect(model.api).toBe("openai-responses");
    expect(model.baseUrl).toBe("https://api.openai.com/v1");
  });

  it("builds a built-in OpenRouter model from pi-ai", () => {
    const model = createModelFromConfig(
      makeConfig({ name: "openrouter", protocol: "openai-chat", model: "openai/gpt-4o-mini" }),
    );
    expect(model.provider).toBe("openrouter");
    expect(model.api).toBe("openai-completions");
  });

  it("builds a custom OpenAI-compatible model", () => {
    const model = createModelFromConfig(
      makeConfig({
        name: "openai-compatible",
        protocol: "openai-chat",
        model: "gpt-oss:20b",
        baseUrl: "http://localhost:11434/v1",
      }),
    );
    expect(model.provider).toBe("openai-compatible");
    expect(model.api).toBe("openai-completions");
    expect(model.baseUrl).toBe("http://localhost:11434/v1");
  });

  it("builds a custom Anthropic-compatible model", () => {
    const model = createModelFromConfig(
      makeConfig({
        name: "anthropic-compatible",
        protocol: "anthropic-messages",
        model: "claude-sonnet-4-20250514",
        baseUrl: "http://localhost:8080",
      }),
    );
    expect(model.provider).toBe("anthropic-compatible");
    expect(model.api).toBe("anthropic-messages");
    expect(model.input).toEqual(["text", "image"]);
  });

  it("rejects unknown models for built-in providers", () => {
    expect(() =>
      createModelFromConfig(
        makeConfig({ name: "openai", protocol: "openai-responses", model: "does-not-exist" }),
      ),
    ).toThrowError(/Model does-not-exist is not available for provider openai/);
  });

  it("rejects unsupported provider names", () => {
    expect(() =>
      createModelFromConfig(makeConfig({ name: "made-up-provider", protocol: "openai-chat", model: "x" })),
    ).toThrowError(/Unsupported provider name: made-up-provider/);
  });
});

function makeConfig(overrides: Partial<ProviderConfig>): ProviderConfig {
  return {
    id: "provider_1",
    name: "anthropic",
    protocol: "anthropic-messages",
    baseUrl: "",
    apiKey: "test-api-key",
    model: "claude-sonnet-4-20250514",
    url: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}
