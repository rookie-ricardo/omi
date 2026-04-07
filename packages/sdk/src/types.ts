/**
 * @omi/sdk — SDK types
 *
 * Defines the public-facing types for the Agent SDK, closely aligned with
 * the open-agent-sdk-typescript-main API surface for interoperability.
 */

// ============================================================================
// Message Types
// ============================================================================

export type MessageRole = "user" | "assistant";

export interface ConversationMessage {
	role: MessageRole;
	content: string | ContentBlock[];
}

export interface ContentBlock {
	type: "text" | "tool_use" | "tool_result" | "thinking" | "image";
	text?: string;
	name?: string;
	id?: string;
	input?: unknown;
	thinking?: string;
	// biome-ignore lint/suspicious/noExplicitAny: flexible SDK type
	[key: string]: any;
}

export interface UserMessage {
	type: "user";
	message: ConversationMessage;
	uuid: string;
	timestamp: string;
}

export interface AssistantMessage {
	type: "assistant";
	message: {
		role: "assistant";
		content: ContentBlock[];
	};
	uuid: string;
	timestamp: string;
	usage?: TokenUsage;
	cost?: number;
}

export type Message = UserMessage | AssistantMessage;

// ============================================================================
// SDK Streaming Events (SDKMessage)
// ============================================================================

export type SDKMessage =
	| SDKAssistantMessage
	| SDKToolResultMessage
	| SDKResultMessage
	| SDKPartialMessage
	| SDKSystemMessage
	| SDKCompactBoundaryMessage
	| SDKStatusMessage
	| SDKRateLimitEvent;

export interface SDKAssistantMessage {
	type: "assistant";
	uuid?: string;
	sessionId?: string;
	message: {
		role: "assistant";
		content: ContentBlock[];
	};
	parentToolUseId?: string | null;
}

export interface SDKToolResultMessage {
	type: "tool_result";
	result: {
		toolUseId: string;
		toolName: string;
		output: string;
		isError?: boolean;
	};
}

export interface SDKResultMessage {
	type: "result";
	subtype:
		| "success"
		| "error_max_turns"
		| "error_during_execution"
		| "error_max_budget_usd"
		| string;
	uuid?: string;
	sessionId?: string;
	isError?: boolean;
	numTurns?: number;
	result?: string;
	stopReason?: string | null;
	totalCostUsd?: number;
	durationMs?: number;
	durationApiMs?: number;
	usage?: TokenUsage;
	errors?: string[];
}

export interface SDKPartialMessage {
	type: "partial_message";
	partial: {
		type: "text" | "tool_use";
		text?: string;
		name?: string;
		input?: string;
	};
}

/** Emitted once at session start with initialization info. */
export interface SDKSystemMessage {
	type: "system";
	subtype: "init";
	uuid?: string;
	sessionId: string;
	tools: string[];
	model: string;
	cwd: string;
	permissionMode: string;
}

/** Marks a compaction boundary in the conversation. */
export interface SDKCompactBoundaryMessage {
	type: "system";
	subtype: "compact_boundary";
	summary?: string;
}

/** Status update during long operations. */
export interface SDKStatusMessage {
	type: "system";
	subtype: "status";
	message: string;
}

/** Rate limit event. */
export interface SDKRateLimitEvent {
	type: "system";
	subtype: "rate_limit";
	retryAfterMs?: number;
	message: string;
}

// ============================================================================
// Token Usage
// ============================================================================

export interface TokenUsage {
	inputTokens: number;
	outputTokens: number;
	cacheCreationInputTokens?: number;
	cacheReadInputTokens?: number;
}

// ============================================================================
// Permission Types
// ============================================================================

export type PermissionMode =
	| "default"
	| "acceptEdits"
	| "bypassPermissions"
	| "plan"
	| "auto";

export interface CanUseToolResult {
	behavior: "allow" | "deny" | "ask";
	updatedInput?: unknown;
	message?: string;
}

export type CanUseToolFn = (
	toolName: string,
	input: unknown,
) => Promise<CanUseToolResult>;

// ============================================================================
// MCP Types
// ============================================================================

export type McpServerConfig = McpStdioConfig | McpSseConfig | McpHttpConfig;

export interface McpStdioConfig {
	type?: "stdio";
	command: string;
	args?: string[];
	env?: Record<string, string>;
}

export interface McpSseConfig {
	type: "sse";
	url: string;
	headers?: Record<string, string>;
}

export interface McpHttpConfig {
	type: "http";
	url: string;
	headers?: Record<string, string>;
}

// ============================================================================
// Agent Definition (for custom subagents)
// ============================================================================

export interface AgentDefinition {
	description: string;
	prompt: string;
	tools?: string[];
	disallowedTools?: string[];
	model?: string;
	maxTurns?: number;
}

// ============================================================================
// Thinking Config
// ============================================================================

export interface ThinkingConfig {
	type: "adaptive" | "enabled" | "disabled";
	budgetTokens?: number;
}

// ============================================================================
// Agent Options
// ============================================================================

export interface AgentOptions {
	/** LLM model ID. */
	model?: string;
	/** API key. Falls back to OMI_API_KEY env var. */
	apiKey?: string;
	/** API base URL override. */
	baseURL?: string;
	/** Working directory for file/shell tools. */
	cwd?: string;
	/** System prompt override. */
	systemPrompt?: string;
	/** Append to default system prompt. */
	appendSystemPrompt?: string;
	/** Maximum number of agentic turns per query. */
	maxTurns?: number;
	/** Maximum USD budget per query. */
	maxBudgetUsd?: number;
	/** Extended thinking configuration. */
	thinking?: ThinkingConfig;
	/** Structured output JSON schema. */
	jsonSchema?: Record<string, unknown>;
	/** Permission handler callback. */
	canUseTool?: CanUseToolFn;
	/** Permission mode controlling tool approval behavior. */
	permissionMode?: PermissionMode;
	/** Abort signal for cancellation. */
	abortSignal?: AbortSignal;
	/** Whether to include partial streaming events. */
	includePartialMessages?: boolean;
	/** Environment variables. */
	env?: Record<string, string | undefined>;
	/** Tool names to pre-approve without prompting. */
	allowedTools?: string[];
	/** Tool names to deny. */
	disallowedTools?: string[];
	/** MCP server configurations. */
	mcpServers?: Record<string, McpServerConfig>;
	/** Custom subagent definitions. */
	agents?: Record<string, AgentDefinition>;
	/** Resume a previous session by ID. */
	resume?: string;
	/** Continue the most recent session in cwd. */
	continue?: boolean;
	/** Persist session to disk. */
	persistSession?: boolean;
	/** Explicit session ID. */
	sessionId?: string;
	/** Debug mode. */
	debug?: boolean;

	// ---- Hook System ----
	/** Lifecycle hook configurations. */
	hooks?: Record<
		string,
		Array<{
			matcher?: string;
			command?: string;
			handler?: (
				input: unknown,
				toolUseId: string,
				context: { signal: AbortSignal },
			) => Promise<unknown>;
			timeout?: number;
		}>
	>;
}

// ============================================================================
// Query Result
// ============================================================================

export interface QueryResult {
	/** Final text output from the assistant. */
	text: string;
	/** Token usage across all turns. */
	usage: TokenUsage;
	/** Number of agentic turns. */
	numTurns: number;
	/** Duration in milliseconds. */
	durationMs: number;
	/** Session ID (for resumption). */
	sessionId: string;
	/** All conversation messages. */
	messages: Message[];
	/** Estimated total cost in USD. */
	totalCostUsd?: number;
}
