import type { ProviderConfig } from "@omi/core";
import type { ProtocolType } from "./types";

/**
 * Protocol router configuration.
 * Maps protocol + model to pi-ai API configuration.
 *
 * IMPORTANT: All routing decisions are based on explicit providerConfig.protocol.
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
  "anthropic-messages": ["anthropic-messages"],
  "openai-responses": ["openai-responses"],
  "openai-chat": ["openai-completions"],
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
  "mistral-conversations": {
    supportsToolLoop: true,
    supportsUsageInStreaming: false,
    supportsThinking: false,
    supportsPromptCaching: false,
    maxConcurrentTools: 1,
  },
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
};

/**
 * Resolve the API variant for a provider configuration.
 * The API variant is determined by the configured protocol.
 */
export function resolveApiVariant(providerConfig: ProviderConfig): string {
  switch (resolveProtocol(providerConfig)) {
    case "anthropic-messages":
      return "anthropic-messages";
    case "openai-responses":
      return "openai-responses";
    case "openai-chat":
      return "openai-completions";
  }
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
  return [...PROTOCOL_API_VARIANTS[protocol]];
}

/**
 * Route a provider configuration to the appropriate protocol and API variant.
 * Returns the full protocol routing configuration.
 */
export function routeProtocol(providerConfig: ProviderConfig): ProtocolRouterConfig {
  const protocol = resolveProtocol(providerConfig);

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

function resolveProtocol(providerConfig: ProviderConfig): ProtocolType {
  if (providerConfig.protocol === "anthropic-messages") {
    return "anthropic-messages";
  }
  if (providerConfig.protocol === "openai-responses") {
    return "openai-responses";
  }
  if (providerConfig.protocol === "openai-chat") {
    return "openai-chat";
  }
  throw new Error(
    `providerConfig.protocol must be one of anthropic-messages | openai-responses | openai-chat`,
  );
}
