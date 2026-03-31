import { describe, expect, it } from "vitest";

import type { ProviderConfig } from "@omi/core";

import { createModelFromConfig, isBuiltInProvider, listBuiltInModels } from "../src/model-registry";

describe("model registry", () => {
  it("recognizes built-in pi-ai providers", () => {
    expect(isBuiltInProvider("openai")).toBe(true);
    expect(isBuiltInProvider("openrouter")).toBe(true);
    expect(isBuiltInProvider("not-a-provider")).toBe(false);
  });

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

  it("builds a custom Anthropic-compatible model", () => {
    const model = createModelFromConfig(
      makeConfig({
        type: "anthropic-compatible",
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
      createModelFromConfig(makeConfig({ type: "openai", model: "does-not-exist" })),
    ).toThrowError(/Model does-not-exist is not available for provider openai/);
  });

  it("rejects unsupported provider types", () => {
    expect(() =>
      createModelFromConfig(makeConfig({ type: "made-up-provider", model: "x" })),
    ).toThrowError(/Unsupported provider type: made-up-provider/);
  });

  it("lists models for built-in providers", () => {
    const models = listBuiltInModels("openai");
    expect(models.length).toBeGreaterThan(0);
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
