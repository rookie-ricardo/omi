export interface ProviderDefaults {
  name: string;
  baseUrl: string;
  model: string;
}

export function getProviderDefaults(providerType: string): ProviderDefaults {
  switch (providerType) {
    case "anthropic":
      return {
        name: "Anthropic",
        baseUrl: "https://api.anthropic.com",
        model: "claude-sonnet-4-20250514",
      };
    case "openai":
      return {
        name: "OpenAI",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4.1-mini",
      };
    case "openrouter":
      return {
        name: "OpenRouter",
        baseUrl: "https://openrouter.ai/api/v1",
        model: "openai/gpt-4o-mini",
      };
    case "openai-compatible":
      return {
        name: "OpenAI Compatible",
        baseUrl: "",
        model: "gpt-4.1-mini",
      };
    case "anthropic-compatible":
      return {
        name: "Anthropic Compatible",
        baseUrl: "",
        model: "claude-sonnet-4-20250514",
      };
    default:
      return {
        name: providerType,
        baseUrl: "",
        model: "claude-sonnet-4-20250514",
      };
  }
}
