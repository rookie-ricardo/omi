import { describe, expect, it, vi } from "vitest";

import type { SessionRuntimeState } from "@omi/agent";
import type { Run } from "@omi/core";
import type { CompactionSummaryDocument } from "@omi/memory";
import { parseResult } from "@omi/protocol";

import { normalizeResult } from "../src/protocol";
import { handleRunnerRequest } from "../src/request-handler";

describe("runner request handler", () => {
  it("returns schema-shaped payloads for runtime, pending, and switch requests", async () => {
    const runtimeState: SessionRuntimeState = {
      sessionId: "session_1",
      activeRunId: null,
      pendingRunIds: [],
      queuedRuns: [],
      blockedRunId: null,
      blockedToolCallId: null,
      pendingApprovalToolCallIds: [],
      interruptedRunIds: [],
      selectedProviderConfigId: null,
      lastUserPrompt: null,
      lastAssistantResponse: null,
      lastActivityAt: "2025-03-30T00:00:00.000Z",
      compaction: {
        status: "idle",
        reason: null,
        requestedAt: null,
        updatedAt: "2025-03-30T00:00:00.000Z",
        lastSummary: null,
        lastCompactedAt: null,
        error: null,
      },
    };

    const orchestrator = {
      createSession: vi.fn(),
      listSessions: vi.fn(),
      getSessionDetail: vi.fn(),
      getSessionRuntimeState: vi.fn(() => runtimeState),
      listSessionHistory: vi.fn(() => ({
        sessionId: "session_1",
        historyEntries: [],
      })),
      listSkills: vi.fn(),
      searchSkills: vi.fn(),
      listTasks: vi.fn(),
      updateTask: vi.fn(),
      getGitStatus: vi.fn(),
      getGitDiff: vi.fn(),
      startRun: vi.fn(),
      continueFromHistoryEntry: vi.fn(() => ({
        id: "run_2",
        sessionId: "session_1",
        taskId: null,
        status: "queued",
        provider: "anthropic",
        createdAt: "2025-03-30T00:00:00.000Z",
        updatedAt: "2025-03-30T00:00:00.000Z",
      } satisfies Run)),
      retryRun: vi.fn(),
      resumeRun: vi.fn(),
      cancelRun: vi.fn(),
      approveTool: vi.fn(),
      rejectTool: vi.fn(),
      listPendingToolCalls: vi.fn(() => ({
        sessionId: "session_1",
        runtime: runtimeState,
        pendingToolCalls: [],
      })),
      listToolCalls: vi.fn(() => ({
        sessionId: "session_1",
        toolCalls: [],
      })),
      switchModel: vi.fn(() => ({
        sessionId: "session_1",
        runtime: runtimeState,
      })),
      saveProviderConfig: vi.fn((input) => ({
        id: input.id ?? "provider_1",
        name: "OpenAI",
        type: input.type,
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
        model: input.model,
        createdAt: "2025-03-30T00:00:00.000Z",
        updatedAt: "2025-03-30T00:00:00.000Z",
      })),
      compactSession: vi.fn(async () => {
        const summary: CompactionSummaryDocument = {
          version: 1,
          goal: "summary",
          constraints: [],
          progress: {
            done: [],
            inProgress: [],
            blocked: [],
          },
          keyDecisions: [],
          nextSteps: [],
          criticalContext: [],
        };

        return {
          sessionId: "session_1",
          runtime: runtimeState,
          summary,
          compactedAt: "2025-03-30T00:00:00.000Z",
        };
      }),
      listExtensions: vi.fn(),
      listModels: vi.fn(),
    };

    const runtimeResponse = await handleRunnerRequest(orchestrator, {
      id: "rpc_1",
      method: "session.runtime.get",
      params: { sessionId: "session_1" },
    });
    expect(runtimeResponse).toEqual({
      sessionId: "session_1",
      runtime: runtimeState,
    });
    expect(
      normalizeResult("session.runtime.get", runtimeResponse),
    ).toEqual(parseResult("session.runtime.get", runtimeResponse));

    const pendingResponse = await handleRunnerRequest(orchestrator, {
      id: "rpc_2",
      method: "tool.pending.list",
      params: { sessionId: "session_1" },
    });
    expect(pendingResponse).toEqual({
      sessionId: "session_1",
      runtime: runtimeState,
      pendingToolCalls: [],
    });
    expect(
      normalizeResult("tool.pending.list", pendingResponse),
    ).toEqual(parseResult("tool.pending.list", pendingResponse));

    const switchedResponse = await handleRunnerRequest(orchestrator, {
      id: "rpc_3",
      method: "session.model.switch",
      params: {
        sessionId: "session_1",
        providerConfigId: "provider_1",
      },
    });
    expect(switchedResponse).toEqual({
      sessionId: "session_1",
      runtime: runtimeState,
    });
    expect(
      normalizeResult("session.model.switch", switchedResponse),
    ).toEqual(parseResult("session.model.switch", switchedResponse));

    const compactedResponse = await handleRunnerRequest(orchestrator, {
      id: "rpc_4",
      method: "session.compact",
      params: {
        sessionId: "session_1",
      },
    });
    expect(compactedResponse).toEqual({
      sessionId: "session_1",
      runtime: runtimeState,
      summary: {
        version: 1,
        goal: "summary",
        constraints: [],
        progress: {
          done: [],
          inProgress: [],
          blocked: [],
        },
        keyDecisions: [],
        nextSteps: [],
        criticalContext: [],
      },
      compactedAt: "2025-03-30T00:00:00.000Z",
    });
    expect(
      normalizeResult("session.compact", compactedResponse),
    ).toEqual(parseResult("session.compact", compactedResponse));

    const historyResponse = await handleRunnerRequest(orchestrator, {
      id: "rpc_5",
      method: "session.history.list",
      params: {
        sessionId: "session_1",
      },
    });
    expect(historyResponse).toEqual({
      sessionId: "session_1",
      historyEntries: [],
    });
    expect(
      normalizeResult("session.history.list", historyResponse),
    ).toEqual(parseResult("session.history.list", historyResponse));

    const continuedResponse = await handleRunnerRequest(orchestrator, {
      id: "rpc_6",
      method: "session.history.continue",
      params: {
        sessionId: "session_1",
        historyEntryId: "hist_1",
        prompt: "continue from branch",
        checkpointSummary: "branch checkpoint",
        checkpointDetails: { source: "test" },
      },
    });
    expect(continuedResponse).toMatchObject({
      id: "run_2",
      sessionId: "session_1",
      status: "queued",
    });
    expect(
      normalizeResult("session.history.continue", continuedResponse),
    ).toEqual(parseResult("session.history.continue", continuedResponse));
  });
});
