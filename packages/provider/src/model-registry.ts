import { getModels, getProviders, type KnownProvider, type Model } from "@mariozechner/pi-ai";

import type { ProviderConfig } from "@omi/core";

export function createModelFromConfig(config: ProviderConfig): Model<any> {
  if (config.type === "openai-compatible") {
    return createOpenAiCompatibleModel(config);
  }

  if (config.type === "anthropic-compatible") {
    return createAnthropicCompatibleModel(config);
  }

  if (isBuiltInProvider(config.type)) {
    return createBuiltInModel(config);
  }

  throw new Error(
    `Unsupported provider type: ${config.type}. Supported built-in providers: ${getProviders().join(", ")}. Compatible types: openai-compatible, anthropic-compatible.`,
  );
}

export function isBuiltInProvider(provider: string): provider is KnownProvider {
  return getProviders().includes(provider as KnownProvider);
}

export function listBuiltInProviders(): KnownProvider[] {
  return getProviders();
}

export function listBuiltInModels(provider: string): Model<any>[] {
  if (!isBuiltInProvider(provider)) {
    throw new Error(`Provider ${provider} is not a built-in pi-ai provider.`);
  }

  return getModels(provider);
}

function createBuiltInModel(config: ProviderConfig): Model<any> {
  const providerType = config.type as KnownProvider;
  const model = getModels(providerType).find((entry) => entry.id === config.model);
  if (!model) {
    const availableModels = getModels(providerType)
      .map((entry) => entry.id)
      .join(", ");
    throw new Error(
      `Model ${config.model} is not available for provider ${config.type}. Available models: ${availableModels}.`,
    );
  }

  return {
    ...model,
    name: config.name.trim() || model.name,
    baseUrl: config.baseUrl.trim() || model.baseUrl,
  };
}

function createOpenAiCompatibleModel(config: ProviderConfig): Model<any> {
  return {
    id: config.model,
    name: config.name.trim() || config.model,
    api: "openai-completions",
    provider: config.type,
    baseUrl: requireCompatibleBaseUrl(config),
    reasoning: inferOpenAiCompatibleReasoning(config.model),
    input: ["text"],
    cost: zeroCost(),
    contextWindow: 128_000,
    maxTokens: 16_384,
  };
}

function createAnthropicCompatibleModel(config: ProviderConfig): Model<any> {
  return {
    id: config.model,
    name: config.name.trim() || config.model,
    api: "anthropic-messages",
    provider: config.type,
    baseUrl: requireCompatibleBaseUrl(config),
    reasoning: true,
    input: ["text", "image"],
    cost: zeroCost(),
    contextWindow: 200_000,
    maxTokens: 8_192,
  };
}

function requireCompatibleBaseUrl(config: ProviderConfig): string {
  const baseUrl = config.baseUrl.trim();
  if (!baseUrl) {
    throw new Error(`Provider ${config.type} requires a non-empty baseUrl.`);
  }
  return baseUrl;
}

function inferOpenAiCompatibleReasoning(modelId: string): boolean {
  return /gpt-5|gpt-oss|o1|o3|o4|reason|r1|qwen3|qwen-3/i.test(modelId);
}

function zeroCost() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  };
}
