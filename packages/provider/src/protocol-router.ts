import type { ProviderConfig } from "@omi/core";

import type { ProtocolType } from "./types";

export interface ProtocolRouterConfig {
  protocol: ProtocolType;
  apiVariant: string;
  supportsToolLoop: boolean;
  supportsUsageInStreaming: boolean;
  supportsThinking: boolean;
  supportsPromptCaching: boolean;
  maxConcurrentTools: number;
}

const PROTOCOL_API_VARIANTS: Record<ProtocolType, string[]> = {
  "anthropic-messages": ["anthropic-messages"],
  "openai-responses": ["openai-responses"],
  "openai-chat": ["openai-completions"],
};

const API_CAPABILITIES: Record<string, {
  supportsToolLoop: boolean;
  supportsUsageInStreaming: boolean;
  supportsThinking: boolean;
  supportsPromptCaching: boolean;
  maxConcurrentTools: number;
}> = {
  "anthropic-messages": {
    supportsToolLoop: true,
    supportsUsageInStreaming: true,
    supportsThinking: true,
    supportsPromptCaching: true,
    maxConcurrentTools: 1,
  },
  "anthropic-responses": {
    supportsToolLoop: true,
    supportsUsageInStreaming: true,
    supportsThinking: true,
    supportsPromptCaching: true,
    maxConcurrentTools: 1,
  },
  "openai-responses": {
    supportsToolLoop: true,
    supportsUsageInStreaming: false,
    supportsThinking: false,
    supportsPromptCaching: true,
    maxConcurrentTools: 5,
  },
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

export function getApiCapabilities(apiVariant: string): {
  supportsToolLoop: boolean;
  supportsUsageInStreaming: boolean;
  supportsThinking: boolean;
  supportsPromptCaching: boolean;
  maxConcurrentTools: number;
} {
  return API_CAPABILITIES[apiVariant] ?? API_CAPABILITIES["openai-completions"];
}

export function getSupportedApiVariants(protocol: ProtocolType): string[] {
  return [...PROTOCOL_API_VARIANTS[protocol]];
}

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

