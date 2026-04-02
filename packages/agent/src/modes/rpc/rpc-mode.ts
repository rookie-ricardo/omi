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
import { getLogger } from "../../logger";

const logger = getLogger("rpc-mode");

// Re-export types for consumers
export type { RpcCommand, RpcExtensionUIResponse, RpcResponse, RpcSessionState } from "./rpc-types";

/**
 * Run in RPC mode.
 * Listens for JSON commands on stdin, outputs events and responses on stdout.
 */
export async function runRpcMode(session: AgentSession): Promise<never> {
  logger.info("RPC mode starting");
  const startTime = Date.now();
  let commandCount = 0;
  let errorCount = 0;

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
    logger.warn("RPC command error", { command, error: message, id });
    return { id, type: "response", command, success: false, error: message };
  };

  /**
   * Handle an RPC command and return the response.
   */
  async function handleCommand(cmd: RpcCommand): Promise<RpcResponse> {
    const { id } = cmd;
    const cmdStartTime = Date.now();
    commandCount++;

    logger.debug("RPC command received", { command: cmd.type, id });

    try {
      switch (cmd.type) {
        case "prompt": {
          await session.prompt(cmd.message);
          logger.debug("RPC prompt handled", { id, durationMs: Date.now() - cmdStartTime });
          return success(id, "prompt");
        }

        case "abort": {
          await session.abort();
          logger.info("RPC abort handled", { id, durationMs: Date.now() - cmdStartTime });
          return success(id, "abort");
        }

        case "new_session": {
          logger.debug("RPC new_session handled", { id });
          return success(id, "new_session", { cancelled: false });
        }

        case "get_state": {
          const stats = session.getSessionStats();
          const state: RpcSessionState = {
            sessionId: stats.sessionId,
            isStreaming: false,
            isCompacting: false,
            messageCount: stats.totalMessages,
            pendingMessageCount: 0,
          };
          return success(id, "get_state", state);
        }

        case "set_model": {
          session.setModel(cmd.modelId);
          logger.info("RPC set_model handled", { modelId: cmd.modelId, id });
          return success(id, "set_model");
        }

        case "cycle_model": {
          const result = session.cycleModel();
          logger.debug("RPC cycle_model handled", { id, hasResult: !!result });
          return success(id, "cycle_model", result ? { modelId: result.modelId } : null);
        }

        case "get_available_models": {
          return success(id, "get_available_models", { models: [] });
        }

        case "bash": {
          logger.warn("RPC bash command not available", { id });
          return error(id!, "bash", "Bash execution not available via RPC. Use tool execution instead.");
        }

        case "abort_bash": {
          session.abortBash();
          logger.info("RPC abort_bash handled", { id });
          return success(id, "abort_bash");
        }

        case "get_session_stats": {
          const stats = session.getSessionStats();
          return success(id, "get_session_stats", stats);
        }

        case "switch_session": {
          return success(id, "switch_session", { cancelled: true });
        }

        case "fork": {
          const result = await session.fork(cmd.historyEntryId);
          logger.info("RPC fork handled", { historyEntryId: cmd.historyEntryId, id });
          return success(id, "fork", result);
        }

        case "get_fork_messages": {
          return success(id, "get_fork_messages", { messages: [] });
        }

        case "steer": {
          await session.steer(cmd.message);
          logger.debug("RPC steer handled", { id });
          return success(id, "steer");
        }

        case "follow_up": {
          await session.followUp(cmd.message);
          logger.debug("RPC follow_up handled", { id });
          return success(id, "follow_up");
        }

        default:
          logger.warn("RPC unknown command", { command: (cmd as RpcCommand).type, id });
          return error(id!, (cmd as RpcCommand).type, "Unknown command");
      }
    } catch (err) {
      errorCount++;
      const message = err instanceof Error ? err.message : String(err);
      logger.errorWithError("RPC command handler error", err, { command: cmd.type, id });
      return error(id!, (cmd as RpcCommand).type, message);
    }
  }

  // Output ready message
  logger.info("RPC mode ready");
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
  logger.info("RPC mode shutting down", {
    durationMs: Date.now() - startTime,
    commandCount,
    errorCount,
  });
  return undefined as never;
}
