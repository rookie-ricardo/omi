import { resolve } from "node:path";

import { AppOrchestrator } from "@omi/agent";
import { createAppDatabase } from "@omi/store";
import { createId } from "@omi/core";
import { type RpcRequest, rpcRequestSchema } from "@omi/protocol";
import { getLogger } from "@omi/agent";

import { normalizeResult } from "./protocol";
import { handleRunnerRequest } from "./request-handler";

const logger = getLogger("runner:main");

const workspaceRoot = resolve(readWorkspaceRootFromArgs() ?? process.cwd());
logger.info("Runner starting", { workspaceRoot });

const database = createAppDatabase(resolve(workspaceRoot, "workspace-data", "app.db"));
const orchestrator = new AppOrchestrator(database, workspaceRoot, emitEvent);

logger.info("Runner initialized");

function readWorkspaceRootFromArgs(): string | null {
  const index = process.argv.findIndex((argument) => argument === "--workspace-root");
  if (index < 0) {
    return null;
  }

  const value = process.argv[index + 1];
  return typeof value === "string" && value.trim() ? value : null;
}

process.on("message", async (message) => {
  try {
    const request = rpcRequestSchema.parse(message);
    logger.debug("Runner received message", { method: request.method, id: request.id });
    const result = await handleRequest(request);
    const normalizedResult = normalizeResult(request.method, result);
    process.send?.({
      id: request.id,
      ok: true,
      result: normalizedResult,
    });
  } catch (error) {
    logger.errorWithError("Runner message handler error", error);
    process.send?.({
      id:
        typeof message === "object" && message && "id" in message
          ? (message as { id: string }).id
          : createId("rpc"),
      ok: false,
      error: {
        code: "RUNNER_ERROR",
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
});

async function handleRequest(request: RpcRequest): Promise<unknown> {
  return handleRunnerRequest(orchestrator, request);
}

function emitEvent(event: { type: string; payload: Record<string, unknown> }) {
  logger.debug("Runner emitting event", { eventType: event.type });
  process.send?.({
    type: "event",
    event,
  });
}
