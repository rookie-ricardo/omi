import { describe, expect, it } from "vitest";

import { getProviderDefaults } from "../src/index";

describe("settings defaults", () => {
  it("exposes provider defaults consistently", () => {
    expect(getProviderDefaults("openrouter")).toMatchObject({
      name: "OpenRouter",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4o-mini",
    });
  });
});
