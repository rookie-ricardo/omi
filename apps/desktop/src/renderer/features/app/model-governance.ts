import type { ProviderConfig } from "@omi/core";
import type { ModelListResult, SessionRuntimeGetResult } from "@omi/protocol";

export interface ProviderDraft {
  id?: string;
  type: string;
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface ProviderTypeOption {
  value: string;
  label: string;
  defaultBaseUrl: string;
  defaultModel: string;
}

export function buildSessionModelOptions(
  modelList: ModelListResult | undefined,
  runtime: SessionRuntimeGetResult | undefined,
): ProviderConfig[] {
  const providerConfigs = modelList?.providerConfigs ?? [];
  if (providerConfigs.length === 0) {
    return [];
  }

  const selectedProviderConfigId = runtime?.runtime.selectedProviderConfigId;
  if (!selectedProviderConfigId) {
    return providerConfigs;
  }

  const selectedProviderConfig =
    providerConfigs.find((config) => config.id === selectedProviderConfigId) ?? null;
  if (!selectedProviderConfig) {
    return providerConfigs;
  }

  return [
    selectedProviderConfig,
    ...providerConfigs.filter((config) => config.id !== selectedProviderConfig.id),
  ];
}

export function resolveSessionModel(
  modelList: ModelListResult | undefined,
  runtime: SessionRuntimeGetResult | undefined,
): ProviderConfig | null {
  const providerConfigs = modelList?.providerConfigs ?? [];
  if (providerConfigs.length === 0) {
    return null;
  }

  const selectedProviderConfigId = runtime?.runtime.selectedProviderConfigId;
  if (selectedProviderConfigId) {
    const selectedProviderConfig =
      providerConfigs.find((config) => config.id === selectedProviderConfigId) ?? null;
    if (selectedProviderConfig) {
      return selectedProviderConfig;
    }
  }

  return providerConfigs[0] ?? null;
}

export function formatProviderConfigLabel(providerConfig: ProviderConfig | null): string {
  if (!providerConfig) {
    return "未配置模型";
  }

  const name = providerConfig.name.trim();
  const model = providerConfig.model.trim();

  if (name && model && name !== model) {
    return `${name} · ${model}`;
  }

  return name || model || "未命名模型";
}

export function buildProviderTypeOptions(
  modelList: ModelListResult | undefined,
): ProviderTypeOption[] {
  const builtIn = (modelList?.builtInProviders ?? []).map((provider) => ({
    value: provider.provider,
    label: providerLabel(provider.provider),
    defaultBaseUrl: provider.models[0]?.baseUrl ?? "",
    defaultModel: provider.models[0]?.id ?? "",
  }));

  const compatible = [
    {
      value: "openai-compatible",
      label: providerLabel("openai-compatible"),
      defaultBaseUrl: "",
      defaultModel: "gpt-4.1-mini",
    },
    {
      value: "anthropic-compatible",
      label: providerLabel("anthropic-compatible"),
      defaultBaseUrl: "",
      defaultModel: "claude-sonnet-4-20250514",
    },
  ];

  const seen = new Set<string>();
  return [...builtIn, ...compatible].filter((option) => {
    if (seen.has(option.value)) {
      return false;
    }
    seen.add(option.value);
    return true;
  });
}

export function createProviderDraft(
  providerType: string,
  modelList: ModelListResult | undefined,
): ProviderDraft {
  const option =
    buildProviderTypeOptions(modelList).find((entry) => entry.value === providerType) ??
    buildProviderTypeOptions(modelList)[0] ??
    {
      value: providerType,
      label: providerLabel(providerType),
      defaultBaseUrl: "",
      defaultModel: "",
    };

  return {
    type: option.value,
    baseUrl: option.defaultBaseUrl,
    model: option.defaultModel,
    apiKey: "",
  };
}

export function createProviderDraftFromConfig(providerConfig: ProviderConfig): ProviderDraft {
  return {
    id: providerConfig.id,
    type: providerConfig.type,
    baseUrl: providerConfig.baseUrl,
    model: providerConfig.model,
    apiKey: providerConfig.apiKey,
  };
}

export function providerLabel(providerType: string): string {
  switch (providerType) {
    case "openai":
      return "OpenAI";
    case "anthropic":
      return "Anthropic";
    case "openrouter":
      return "OpenRouter";
    case "openai-compatible":
      return "OpenAI Compatible";
    case "anthropic-compatible":
      return "Anthropic Compatible";
    default:
      return providerType;
  }
}
