/**
 * RPC mode: Headless operation with JSON stdin/stdout protocol.
 *
 * Used for embedding the agent in other applications.
 * Receives commands as JSON on stdin, outputs events and responses as JSON on stdout.
 *
 * Protocol:
 * - Commands: JSON objects with `type` field, optional `id` for correlation
 * - Responses: JSON objects with `type: "response"`, `command`, `success`, and optional `data`/`error`
 * - Events: Session events streamed as they occur
 */

import type { AgentSession } from "../../agent-session";
import type { RpcCommand, RpcExtensionUIResponse, RpcResponse, RpcSessionState } from "./rpc-types";
import { attachJsonlLineReader, serializeJsonLine } from "./jsonl";

// Re-export types for consumers
export type { RpcCommand, RpcExtensionUIResponse, RpcResponse, RpcSessionState } from "./rpc-types";

/**
 * Run in RPC mode.
 * Listens for JSON commands on stdin, outputs events and responses on stdout.
 */
export async function runRpcMode(session: AgentSession): Promise<never> {
  const output = (obj: RpcResponse | object): void => {
    process.stdout.write(serializeJsonLine(obj));
  };

  const success = <T extends RpcCommand["type"]>(
    id: string | undefined,
    command: T,
    data?: object | null,
  ): RpcResponse => {
    if (data === undefined) {
      return { id, type: "response", command, success: true } as RpcResponse;
    }
    return { id, type: "response", command, success: true, data } as RpcResponse;
  };

  const error = (id: string | undefined, command: string, message: string): RpcResponse => {
    return { id, type: "response", command, success: false, error: message };
  };

  /**
   * Handle an RPC command and return the response.
   */
  async function handleCommand(cmd: RpcCommand): Promise<RpcResponse> {
    const { id } = cmd;

    try {
      switch (cmd.type) {
        case "prompt": {
          await session.prompt(cmd.message);
          return success(id, "prompt");
        }

        case "abort": {
          await session.abort();
          return success(id, "abort");
        }

        case "new_session": {
          // In omi, creating a new session would require a new AgentSession
          // For now, just return success
          return success(id, "new_session", { cancelled: false });
        }

        case "get_state": {
          const stats = session.getSessionStats();
          const state: RpcSessionState = {
            sessionId: stats.sessionId,
            isStreaming: false, // omi doesn't have streaming like pi-mono
            isCompacting: false,
            messageCount: stats.totalMessages,
            pendingMessageCount: 0,
          };
          return success(id, "get_state", state);
        }

        case "set_model": {
          session.setModel(cmd.modelId);
          return success(id, "set_model");
        }

        case "cycle_model": {
          const result = session.cycleModel();
          return success(id, "cycle_model", result ? { modelId: result.modelId } : null);
        }

        case "get_available_models": {
          // Would need provider support to enumerate available models
          return success(id, "get_available_models", { models: [] });
        }

        case "bash": {
          // Bash execution is handled separately via bash-executor module
          // Not available directly on AgentSession in omi architecture
          return error(id!, "bash", "Bash execution not available via RPC. Use tool execution instead.");
        }

        case "abort_bash": {
          session.abortBash();
          return success(id, "abort_bash");
        }

        case "get_session_stats": {
          const stats = session.getSessionStats();
          return success(id, "get_session_stats", stats);
        }

        case "switch_session": {
          // Would need session management support
          return success(id, "switch_session", { cancelled: true });
        }

        case "fork": {
          const result = await session.fork(cmd.historyEntryId);
          return success(id, "fork", result);
        }

        case "get_fork_messages": {
          // Would need to get messages for forking UI
          return success(id, "get_fork_messages", { messages: [] });
        }

        case "steer": {
          await session.steer(cmd.message);
          return success(id, "steer");
        }

        case "follow_up": {
          await session.followUp(cmd.message);
          return success(id, "follow_up");
        }

        default:
          return error(id!, (cmd as RpcCommand).type, "Unknown command");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return error(id!, (cmd as RpcCommand).type, message);
    }
  }

  // Output ready message
  output({ type: "rpc_ready" });

  // Process commands from stdin
  const commandStream = attachJsonlLineReader(process.stdin);

  for await (const command of commandStream) {
    if (command && typeof command === "object" && "type" in command) {
      const response = await handleCommand(command as RpcCommand);
      output(response);
    }
  }

  // Should never reach here in normal operation
  return undefined as never;
}
