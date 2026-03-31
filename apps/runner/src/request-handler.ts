import type { AppOrchestrator } from "@omi/agent";
import type { RpcRequest, RunnerCommandName } from "@omi/protocol";

import { parseCommand } from "@omi/protocol";

type RunnerRequestOrchestrator = Pick<
  AppOrchestrator,
  | "createSession"
  | "listSessions"
  | "getSessionDetail"
  | "getSessionRuntimeState"
  | "listSessionHistory"
  | "listSkills"
  | "searchSkills"
  | "listTasks"
  | "updateTask"
  | "getGitStatus"
  | "getGitDiff"
  | "startRun"
  | "continueFromHistoryEntry"
  | "retryRun"
  | "resumeRun"
  | "compactSession"
  | "cancelRun"
  | "approveTool"
  | "rejectTool"
  | "listPendingToolCalls"
  | "listToolCalls"
  | "switchModel"
  | "saveProviderConfig"
  | "listExtensions"
  | "listModels"
>;

export async function handleRunnerRequest(
  orchestrator: RunnerRequestOrchestrator,
  request: RpcRequest,
): Promise<unknown> {
  const params = parseCommand(request.method, request.params) as Record<string, unknown>;

  switch (request.method as RunnerCommandName) {
    case "session.create":
      return orchestrator.createSession(String(params.title));
    case "session.list":
      return orchestrator.listSessions();
    case "session.get":
      return orchestrator.getSessionDetail(String(params.sessionId));
    case "session.runtime.get": {
      const sessionId = String(params.sessionId);
      return {
        sessionId,
        runtime: orchestrator.getSessionRuntimeState(sessionId),
      };
    }
    case "session.history.list":
      return orchestrator.listSessionHistory(String(params.sessionId));
    case "session.history.continue":
      return orchestrator.continueFromHistoryEntry({
        sessionId: String(params.sessionId),
        historyEntryId: params.historyEntryId ? String(params.historyEntryId) : null,
        taskId: params.taskId ? String(params.taskId) : null,
        prompt: String(params.prompt),
        checkpointSummary: params.checkpointSummary ? String(params.checkpointSummary) : null,
        checkpointDetails: params.checkpointDetails ?? null,
      });
    case "skill.list":
      return orchestrator.listSkills();
    case "skill.search":
      return orchestrator.searchSkills(String(params.query));
    case "task.list":
      return orchestrator.listTasks();
    case "task.update":
      return orchestrator.updateTask(
        String(params.taskId),
        params.action as Parameters<AppOrchestrator["updateTask"]>[1],
      );
    case "git.status":
      return orchestrator.getGitStatus();
    case "git.diff":
      return orchestrator.getGitDiff(String(params.path));
    case "run.start":
      return orchestrator.startRun({
        sessionId: String(params.sessionId),
        taskId: params.taskId ? String(params.taskId) : null,
        prompt: String(params.prompt),
      });
    case "run.retry":
      return orchestrator.retryRun(String(params.runId));
    case "run.resume":
      return orchestrator.resumeRun(String(params.runId));
    case "run.cancel":
      return orchestrator.cancelRun(String(params.runId));
    case "session.compact":
      return orchestrator.compactSession(String(params.sessionId));
    case "tool.approve":
      return orchestrator.approveTool(String(params.toolCallId));
    case "tool.reject":
      return orchestrator.rejectTool(String(params.toolCallId));
    case "tool.pending.list":
      return orchestrator.listPendingToolCalls(String(params.sessionId));
    case "tool.list":
      return orchestrator.listToolCalls(String(params.sessionId));
    case "session.model.switch":
      return orchestrator.switchModel(String(params.sessionId), String(params.providerConfigId));
    case "provider.config.save":
      return orchestrator.saveProviderConfig({
        id: params.id ? String(params.id) : undefined,
        type: String(params.type),
        baseUrl: String(params.baseUrl ?? ""),
        model: String(params.model),
        apiKey: String(params.apiKey),
      });
    case "extension.list":
      return orchestrator.listExtensions();
    case "model.list":
      return orchestrator.listModels();
  }
}
