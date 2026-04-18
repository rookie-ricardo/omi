import { resolve } from "node:path";

import { AppOrchestrator, type LogEntry, type LogLevel, getLogger, setGlobalLoggerConfig } from "@omi/agent";
import { createAppDatabase } from "@omi/store";
import { createId } from "@omi/core";
import { type RpcRequest, rpcRequestSchema } from "@omi/core";

import { normalizeResult } from "./protocol";
import { collectRunEventDeliveries, handleRunnerRequest, RunnerCommandError } from "./request-handler";
import { assertWorkspaceDistFreshness } from "./dist-guard";

// ---------------------------------------------------------------------------
// Logger → IPC bridge
// Install a global handler that forwards log entries to the desktop renderer
// through the existing emitEvent IPC pipeline. Must run before any getLogger().
// ---------------------------------------------------------------------------

let runnerEmitEvent: ((event: { type: string; payload: Record<string, unknown> }) => void) | null = null;
let forwardDebugLogs = false;

const LEVEL_PRIORITY: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

setGlobalLoggerConfig({
	handler(entry: LogEntry) {
		// 1. Preserve console output
		const prefix = `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.component}]`;
		const contextStr = entry.context ? ` ${JSON.stringify(entry.context)}` : "";
		switch (entry.level) {
			case "debug": console.debug(prefix, entry.message, contextStr); break;
			case "info":  console.info(prefix, entry.message, contextStr);  break;
			case "warn":  console.warn(prefix, entry.message, contextStr);  break;
			case "error": console.error(prefix, entry.message, contextStr); break;
		}

		// 2. Forward to IPC (skip debug unless explicitly enabled)
		if (!runnerEmitEvent) return;
		if (LEVEL_PRIORITY[entry.level] < (forwardDebugLogs ? 0 : 1)) return;

		runnerEmitEvent({
			type: "log.entry",
			payload: {
				timestamp: entry.timestamp,
				level: entry.level,
				component: entry.component,
				message: entry.message,
				context: entry.context ?? {},
			},
		});
	},
});

export function setForwardDebugLogs(enable: boolean) {
	forwardDebugLogs = enable;
}

const logger = getLogger("runner:main");

const workspaceRoot = resolve(readWorkspaceRootFromArgs() ?? process.cwd());
assertWorkspaceDistFreshness(workspaceRoot);
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
    const errorCode = error instanceof RunnerCommandError
      ? error.code
      : "RUNNER_ERROR";
    process.send?.({
      id:
        typeof message === "object" && message && "id" in message
          ? (message as { id: string }).id
          : createId("rpc"),
      ok: false,
      error: {
        code: errorCode,
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

  const deliveries = collectRunEventDeliveries(event.type, event.payload);
  for (const delivery of deliveries) {
    process.send?.({
      type: "run.event",
      event: delivery,
    });
  }

  process.send?.({
    type: "event",
    event,
  });
}

// Wire the logger handler to the emit function
runnerEmitEvent = emitEvent;
