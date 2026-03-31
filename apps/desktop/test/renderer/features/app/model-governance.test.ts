import { describe, expect, it } from "vitest";

import type { ModelListResult, SessionRuntimeGetResult } from "@omi/protocol";

import {
  buildSessionModelOptions,
  formatProviderConfigLabel,
  resolveSessionModel,
} from "../../../../src/renderer/features/app/model-governance";

describe("model governance helpers", () => {
  const modelList: ModelListResult = {
    providerConfigs: [
      makeProviderConfig("provider_1", "OpenAI", "gpt-5.4", true),
      makeProviderConfig("provider_2", "Anthropic", "claude-4.0", true),
      makeProviderConfig("provider_3", "Disabled", "gpt-4.1", false),
    ],
    builtInProviders: [],
  };

  it("resolves the session-selected provider config when available", () => {
    const runtime = makeRuntime("provider_2");

    expect(resolveSessionModel(modelList, runtime)?.id).toBe("provider_2");
    expect(buildSessionModelOptions(modelList, runtime).map((config) => config.id)).toEqual([
      "provider_2",
      "provider_1",
      "provider_3",
    ]);
  });

  it("keeps the selected disabled provider visible in the options", () => {
    const runtime = makeRuntime("provider_3");

    expect(resolveSessionModel(modelList, runtime)?.id).toBe("provider_3");
    expect(buildSessionModelOptions(modelList, runtime).map((config) => config.id)).toEqual([
      "provider_3",
      "provider_1",
      "provider_2",
    ]);
  });

  it("formats provider labels without leaking empty separators", () => {
    expect(formatProviderConfigLabel(makeProviderConfig("provider_1", "OpenAI", "gpt-5.4", true))).toBe(
      "OpenAI · gpt-5.4",
    );
    expect(formatProviderConfigLabel(makeProviderConfig("provider_2", "gpt-5.4", "gpt-5.4", true))).toBe(
      "gpt-5.4",
    );
  });
});

function makeProviderConfig(
  id: string,
  name: string,
  model: string,
  _enabled: boolean,
): ModelListResult["providerConfigs"][number] {
  return {
    id,
    name,
    type: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "sk-test",
    model,
    createdAt: "2025-03-30T00:00:00.000Z",
    updatedAt: "2025-03-30T00:00:00.000Z",
  };
}

function makeRuntime(selectedProviderConfigId: string | null): SessionRuntimeGetResult {
  return {
    sessionId: "session_1",
    runtime: {
      sessionId: "session_1",
      activeRunId: null,
      pendingRunIds: [],
      queuedRuns: [],
      blockedRunId: null,
      blockedToolCallId: null,
      pendingApprovalToolCallIds: [],
      interruptedRunIds: [],
      selectedProviderConfigId,
      lastUserPrompt: null,
      lastAssistantResponse: null,
      lastActivityAt: "2025-03-30T00:00:00.000Z",
      compaction: {
        status: "idle",
        reason: null,
        requestedAt: null,
        updatedAt: "2025-03-30T00:00:00.000Z",
        lastSummary: null,
        lastCompactedAt: null,
        error: null,
      },
    },
  };
}
