import type { ProviderConfig } from "@omi/core";
import type { ProtocolType } from "./types";

/**
 * Protocol router configuration.
 * Maps protocol + model to pi-ai API configuration.
 *
 * IMPORTANT: All routing decisions are based solely on providerConfig.type and model.
 * No global defaults or implicit priority rules.
 */
export interface ProtocolRouterConfig {
  protocol: ProtocolType;
  apiVariant: string;
  supportsToolLoop: boolean;
  supportsUsageInStreaming: boolean;
  supportsThinking: boolean;
  supportsPromptCaching: boolean;
  maxConcurrentTools: number;
}

/**
 * Known API variants per protocol.
 */
const PROTOCOL_API_VARIANTS: Record<ProtocolType, string[]> = {
  "anthropic-messages": [
    "anthropic-messages",
    "anthropic-responses",
  ],
  "openai-responses": [
    "openai-responses",
  ],
  "openai-chat": [
    "openai-completions",
    "openai-chat",
    "google-generative-ai",
    "bedrock-converse-stream",
    "azure-openai-responses",
    "mistral-conversations",
  ],
};

/**
 * Protocol capabilities per API variant.
 * These determine what features are available for each protocol.
 */
const API_CAPABILITIES: Record<string, {
  supportsToolLoop: boolean;
  supportsUsageInStreaming: boolean;
  supportsThinking: boolean;
  supportsPromptCaching: boolean;
  maxConcurrentTools: number;
}> = {
  // Anthropic messages API
  "anthropic-messages": {
    supportsToolLoop: true,
    supportsUsageInStreaming: true,
    supportsThinking: true,
    supportsPromptCaching: true,
    maxConcurrentTools: 1, // Claude requires sequential tool calls
  },
  "anthropic-responses": {
    supportsToolLoop: true,
    supportsUsageInStreaming: true,
    supportsThinking: true,
    supportsPromptCaching: true,
    maxConcurrentTools: 1,
  },
  // OpenAI Responses API
  "openai-responses": {
    supportsToolLoop: true,
    supportsUsageInStreaming: false,
    supportsThinking: false,
    supportsPromptCaching: true,
    maxConcurrentTools: 5,
  },
  // OpenAI Chat Completions
  "openai-completions": {
    supportsToolLoop: true,
    supportsUsageInStreaming: false,
    supportsThinking: false,
    supportsPromptCaching: true,
    maxConcurrentTools: 128,
  },
  // Third-party providers
  "google-generative-ai": {
    supportsToolLoop: true,
    supportsUsageInStreaming: false,
    supportsThinking: false,
    supportsPromptCaching: false,
    maxConcurrentTools: 1,
  },
  "bedrock-converse-stream": {
    supportsToolLoop: true,
    supportsUsageInStreaming: false,
    supportsThinking: false,
    supportsPromptCaching: false,
    maxConcurrentTools: 1,
  },
  "azure-openai-responses": {
    supportsToolLoop: true,
    supportsUsageInStreaming: false,
    supportsThinking: false,
    supportsPromptCaching: true,
    maxConcurrentTools: 5,
  },
  "mistral-conversations": {
    supportsToolLoop: true,
    supportsUsageInStreaming: false,
    supportsThinking: false,
    supportsPromptCaching: false,
    maxConcurrentTools: 1,
  },
};

/**
 * Resolve the API variant for a provider configuration.
 * The API variant is determined by providerConfig.type + model compatibility.
 */
export function resolveApiVariant(providerConfig: ProviderConfig): string {
  const type = providerConfig.type.toLowerCase();

  // Explicit API mapping based on provider type
  const explicitMapping: Record<string, string> = {
    anthropic: "anthropic-messages",
    "anthropic-compatible": "anthropic-messages",
    openai: "openai-responses",
    "openai-compatible": "openai-responses",
    openrouter: "openai-completions",
    groq: "openai-completions",
    cerebras: "openai-completions",
    mistral: "mistral-conversations",
    xai: "openai-completions",
    azure: "azure-openai-responses",
    bedrock: "bedrock-converse-stream",
    google: "google-generative-ai",
  };

  return explicitMapping[type] ?? "openai-completions";
}

/**
 * Get protocol capabilities for a given API variant.
 */
export function getApiCapabilities(apiVariant: string): {
  supportsToolLoop: boolean;
  supportsUsageInStreaming: boolean;
  supportsThinking: boolean;
  supportsPromptCaching: boolean;
  maxConcurrentTools: number;
} {
  return API_CAPABILITIES[apiVariant] ?? API_CAPABILITIES["openai-completions"];
}

/**
 * Get the supported API variants for a protocol type.
 */
export function getSupportedApiVariants(protocol: ProtocolType): string[] {
  return PROTOCOL_API_VARIANTS[protocol];
}

/**
 * Route a provider configuration to the appropriate protocol and API variant.
 * Returns the full protocol routing configuration.
 */
export function routeProtocol(providerConfig: ProviderConfig): ProtocolRouterConfig {
  const type = providerConfig.type.toLowerCase();

  // Determine protocol based on provider type
  let protocol: ProtocolType;
  if (type === "anthropic" || type === "anthropic-compatible") {
    protocol = "anthropic-messages";
  } else if (type === "openai" || type === "openai-compatible") {
    protocol = "openai-responses";
  } else {
    protocol = "openai-chat";
  }

  const apiVariant = resolveApiVariant(providerConfig);
  const capabilities = getApiCapabilities(apiVariant);

  return {
    protocol,
    apiVariant,
    ...capabilities,
  };
}

/**
 * Check if a protocol supports a specific feature.
 */
export function protocolSupportsFeature(
  providerConfig: ProviderConfig,
  feature: keyof Omit<ProtocolRouterConfig, "protocol" | "apiVariant">,
): boolean {
  const routing = routeProtocol(providerConfig);
  return Boolean(routing[feature]);
}
