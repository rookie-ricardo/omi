import type { ProviderConfig } from "@omi/core";

export type ProviderRuntime = "claude-agent-sdk" | "vercel-ai-sdk";

export function resolveProviderRuntime(providerConfig: ProviderConfig): ProviderRuntime {
  if (providerConfig.type === "anthropic" || providerConfig.type === "anthropic-compatible") {
    return "claude-agent-sdk";
  }
  return "vercel-ai-sdk";
}
