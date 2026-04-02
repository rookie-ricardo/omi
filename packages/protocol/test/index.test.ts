import { describe, expect, it } from "vitest";

import { parseCommand, parseEvent, parseResult } from "../src/index";

describe("protocol", () => {
  it("parses run.start", () => {
    const result = parseCommand("run.start", {
      sessionId: "session_1",
      taskId: null,
      prompt: "Inspect the repo",
    });

    expect(result).toMatchObject({ sessionId: "session_1" });
  });

  it("parses runtime and approval queries", () => {
    expect(parseCommand("session.runtime.get", { sessionId: "session_1" })).toMatchObject({
      sessionId: "session_1",
    });
    expect(
      parseCommand("session.model.switch", {
        sessionId: "session_1",
        providerConfigId: "provider_1",
      }),
    ).toMatchObject({
      sessionId: "session_1",
    });
    expect(parseCommand("session.compact", { sessionId: "session_1" })).toMatchObject({
      sessionId: "session_1",
    });
    expect(parseCommand("tool.pending.list", { sessionId: "session_1" })).toMatchObject({
      sessionId: "session_1",
    });
    expect(parseCommand("tool.list", { sessionId: "session_1" })).toMatchObject({
      sessionId: "session_1",
    });
    expect(parseCommand("run.retry", { runId: "run_1" })).toMatchObject({ runId: "run_1" });
    expect(parseCommand("run.resume", { runId: "run_1" })).toMatchObject({ runId: "run_1" });
    expect(parseCommand("extension.list", {})).toEqual({});
    expect(parseCommand("model.list", {})).toEqual({});
  });

  it("rejects invalid event payload", () => {
    expect(() => parseEvent("run.completed", { runId: "run_1" })).toThrow();
  });

  it("parses skill and git commands", () => {
    expect(parseCommand("skill.search", { query: "git" })).toMatchObject({ query: "git" });
    expect(parseCommand("git.diff", { path: "src/index.ts" })).toMatchObject({
      path: "src/index.ts",
    });
  });

  it("parses new skill lifecycle events", () => {
    const resolved = parseEvent("run.skills_loaded", {
      runId: "run_1",
      sessionId: "session_1",
      skills: [
        {
          id: "skill_1",
          name: "Git Inspector",
          tools: ["read"],
          references: [],
          diagnostics: [],
        },
      ],
    });

    expect(resolved.skills[0]?.name).toBe("Git Inspector");
  });

  it("parses extension lifecycle events", () => {
    const resolved = parseEvent("run.extensions_loaded", {
      runId: "run_1",
      sessionId: "session_1",
      extensions: ["workspace-extension"],
      diagnostics: [],
    });

    expect(resolved.extensions).toEqual(["workspace-extension"]);
  });

  it("parses protocol result payloads", () => {
    const runtime = parseResult("session.runtime.get", {
      sessionId: "session_1",
      runtime: {
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
      },
    });

    expect(runtime.runtime.sessionId).toBe("session_1");
  });

  it("parses query result payloads", () => {
    const pending = parseResult("tool.pending.list", {
      sessionId: "session_1",
      runtime: {
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
      },
      pendingToolCalls: [],
    });

    expect(pending.pendingToolCalls).toEqual([]);

    const toolList = parseResult("tool.list", {
      sessionId: "session_1",
      toolCalls: [],
    });
    expect(toolList.toolCalls).toEqual([]);

    const extensions = parseResult("extension.list", {
      workspaceRoot: "/workspace",
      diagnostics: [],
      extensions: [],
    });
    expect(extensions.workspaceRoot).toBe("/workspace");

    const models = parseResult("model.list", {
      providerConfigs: [],
      builtInProviders: [],
    });
    expect(models.providerConfigs).toEqual([]);

    const switched = parseResult("session.model.switch", {
      sessionId: "session_1",
      runtime: {
        sessionId: "session_1",
        activeRunId: null,
        pendingRunIds: [],
        queuedRuns: [],
        blockedRunId: null,
        blockedToolCallId: null,
        pendingApprovalToolCallIds: [],
        interruptedRunIds: [],
        selectedProviderConfigId: "provider_1",
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
      },
    });
    expect(switched.sessionId).toBe("session_1");

    const compacted = parseResult("session.compact", {
      sessionId: "session_1",
      runtime: {
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
          status: "completed",
          reason: null,
          requestedAt: null,
          updatedAt: "2025-03-30T00:00:00.000Z",
          lastSummary: {
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
          lastCompactedAt: "2025-03-30T00:00:00.000Z",
          error: null,
        },
      },
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

    expect(compacted.summary.goal).toBe("summary");
  });
});
