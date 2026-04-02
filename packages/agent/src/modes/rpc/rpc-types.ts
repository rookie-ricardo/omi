/**
 * RPC protocol types for headless operation.
 *
 * Commands are sent as JSON lines on stdin.
 * Responses and events are emitted as JSON lines on stdout.
 */

// ============================================================================
// RPC Commands (stdin)
// ============================================================================

export type RpcCommand =
  // Prompting
  | { id?: string; type: "prompt"; message: string; streamingBehavior?: "steer" | "followUp" }
  | { id?: string; type: "steer"; message: string }
  | { id?: string; type: "follow_up"; message: string }
  | { id?: string; type: "abort" }
  | { id?: string; type: "new_session"; parentSession?: string }

  // State
  | { id?: string; type: "get_state" }

  // Model
  | { id?: string; type: "set_model"; modelId: string }
  | { id?: string; type: "cycle_model" }
  | { id?: string; type: "get_available_models" }

  // Bash
  | { id?: string; type: "bash"; command: string }
  | { id?: string; type: "abort_bash" }

  // Session
  | { id?: string; type: "get_session_stats" }
  | { id?: string; type: "switch_session"; sessionPath: string }
  | { id?: string; type: "fork"; historyEntryId: string }
  | { id?: string; type: "get_fork_messages" };

// ============================================================================
// RPC Slash Command (for get_commands response)
// ============================================================================

/** A command available for invocation via prompt */
export interface RpcSlashCommand {
  name: string;
  description?: string;
  source: "extension" | "prompt" | "skill";
  location?: "user" | "project" | "path";
  path?: string;
}

// ============================================================================
// RPC State
// ============================================================================

export interface RpcSessionState {
  sessionId: string;
  isStreaming: boolean;
  isCompacting: boolean;
  sessionFile?: string;
  messageCount: number;
  pendingMessageCount: number;
}

// ============================================================================
// RPC Responses (stdout)
// ============================================================================

export type RpcResponse =
  // Prompting
  | { id?: string; type: "response"; command: "prompt"; success: true }
  | { id?: string; type: "response"; command: "steer"; success: true }
  | { id?: string; type: "response"; command: "follow_up"; success: true }
  | { id?: string; type: "response"; command: "abort"; success: true }
  | { id?: string; type: "response"; command: "new_session"; success: true; data: { cancelled: boolean } }

  // State
  | { id?: string; type: "response"; command: "get_state"; success: true; data: RpcSessionState }

  // Model
  | { id?: string; type: "response"; command: "set_model"; success: true }
  | { id?: string; type: "response"; command: "cycle_model"; success: true; data: { modelId: string } | null }
  | { id?: string; type: "response"; command: "get_available_models"; success: true; data: { models: string[] } }

  // Bash
  | { id?: string; type: "response"; command: "bash"; success: true; data: { output: string; exitCode: number } }
  | { id?: string; type: "response"; command: "abort_bash"; success: true }

  // Session
  | { id?: string; type: "response"; command: "get_session_stats"; success: true; data: { sessionId: string; runs: number } }
  | { id?: string; type: "response"; command: "switch_session"; success: true; data: { cancelled: boolean } }
  | { id?: string; type: "response"; command: "fork"; success: true; data: { newSessionId: string; selectedText: string } }
  | { id?: string; type: "response"; command: "get_fork_messages"; success: true; data: { messages: Array<{ entryId: string; text: string }> } }

  // Error response
  | { id?: string; type: "response"; command: string; success: false; error: string };

// ============================================================================
// Extension UI Events (stdout)
// ============================================================================

/** Emitted when an extension needs user input */
export type RpcExtensionUIRequest =
  | { type: "extension_ui_request"; id: string; method: "select"; title: string; options: string[] }
  | { type: "extension_ui_request"; id: string; method: "confirm"; title: string; message: string }
  | { type: "extension_ui_request"; id: string; method: "input"; title: string; placeholder?: string }
  | { type: "extension_ui_request"; id: string; method: "notify"; message: string; notifyType?: "info" | "warning" | "error" };

// ============================================================================
// Extension UI Commands (stdin)
// ============================================================================

/** Response to an extension UI request */
export type RpcExtensionUIResponse =
  | { type: "extension_ui_response"; id: string; value: string }
  | { type: "extension_ui_response"; id: string; confirmed: boolean }
  | { type: "extension_ui_response"; id: string; cancelled: true };

// ============================================================================
// Helper type for extracting command types
// ============================================================================

export type RpcCommandType = RpcCommand["type"];
