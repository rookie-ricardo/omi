/**
 * @omi/sdk
 *
 * Thin agent SDK surface for OMI.
 * Provides createAgent(), query(), and streaming SDKMessage events
 * backed directly by provider runtimes.
 */

// --------------------------------------------------------------------------
// High-level Agent API
// --------------------------------------------------------------------------

export { Agent, createAgent, query } from "./agent.js";

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export type {
  Message,
  UserMessage,
  AssistantMessage,
  ConversationMessage,
  MessageRole,
  ContentBlock,
  SDKMessage,
  SDKAssistantMessage,
  SDKResultMessage,
  SDKSystemMessage,
  PermissionMode,
  CanUseToolFn,
  CanUseToolResult,
  AgentOptions,
  QueryResult,
  TokenUsage,
} from "./types.js";
