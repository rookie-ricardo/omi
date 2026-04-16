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
    expect(parseCommand("run.events.unsubscribe", {
      runId: "run_1",
      subscriptionId: "sub_1",
    })).toMatchObject({ runId: "run_1", subscriptionId: "sub_1" });
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

  it("parses runtime selection events", () => {
    const resolved = parseEvent("run.runtime_selected", {
      runId: "run_1",
      sessionId: "session_1",
      runtime: "claude-agent-sdk",
    });

    expect(resolved.runtime).toBe("claude-agent-sdk");
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

  it("parses control plane result payloads", () => {
    const branch = parseResult("session.branch.create", {
      sessionId: "session_1",
      branch: {
        id: "branch_1",
        name: "feature",
        sessionId: "session_1",
        parentEntryId: null,
        createdAt: "2025-03-30T00:00:00.000Z",
        isActive: true,
      },
    });
    expect(branch.branch.isActive).toBe(true);

    const branches = parseResult("session.branch.list", {
      sessionId: "session_1",
      branches: [branch.branch],
    });
    expect(branches.branches).toHaveLength(1);

    const switched = parseResult("session.branch.switch", {
      sessionId: "session_1",
      branch: branch.branch,
      previousBranchId: "branch_main",
    });
    expect(switched.previousBranchId).toBe("branch_main");

    const modeEntered = parseResult("session.mode.enter", {
      sessionId: "session_1",
      mode: {
        sessionId: "session_1",
        mode: "plan",
        status: "planning",
        enteredAt: "2025-03-30T00:00:00.000Z",
        summary: null,
      },
    });
    expect(modeEntered.mode.mode).toBe("plan");

    const modeExited = parseResult("session.mode.exit", {
      sessionId: "session_1",
      previousMode: modeEntered.mode,
      discarded: false,
    });
    expect(modeExited.discarded).toBe(false);

    const runState = parseResult("run.state.get", {
      run: {
        runId: "run_1",
        sessionId: "session_1",
        status: "running",
        startedAt: "2025-03-30T00:00:00.000Z",
        currentToolCallId: null,
        pendingApprovalToolCallIds: [],
        error: null,
        checkpoints: [
          {
            id: "ckpt_1",
            createdAt: "2025-03-30T00:00:00.000Z",
            phase: "before_model_call",
            payload: { checkpoint: "state" },
          },
        ],
      },
    });
    expect(runState.run.checkpoints).toHaveLength(1);

    const runSubscription = parseResult("run.events.subscribe", {
      runId: "run_1",
      subscriptionId: "sub_1",
      events: ["run.completed", "run.failed"],
    });
    expect(runSubscription.subscriptionId).toBe("sub_1");

    const runUnsubscribe = parseResult("run.events.unsubscribe", {
      runId: "run_1",
      subscriptionId: "sub_1",
      unsubscribed: true,
    });
    expect(runUnsubscribe.unsubscribed).toBe(true);

    const refreshedSkills = parseResult("skill.refresh", {
      refreshedAt: "2025-03-30T00:00:00.000Z",
      skills: [],
    });
    expect(refreshedSkills.skills).toEqual([]);

    const permissionList = parseResult("permission.rule.list", {
      sessionId: "session_1",
      rules: [
        {
          id: "rule_1",
          name: "Allow read",
          toolPattern: "read",
          action: "allow",
          priority: 10,
          createdAt: "2025-03-30T00:00:00.000Z",
          updatedAt: "2025-03-30T00:00:00.000Z",
        },
      ],
    });
    expect(permissionList.rules[0]?.action).toBe("allow");

    const mcpList = parseResult("mcp.server.list", {
      servers: [
        {
          id: "server_1",
          name: "server_1",
          command: "",
          args: [],
          status: "connected",
          error: null,
          tools: [],
          resources: [],
        },
      ],
    });
    expect(mcpList.servers[0]?.status).toBe("connected");

    const spawn = parseResult("agent.spawn", {
      task: {
        id: "agent_1",
        name: "agent_1",
        ownerId: "main",
        status: "pending",
        writeScope: "shared",
        progress: 0,
        createdAt: "2025-03-30T00:00:00.000Z",
        startedAt: null,
        completedAt: null,
        output: null,
        error: null,
      },
    });
    expect(spawn.task.id).toBe("agent_1");

    const waited = parseResult("agent.wait", {
      task: {
        id: "agent_1",
        name: "agent_1",
        ownerId: "main",
        status: "completed",
        writeScope: "shared",
        progress: 100,
        createdAt: "2025-03-30T00:00:00.000Z",
        startedAt: "2025-03-30T00:00:00.000Z",
        completedAt: "2025-03-30T00:00:00.000Z",
        output: "done",
        error: null,
      },
      timedOut: false,
    });
    expect(waited.timedOut).toBe(false);

    const agentSend = parseResult("agent.send", {
      subAgentId: "agent_1",
      sent: true,
    });
    expect(agentSend.sent).toBe(true);

    const agentClose = parseResult("agent.close", {
      subAgentId: "agent_1",
      closed: true,
    });
    expect(agentClose.closed).toBe(true);
  });
});
