/**
 * @omi/sdk — thin SDK surface
 */

export type MessageRole = "user" | "assistant";

export interface ContentBlock {
  type: "text";
  text: string;
}

export interface ConversationMessage {
  role: MessageRole;
  content: string;
}

export interface UserMessage {
  type: "user";
  message: ConversationMessage;
  uuid: string;
  timestamp: string;
}

export interface AssistantMessage {
  type: "assistant";
  message: ConversationMessage;
  uuid: string;
  timestamp: string;
  usage?: TokenUsage;
}

export type Message = UserMessage | AssistantMessage;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

export interface SDKAssistantMessage {
  type: "assistant";
  sessionId?: string;
  message: {
    role: "assistant";
    content: ContentBlock[];
  };
}

export interface SDKResultMessage {
  type: "result";
  subtype: "success" | "error_during_execution";
  isError?: boolean;
  numTurns?: number;
  result?: string;
  stopReason?: string | null;
  durationMs?: number;
  usage?: TokenUsage;
  errors?: string[];
}

export interface SDKSystemMessage {
  type: "system";
  subtype: "init";
  sessionId: string;
  model: string;
  cwd: string;
  permissionMode: "default" | "full-access";
}

export type SDKMessage = SDKAssistantMessage | SDKResultMessage | SDKSystemMessage;

export type PermissionMode = "default" | "full-access";

export interface CanUseToolResult {
  behavior: "allow" | "deny" | "ask";
  message?: string;
}

export type CanUseToolFn = (
  toolName: string,
  input: unknown,
) => Promise<CanUseToolResult>;

export interface AgentOptions {
  model?: string;
  apiKey?: string;
  baseURL?: string;
  /** Default: anthropic-messages */
  protocol?: "anthropic-messages" | "openai-chat" | "openai-responses";
  cwd?: string;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  permissionMode?: PermissionMode;
  abortSignal?: AbortSignal;
  canUseTool?: CanUseToolFn;
  env?: Record<string, string | undefined>;
}

export interface QueryResult {
  text: string;
  usage: TokenUsage;
  numTurns: number;
  durationMs: number;
  sessionId: string;
  messages: Message[];
}
