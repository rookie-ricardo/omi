import type { ProviderConfig } from "@omi/core";

export type ProviderRuntime = "claude-agent-sdk" | "vercel-ai-sdk";

export function resolveProviderRuntime(providerConfig: ProviderConfig): ProviderRuntime {
  if (providerConfig.protocol === "anthropic-messages") {
    return "claude-agent-sdk";
  }
  return "vercel-ai-sdk";
}
