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
    case "google":
      return {
        name: "Google (Gemini)",
        baseUrl: "https://generativelanguage.googleapis.com",
        model: "gemini-2.0-flash-exp",
      };
    case "bedrock":
      return {
        name: "Amazon Bedrock",
        baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
        model: "anthropic.claude-sonnet-4-20250514-v1:0",
      };
    case "azure":
      return {
        name: "Azure OpenAI",
        baseUrl: "https://{resource}.openai.azure.com",
        model: "gpt-4o",
      };
    case "mistral":
      return {
        name: "Mistral AI",
        baseUrl: "https://api.mistral.ai",
        model: "mistral-large-latest",
      };
    case "xai":
      return {
        name: "xAI (Grok)",
        baseUrl: "https://api.x.ai",
        model: "grok-3",
      };
    case "groq":
      return {
        name: "Groq",
        baseUrl: "https://api.groq.com/openai/v1",
        model: "llama-3.3-70b-versatile",
      };
    case "cerebras":
      return {
        name: "Cerebras",
        baseUrl: "https://api.cerebras.ai/v1",
        model: "llama-3.3-70b",
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

export * from "./settings-manager";
