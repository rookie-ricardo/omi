import { describe, expect, it } from "vitest";

import { DEFAULT_PROVIDER_THINKING_LEVEL, getProviderDefaults } from "../src";

describe("provider defaults", () => {
  it("exposes provider defaults consistently", () => {
    expect(getProviderDefaults("openrouter")).toMatchObject({
      name: "OpenRouter",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4o-mini",
    });
  });

  it("uses high as the unified default thinking level", () => {
    expect(DEFAULT_PROVIDER_THINKING_LEVEL).toBe("high");
  });
});
