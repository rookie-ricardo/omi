import { describe, expect, it } from "vitest";

import type { ProviderConfig } from "@omi/core";

import { createModelFromConfig } from "../src/model-registry";
import { getSupportedApiVariants, routeProtocol } from "../src/protocol-router";

describe("protocol-router", () => {
  it("routes an explicit providerConfig.protocol to the matching pi-ai api variant", () => {
    const config = makeConfig({
      name: "openai",
      protocol: "openai-chat",
      model: "gpt-4.1-mini",
    });

    const routing = routeProtocol(config);
    expect(routing.protocol).toBe("openai-chat");
    expect(routing.apiVariant).toBe("openai-completions");

    const model = createModelFromConfig(config);
    expect(model.api).toBe("openai-completions");
  });

  it("rejects provider configs without an explicit protocol", () => {
    const config = makeConfig({
      name: "openai",
      protocol: undefined,
      model: "gpt-4.1-mini",
    });

    expect(() => routeProtocol(config)).toThrow(
      /providerConfig\.protocol must be one of anthropic-messages \| openai-responses \| openai-chat/,
    );
  });

  it("reports the supported api variant for each protocol", () => {
    expect(getSupportedApiVariants("openai-chat")).toEqual(["openai-completions"]);
    expect(getSupportedApiVariants("openai-responses")).toEqual(["openai-responses"]);
    expect(getSupportedApiVariants("anthropic-messages")).toEqual(["anthropic-messages"]);
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
