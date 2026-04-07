/**
 * Hook System — Type Definitions
 *
 * Lifecycle hooks for intercepting agent behavior.
 * Aligned with claude-code-main and open-agent-sdk hook event surfaces.
 */

// ============================================================================
// Hook Events
// ============================================================================

export const HOOK_EVENTS = [
	"PreToolUse",
	"PostToolUse",
	"PostToolUseFailure",
	"SessionStart",
	"SessionEnd",
	"Stop",
	"SubagentStart",
	"SubagentStop",
	"UserPromptSubmit",
	"PermissionRequest",
	"PermissionDenied",
	"TaskCreated",
	"TaskCompleted",
	"ConfigChange",
	"CwdChanged",
	"FileChanged",
	"Notification",
	"PreCompact",
	"PostCompact",
	"TeammateIdle",
] as const;

export type HookEvent = typeof HOOK_EVENTS[number];

// ============================================================================
// Hook Definition
// ============================================================================

/**
 * A hook can be either a shell command or a programmatic handler.
 *
 * - `command`: Shell command to run. Input is piped via stdin (JSON).
 *              Output (stdout) is parsed as JSON → HookOutput.
 *              Non-JSON stdout is treated as a message string.
 * - `handler`: Async function that receives HookInput and returns HookOutput.
 * - `matcher`: Regex pattern matched against `toolName` for tool-specific hooks.
 *              If the pattern does not match, the hook is skipped.
 * - `timeout`: Maximum execution time in milliseconds (default: 30000).
 */
export interface HookDefinition {
	command?: string;
	handler?: (input: HookInput) => Promise<HookOutput | void>;
	matcher?: string;
	timeout?: number;
}

// ============================================================================
// Hook Input / Output
// ============================================================================

/**
 * Context data passed to hook handlers.
 */
export interface HookInput {
	/** Which event triggered this hook. */
	event: HookEvent;
	/** Tool name (for Pre/PostToolUse). */
	toolName?: string;
	/** Tool input parameters (for PreToolUse). */
	toolInput?: unknown;
	/** Tool output/result (for PostToolUse). */
	toolOutput?: unknown;
	/** Tool use ID from the model response. */
	toolUseId?: string;
	/** Current session ID. */
	sessionId?: string;
	/** Working directory. */
	cwd?: string;
	/** Error message (for failure hooks). */
	error?: string;
	/** Additional context. */
	[key: string]: unknown;
}

/**
 * Result returned by hook handlers to influence agent behavior.
 */
export interface HookOutput {
	/** Message to inject into the conversation. */
	message?: string;
	/** Permission update: allow or deny a tool for this session. */
	permissionUpdate?: {
		tool: string;
		behavior: "allow" | "deny";
	};
	/** Whether to block the current action (e.g., PreToolUse can block execution). */
	block?: boolean;
	/** Reason for blocking (included in tool error response). */
	blockReason?: string;
	/** Modified tool input (for PreToolUse — allows input rewriting). */
	modifiedInput?: unknown;
	/** Notification to display. */
	notification?: {
		title: string;
		body: string;
		level?: "info" | "warning" | "error";
	};
}

// ============================================================================
// Hook Config (from settings)
// ============================================================================

/**
 * Hook configuration as typically provided in user settings / CLAUDE.toml.
 * Maps hook event names to arrays of hook definitions.
 *
 * @example
 * ```json
 * {
 *   "PreToolUse": [
 *     { "matcher": "bash", "command": "~/hooks/validate-bash.sh" }
 *   ],
 *   "PostToolUse": [
 *     { "handler": async (input) => { console.log(input.toolName) } }
 *   ]
 * }
 * ```
 */
export type HookConfig = Record<string, HookDefinition[]>;
