import type { ProviderConfig } from "@omi/core";

export type ProviderRuntime = "claude-agent-sdk" | "pi-agent-core";

export function resolveProviderRuntime(providerConfig: ProviderConfig): ProviderRuntime {
  if (providerConfig.protocol === "anthropic-messages") {
    return "claude-agent-sdk";
  }
  return "pi-agent-core";
}
