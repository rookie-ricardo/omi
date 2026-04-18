import type { AppOrchestrator } from "@omi/agent";
import { createId, nowIso } from "@omi/core";
import type { RpcRequest, RunnerCommandName } from "@omi/core";
import { parseCommand } from "@omi/core";

type RunnerRequestOrchestrator = Pick<
  AppOrchestrator,
  | "createSession"
  | "updateSessionTitle"
  | "listSessions"
  | "getSessionDetail"
  | "getSessionRuntimeState"
  | "getGitStatus"
  | "getGitDiff"
  | "startRun"
  | "cancelRun"
  | "approveTool"
  | "rejectTool"
  | "listPendingToolCalls"
  | "listToolCalls"
  | "setSessionWorkspaceRoot"
  | "setSessionPermissionMode"
  | "switchModel"
  | "saveProviderConfig"
  | "deleteProviderConfig"
  | "listModels"
>;

export class RunnerCommandError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RunnerCommandError";
  }
}

type RunEventSubscription = {
  subscriptionId: string;
  events: string[];
  createdAt: string;
};

export interface RunEventDelivery {
  runId: string;
  subscriptionId: string;
  event: string;
  payload: Record<string, unknown>;
  deliveredAt: string;
}

const runEventSubscriptions = new Map<string, RunEventSubscription[]>();

export const SUPPORTED_COMMANDS: RunnerCommandName[] = [
  "session.create",
  "session.list",
  "session.get",
  "session.title.update",
  "session.runtime.get",
  "session.workspace.set",
  "session.permission.set",
  "session.model.switch",
  "run.start",
  "run.cancel",
  "run.events.subscribe",
  "run.events.unsubscribe",
  "tool.approve",
  "tool.reject",
  "tool.pending.list",
  "tool.list",
  "provider.config.save",
  "provider.config.delete",
  "model.list",
  "git.status",
  "git.diff",
];

export async function handleRunnerRequest(
  orchestrator: RunnerRequestOrchestrator,
  request: RpcRequest,
): Promise<unknown> {
  let params: Record<string, unknown>;
  try {
    params = parseCommand(request.method as RunnerCommandName, request.params) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Unsupported command:")) {
      throw new RunnerCommandError("UNSUPPORTED_COMMAND", error.message);
    }
    throw error;
  }
  return executeCommand(orchestrator, request.method as RunnerCommandName, params);
}

async function executeCommand(
  orchestrator: RunnerRequestOrchestrator,
  method: RunnerCommandName,
  params: Record<string, unknown>,
): Promise<unknown> {
  switch (method) {
    case "session.create":
      return orchestrator.createSession(String(params.title));
    case "session.list":
      return orchestrator.listSessions();
    case "session.get":
      return orchestrator.getSessionDetail(String(params.sessionId));
    case "session.title.update":
      return orchestrator.updateSessionTitle(String(params.sessionId), String(params.title));
    case "session.runtime.get": {
      const sessionId = String(params.sessionId);
      return {
        sessionId,
        runtime: orchestrator.getSessionRuntimeState(sessionId),
      };
    }
    case "session.workspace.set":
      return orchestrator.setSessionWorkspaceRoot(
        String(params.sessionId),
        typeof params.workspaceRoot === "string" ? params.workspaceRoot : null,
      );
    case "session.permission.set":
      return orchestrator.setSessionPermissionMode(
        String(params.sessionId),
        String(params.mode) as "default" | "yolo",
      );
    case "session.model.switch":
      return orchestrator.switchModel(String(params.sessionId), String(params.providerConfigId));

    case "run.start":
      return orchestrator.startRun({
        sessionId: String(params.sessionId),
        taskId: params.taskId ? String(params.taskId) : null,
        prompt: String(params.prompt),
        contextFiles: Array.isArray(params.contextFiles)
          ? params.contextFiles.map((entry) => String(entry))
          : undefined,
      });
    case "run.cancel":
      return orchestrator.cancelRun(String(params.runId));
    case "run.events.subscribe":
      return subscribeRunEvents(
        String(params.runId),
        Array.isArray(params.events) ? params.events.map((eventName) => String(eventName)) : [],
      );
    case "run.events.unsubscribe":
      return unsubscribeRunEvents(String(params.runId), String(params.subscriptionId));

    case "tool.approve":
      return orchestrator.approveTool(String(params.toolCallId));
    case "tool.reject":
      return orchestrator.rejectTool(String(params.toolCallId));
    case "tool.pending.list":
      return orchestrator.listPendingToolCalls(String(params.sessionId));
    case "tool.list":
      return orchestrator.listToolCalls(String(params.sessionId));

    case "provider.config.save":
      return orchestrator.saveProviderConfig({
        id: params.id ? String(params.id) : undefined,
        name: String(params.name),
        protocol: String(params.protocol) as "anthropic-messages" | "openai-chat" | "openai-responses",
        baseUrl: String(params.baseUrl ?? ""),
        model: String(params.model),
        apiKey: String(params.apiKey),
        url: String(params.url ?? ""),
      });
    case "provider.config.delete":
      return orchestrator.deleteProviderConfig(String(params.id));

    case "model.list":
      return orchestrator.listModels();

    case "git.status":
      return orchestrator.getGitStatus();
    case "git.diff":
      return orchestrator.getGitDiff(String(params.path));

    default:
      throw new RunnerCommandError("UNSUPPORTED_COMMAND", `Unsupported command: ${method}`);
  }
}

function subscribeRunEvents(runId: string, events: string[]): {
  runId: string;
  subscriptionId: string;
} {
  const subscriptionId = createId("sub");
  const subscriptions = runEventSubscriptions.get(runId) ?? [];
  subscriptions.push({
    subscriptionId,
    events,
    createdAt: nowIso(),
  });
  runEventSubscriptions.set(runId, subscriptions);

  return {
    runId,
    subscriptionId,
  };
}

function unsubscribeRunEvents(
  runId: string,
  subscriptionId: string,
): {
  runId: string;
  subscriptionId: string;
  removed: boolean;
} {
  const subscriptions = runEventSubscriptions.get(runId);
  if (!subscriptions || subscriptions.length === 0) {
    return { runId, subscriptionId, removed: false };
  }

  const next = subscriptions.filter((subscription) => subscription.subscriptionId !== subscriptionId);
  if (next.length === 0) {
    runEventSubscriptions.delete(runId);
  } else {
    runEventSubscriptions.set(runId, next);
  }

  return {
    runId,
    subscriptionId,
    removed: next.length !== subscriptions.length,
  };
}

function shouldDeliverEvent(
  subscription: RunEventSubscription,
  eventType: string,
): boolean {
  if (subscription.events.length === 0) {
    return true;
  }

  return subscription.events.includes(eventType);
}

export function collectRunEventDeliveries(
  eventType: string,
  payload: Record<string, unknown>,
): RunEventDelivery[] {
  if (!eventType.startsWith("run.")) {
    return [];
  }

  const runId = typeof payload.runId === "string" ? payload.runId : null;
  if (!runId) {
    return [];
  }

  const subscriptions = runEventSubscriptions.get(runId);
  if (!subscriptions || subscriptions.length === 0) {
    return [];
  }

  const deliveredAt = nowIso();
  return subscriptions
    .filter((subscription) => shouldDeliverEvent(subscription, eventType))
    .map((subscription) => ({
      runId,
      subscriptionId: subscription.subscriptionId,
      event: eventType,
      payload,
      deliveredAt,
    }));
}

export function resetRunEventSubscriptions(): void {
  runEventSubscriptions.clear();
}
