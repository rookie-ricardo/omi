/**
 * @omi/sdk
 *
 * High-level Agent SDK for OMI.
 * Provides createAgent(), query(), and streaming SDKMessage events.
 *
 * Features:
 * - Full agentic loop with 20+ built-in tools
 * - MCP server integration (stdio, SSE, HTTP)
 * - Context compression (auto-compact, overflow recovery)
 * - Retry with exponential backoff (RecoveryEngine)
 * - Git status & project context injection
 * - Multi-turn session persistence (SQLite)
 * - Permission system (allow/deny/ask modes)
 * - Subagent spawning & multi-agent coordination
 * - Task management & scheduling
 * - Plan mode for structured workflows
 * - Worktree mode for isolated git work
 * - Token estimation & cost tracking
 */

// --------------------------------------------------------------------------
// High-level Agent API
// --------------------------------------------------------------------------

export { Agent, createAgent, query } from "./agent.js";

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export type {
	// Message types
	Message,
	UserMessage,
	AssistantMessage,
	ConversationMessage,
	MessageRole,
	ContentBlock,

	// SDK message types (streaming events)
	SDKMessage,
	SDKAssistantMessage,
	SDKToolResultMessage,
	SDKResultMessage,
	SDKPartialMessage,
	SDKSystemMessage,
	SDKCompactBoundaryMessage,
	SDKStatusMessage,
	SDKRateLimitEvent,

	// Permission types
	PermissionMode,
	CanUseToolFn,
	CanUseToolResult,

	// MCP types
	McpServerConfig,
	McpStdioConfig,
	McpSseConfig,
	McpHttpConfig,

	// Agent types
	AgentOptions,
	AgentDefinition,
	QueryResult,
	ThinkingConfig,
	TokenUsage,
} from "./types.js";
