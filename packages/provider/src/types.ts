export type ToolName = string;

export type ProtocolType = "openai-chat" | "openai-responses" | "anthropic-messages";

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

export type ModelErrorClass =
  | "network"
  | "rate_limit"
  | "auth"
  | "prompt_too_long"
  | "max_output"
  | "tool_error"
  | "cancelled"
  | "unknown";

export type ModelStopReason =
  | "end_turn"
  | "max_tokens"
  | "stop_sequence"
  | "content_filter"
  | "error";

export interface ToolPreflightDecision {
  decision: "allow" | "ask" | "deny";
  reason: string | null;
}
