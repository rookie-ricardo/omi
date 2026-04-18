import { beforeEach, describe, expect, it } from "vitest";

import type { GitRepoState, ProviderConfig, Session, SessionMessage, Task, ToolCall } from "@omi/core";
import type { ModelListResult } from "@omi/core";
import type { DesktopSettings, DesktopSettingsPatch } from "../../src/shared/desktop-settings";
import { mergeDesktopSettings } from "../../src/shared/desktop-settings";

import type { RunnerGateway } from "../../src/renderer/lib/runner-gateway";
import { setRunnerGatewayForTests } from "../../src/renderer/lib/runner-gateway";
import { useDiagnosticsStore } from "../../src/renderer/store/diagnostics-store";
import {
  deriveThreadTitle,
  useWorkspaceStore,
} from "../../src/renderer/store/workspace-store";

interface MockData {
  sessions: Session[];
  detailsBySession: Record<string, { session: Session; messages: SessionMessage[]; tasks: Task[] }>;
  runtimeBySession: Record<string, unknown>;
  pendingBySession: Record<string, ToolCall[]>;
  gitState: GitRepoState;
  modelCatalog: ModelListResult;
  dialogPaths: string[];
}

function createGatewayMock(): {
  gateway: RunnerGateway;
  getCalls: () => Array<{ method: string; params: unknown }>;
  getSettingsPatches: () => DesktopSettingsPatch[];
  setDialogPaths: (paths: string[]) => void;
} {
  const now = "2026-04-07T09:00:00.000Z";
  let sessionCounter = 3;
  const calls: Array<{ method: string; params: unknown }> = [];
  const settingsPatches: DesktopSettingsPatch[] = [];

  const providerConfig: ProviderConfig = {
    id: "provider_1",
    name: "openai",
    protocol: "openai-chat",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "test-key",
    model: "gpt-5.4",
    url: "",
    createdAt: now,
    updatedAt: now,
  };

  const data: MockData = {
    sessions: [
      {
        id: "session_1",
        title: "thread one",
        status: "idle",
        createdAt: now,
        updatedAt: now,
        latestUserMessage: "请帮我审查这个页面",
        latestAssistantMessage: null,
      },
      {
        id: "session_2",
        title: "thread two",
        status: "idle",
        createdAt: now,
        updatedAt: now,
        latestUserMessage: "把字体调大一点",
        latestAssistantMessage: null,
      },
    ],
    detailsBySession: {
      session_1: {
        session: {
          id: "session_1",
          title: "thread one",
          status: "idle",
          createdAt: now,
          updatedAt: now,
          latestUserMessage: "请帮我审查这个页面",
          latestAssistantMessage: null,
        },
        messages: [
          {
            id: "m_1",
            sessionId: "session_1",
            role: "user",
            content: "请帮我审查这个页面",
            createdAt: now,
          },
        ],
        tasks: [],
      },
      session_2: {
        session: {
          id: "session_2",
          title: "thread two",
          status: "idle",
          createdAt: now,
          updatedAt: now,
          latestUserMessage: "把字体调大一点",
          latestAssistantMessage: null,
        },
        messages: [
          {
            id: "m_2",
            sessionId: "session_2",
            role: "user",
            content: "把字体调大一点",
            createdAt: now,
          },
        ],
        tasks: [],
      },
    },
    runtimeBySession: {
      session_1: {
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
        lastActivityAt: now,
        compaction: {
          status: "idle",
          reason: null,
          requestedAt: null,
          updatedAt: now,
          lastSummary: null,
          lastCompactedAt: null,
          error: null,
        },
      },
      session_2: {
        sessionId: "session_2",
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
        lastActivityAt: now,
        compaction: {
          status: "idle",
          reason: null,
          requestedAt: null,
          updatedAt: now,
          lastSummary: null,
          lastCompactedAt: null,
          error: null,
        },
      },
    },
    pendingBySession: {
      session_1: [],
      session_2: [],
    },
    gitState: {
      hasRepository: true,
      root: "/Users/zhangyanqi/IdeaProjects/omi",
      branch: "main",
      branches: ["main"],
      files: [],
    },
    modelCatalog: {
      providerConfigs: [providerConfig],
      builtInProviders: [],
    },
    dialogPaths: ["/Users/zhangyanqi/Documents/demo-folder"],
  };
  let desktopSettings: DesktopSettings = {
    version: 1,
    uiState: {
      folders: [],
      sessionFolderAssignments: {},
      openFolderIds: [],
      activeFolderId: null,
      selectedSessionId: null,
      reasoningBySession: {},
      permissionModeBySession: {},
      renamedSessionIds: {},
    },
    windowState: {
      width: 1160,
      height: 800,
      maximized: false,
    },
  };

  const gateway: RunnerGateway = {
    invoke: (async (method, params) => {
      calls.push({ method, params });
      switch (method) {
        case "session.list":
          return data.sessions as never;
        case "session.get": {
          const sessionId = (params as { sessionId: string }).sessionId;
          return data.detailsBySession[sessionId] as never;
        }
        case "session.runtime.get": {
          const sessionId = (params as { sessionId: string }).sessionId;
          return {
            sessionId,
            runtime: data.runtimeBySession[sessionId],
          } as never;
        }
        case "tool.pending.list": {
          const sessionId = (params as { sessionId: string }).sessionId;
          return {
            sessionId,
            runtime: data.runtimeBySession[sessionId],
            pendingToolCalls: data.pendingBySession[sessionId] ?? [],
          } as never;
        }
        case "git.status":
          return data.gitState as never;
        case "git.diff":
          return {
            path: (params as { path: string }).path,
            status: "modified",
            leftTitle: "left",
            rightTitle: "right",
            rows: [],
          } as never;
        case "model.list":
          return data.modelCatalog as never;
        case "session.create": {
          const title = (params as { title: string }).title;
          const sessionId = `session_${sessionCounter++}`;
          const session: Session = {
            id: sessionId,
            title,
            status: "idle",
            createdAt: now,
            updatedAt: now,
            latestUserMessage: null,
            latestAssistantMessage: null,
          };
          data.sessions = [session, ...data.sessions];
          data.detailsBySession[sessionId] = {
            session,
            messages: [],
            tasks: [],
          };
          data.runtimeBySession[sessionId] = data.runtimeBySession.session_1;
          data.pendingBySession[sessionId] = [];
          return session as never;
        }
        case "run.start":
          return {
            id: "run_1",
            sessionId: (params as { sessionId: string }).sessionId,
          } as never;
        case "tool.approve":
          return { ok: true } as never;
        case "tool.reject":
          return { ok: true } as never;
        case "session.title.update": {
          const { sessionId, title } = params as { sessionId: string; title: string };
          const session = data.sessions.find((item) => item.id === sessionId);
          if (!session) {
            throw new Error("session not found");
          }
          session.title = title;
          data.detailsBySession[sessionId].session.title = title;
          return { session } as never;
        }
        default:
          return {} as never;
      }
    }) as RunnerGateway["invoke"],
    subscribe: ((listener: (event: unknown) => void) => {
      void listener;
      return () => undefined;
    }) as RunnerGateway["subscribe"],
    showOpenDialog: (async () => ({
      canceled: false,
      filePaths: data.dialogPaths,
      bookmarks: [],
    })) as RunnerGateway["showOpenDialog"],
    getDesktopSettings: (async () => structuredClone(desktopSettings)) as RunnerGateway["getDesktopSettings"],
    patchDesktopSettings: (async (patch) => {
      settingsPatches.push(structuredClone(patch));
      desktopSettings = mergeDesktopSettings(desktopSettings, patch);
      return structuredClone(desktopSettings);
    }) as RunnerGateway["patchDesktopSettings"],
    openInFinder: (async () => undefined) as RunnerGateway["openInFinder"],
  };

  return {
    gateway,
    getCalls() {
      return calls;
    },
    getSettingsPatches() {
      return settingsPatches;
    },
    setDialogPaths(paths: string[]) {
      data.dialogPaths = [...paths];
    },
  };
}

describe("workspace store", () => {
  beforeEach(() => {
    setRunnerGatewayForTests(null);
    useWorkspaceStore.getState().resetForTests();
    useDiagnosticsStore.getState().clearLogs();
  });

  it("starts without mock folders and supports add/remove folders with reassignment", async () => {
    const { gateway } = createGatewayMock();
    setRunnerGatewayForTests(gateway);

    await useWorkspaceStore.getState().initialize();
    const initialState = useWorkspaceStore.getState();
    expect(initialState.folders).toHaveLength(0);

    await useWorkspaceStore.getState().addFolderFromDialog();
    const withRealFolder = useWorkspaceStore.getState();
    const realFolder = withRealFolder.folders[0];
    expect(realFolder).toBeDefined();
    expect(Object.keys(withRealFolder.folderAssignments)).toHaveLength(0);

    const sessionId = withRealFolder.sessions[0]?.id;
    if (!sessionId || !realFolder) {
      throw new Error("missing expected session/folder in test");
    }

    useWorkspaceStore.setState((state) => ({
      folderAssignments: {
        ...state.folderAssignments,
        [sessionId]: realFolder.id,
      },
    }));

    useWorkspaceStore.getState().removeFolder(realFolder.id);
    const finalState = useWorkspaceStore.getState();
    expect(finalState.folders.find((folder) => folder.id === realFolder.id)).toBeUndefined();
    expect(finalState.folderAssignments[sessionId]).not.toBe(realFolder.id);
  });

  it("prioritizes first user message and switches to manual title after rename", async () => {
    const { gateway } = createGatewayMock();
    setRunnerGatewayForTests(gateway);

    await useWorkspaceStore.getState().initialize();
    const state = useWorkspaceStore.getState();
    const session = state.sessions[0];
    if (!session) {
      throw new Error("missing session in test");
    }

    const fromPrompt = deriveThreadTitle(
      session.title,
      state.firstUserMessageBySession[session.id],
      false,
    );
    expect(fromPrompt).toContain("请帮我审查这个页面");

    state.startRenameSession(session.id);
    useWorkspaceStore.getState().setEditingSessionDraft("手动重命名线程");
    await useWorkspaceStore.getState().commitRenameSession();

    const renamedState = useWorkspaceStore.getState();
    expect(renamedState.renamedSessionIds[session.id]).toBe(true);
    expect(
      renamedState.sessions.find((item) => item.id === session.id)?.title,
    ).toBe("手动重命名线程");
  });

  it("accumulates run.delta and clears streaming when run completes", async () => {
    const { gateway } = createGatewayMock();
    setRunnerGatewayForTests(gateway);

    await useWorkspaceStore.getState().initialize();
    const sessionId = useWorkspaceStore.getState().sessions[0]?.id;
    if (!sessionId) {
      throw new Error("missing session id in test");
    }

    await useWorkspaceStore.getState().handleRunnerEvent({
      type: "run.started",
      payload: { runId: "run_1", sessionId, prompt: "" },
    });
    await useWorkspaceStore.getState().handleRunnerEvent({
      type: "run.delta",
      payload: { runId: "run_1", sessionId, delta: "Hello" },
    });
    await useWorkspaceStore.getState().handleRunnerEvent({
      type: "run.delta",
      payload: { runId: "run_1", sessionId, delta: " world" },
    });

    expect(useWorkspaceStore.getState().streamingBySession[sessionId]?.content).toBe(
      "Hello world",
    );

    await useWorkspaceStore.getState().handleRunnerEvent({
      type: "run.completed",
      payload: { runId: "run_1", sessionId },
    });

    expect(useWorkspaceStore.getState().streamingBySession[sessionId]).toBeUndefined();
  });

  it("does not clear streaming content before run.cancel resolves", async () => {
    const { gateway } = createGatewayMock();
    const baseInvoke = gateway.invoke.bind(gateway);
    let markCancelInvoked: (() => void) | null = null;
    const cancelInvoked = new Promise<void>((resolve) => {
      markCancelInvoked = resolve;
    });
    let releaseCancel: () => void = () => {};
    const cancelGate = new Promise<void>((resolve) => {
      releaseCancel = () => resolve();
    });

    gateway.invoke = (async (method, params) => {
      if (method === "run.cancel") {
        markCancelInvoked?.();
        await cancelGate;
        const runId = (params as { runId: string }).runId;
        return { runId, canceled: true } as never;
      }
      return baseInvoke(method, params as never);
    }) as RunnerGateway["invoke"];

    setRunnerGatewayForTests(gateway);
    await useWorkspaceStore.getState().initialize();
    const sessionId = useWorkspaceStore.getState().sessions[0]?.id;
    if (!sessionId) {
      throw new Error("missing session id in test");
    }

    useWorkspaceStore.setState((state) => ({
      selectedSessionId: sessionId,
      streamingBySession: {
        ...state.streamingBySession,
        [sessionId]: {
          runId: "run_1",
          content: "partial output",
        },
      },
    }));

    const cancelPromise = useWorkspaceStore.getState().cancelRun();
    await cancelInvoked;
    expect(useWorkspaceStore.getState().streamingBySession[sessionId]?.content).toBe(
      "partial output",
    );
    releaseCancel();
    await cancelPromise;
  });

  it("creates a session on send when none selected and approves tool calls", async () => {
    const { gateway, getCalls } = createGatewayMock();
    setRunnerGatewayForTests(gateway);

    await useWorkspaceStore.getState().initialize();
    useWorkspaceStore.getState().beginNewThread();
    useWorkspaceStore.setState({
      selectedFiles: ["/Users/zhangyanqi/IdeaProjects/omi/README.md"],
    });
    useWorkspaceStore.getState().setComposerInput("请创建一个全新的线程并执行任务");

    const sessionId = await useWorkspaceStore.getState().sendPrompt();
    expect(sessionId).toBeTruthy();
    expect(getCalls().some((call) => call.method === "session.create")).toBe(true);
    expect(getCalls().some((call) => call.method === "run.start")).toBe(true);
    if (!sessionId) {
      throw new Error("expected sessionId");
    }
    expect(useWorkspaceStore.getState().selectedSessionId).toBe(sessionId);
    expect(useWorkspaceStore.getState().streamingBySession[sessionId]).toBeDefined();
    expect(
      getCalls().some(
        (call) =>
          call.method === "run.start" &&
          (call.params as { contextFiles?: string[] }).contextFiles?.includes(
            "/Users/zhangyanqi/IdeaProjects/omi/README.md",
          ),
      ),
    ).toBe(true);

    await useWorkspaceStore.getState().approveToolCall("tool_1");
    expect(
      getCalls().some(
        (call) =>
          call.method === "tool.approve" &&
          (call.params as { toolCallId?: string }).toolCallId === "tool_1",
      ),
    ).toBe(true);
  });

  it("forwards protocol when saving a provider config", async () => {
    const { gateway, getCalls } = createGatewayMock();
    setRunnerGatewayForTests(gateway);

    await useWorkspaceStore.getState().saveProviderConfig({
      name: "openai",
      protocol: "openai-chat",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4.1-mini",
      apiKey: "sk-test",
      url: "https://cdn.example.com/openai.png",
    });

    expect(getCalls()).toContainEqual({
      method: "provider.config.save",
      params: {
        id: undefined,
        name: "openai",
        protocol: "openai-chat",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4.1-mini",
        apiKey: "sk-test",
        url: "https://cdn.example.com/openai.png",
      },
    });
  });

  it("fails fast when protocol is missing while saving a provider config", async () => {
    const { gateway, getCalls } = createGatewayMock();
    setRunnerGatewayForTests(gateway);

    await expect(
      useWorkspaceStore.getState().saveProviderConfig({
        name: "openai",
        protocol: undefined as unknown as "anthropic-messages" | "openai-chat" | "openai-responses",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4.1-mini",
        apiKey: "sk-test",
        url: "",
      }),
    ).rejects.toThrow("provider.config.save requires protocol");

    expect(getCalls().some((call) => call.method === "provider.config.save")).toBe(false);
  });

  it("writes bridge connection info log on initialize", async () => {
    const { gateway } = createGatewayMock();
    setRunnerGatewayForTests(gateway);

    await useWorkspaceStore.getState().initialize();

    expect(
      useDiagnosticsStore.getState().logs.some((entry) =>
        entry.level === "info" &&
        entry.component === "desktop:bridge" &&
        entry.message === "实时连接已启用",
      ),
    ).toBe(true);
  });

  it("persists selectedSessionId in desktop settings uiState", async () => {
    const { gateway, getSettingsPatches } = createGatewayMock();
    setRunnerGatewayForTests(gateway);

    await useWorkspaceStore.getState().initialize();
    await useWorkspaceStore.getState().selectSession("session_2");
    await new Promise((resolve) => setTimeout(resolve, 220));

    expect(
      getSettingsPatches().some(
        (patch) => patch.uiState?.selectedSessionId === "session_2",
      ),
    ).toBe(true);
  });

  it("re-adding an existing folder does not duplicate and re-activates it", async () => {
    const { gateway, setDialogPaths } = createGatewayMock();
    setRunnerGatewayForTests(gateway);

    await useWorkspaceStore.getState().initialize();
    await useWorkspaceStore.getState().addFolderFromDialog();
    const created = useWorkspaceStore.getState().folders[0];
    if (!created) {
      throw new Error("expected a created folder");
    }

    setDialogPaths(["/Users/zhangyanqi/Documents/another-folder"]);
    await useWorkspaceStore.getState().addFolderFromDialog();
    const second = useWorkspaceStore.getState().folders.find((folder) => folder.id !== created.id);
    if (!second) {
      throw new Error("expected a second created folder");
    }
    useWorkspaceStore.getState().setActiveFolder(second.id);

    setDialogPaths([created.path]);
    await useWorkspaceStore.getState().addFolderFromDialog();

    const state = useWorkspaceStore.getState();
    expect(state.folders).toHaveLength(2);
    expect(state.activeFolderId).toBe(created.id);
    expect(state.openFolderIds[created.id]).toBe(true);
  });

  it("handles run.skills_resolved by tracking resolved skill in store", async () => {
    const { gateway } = createGatewayMock();
    setRunnerGatewayForTests(gateway);
    await useWorkspaceStore.getState().initialize();
    const sessionId = useWorkspaceStore.getState().sessions[0]?.id;
    if (!sessionId) throw new Error("missing session id");

    await useWorkspaceStore.getState().handleRunnerEvent({
      type: "run.skills_resolved",
      payload: {
        runId: "run_1",
        sessionId,
        skillName: "commit",
        enabledToolNames: ["bash", "git"],
      },
    });

    const skill = useWorkspaceStore.getState().resolvedSkillBySession[sessionId];
    expect(skill).toEqual({ skillName: "commit", enabledToolNames: ["bash", "git"] });
  });

  it("handles run.tool_requested with requiresApproval optimistically", async () => {
    const { gateway } = createGatewayMock();
    setRunnerGatewayForTests(gateway);
    await useWorkspaceStore.getState().initialize();
    const sessionId = useWorkspaceStore.getState().sessions[0]?.id;
    if (!sessionId) throw new Error("missing session id");

    await useWorkspaceStore.getState().handleRunnerEvent({
      type: "run.tool_requested",
      payload: {
        runId: "run_1",
        sessionId,
        toolCallId: "tc_1",
        toolName: "bash",
        input: { command: "ls" },
        requiresApproval: true,
      },
    });

    const pending = useWorkspaceStore.getState().pendingToolCallsBySession[sessionId];
    expect(pending).toHaveLength(1);
    expect(pending?.[0]?.toolName).toBe("bash");
  });

  it("handles run.tool_progress by tracking progress state", async () => {
    const { gateway } = createGatewayMock();
    setRunnerGatewayForTests(gateway);
    await useWorkspaceStore.getState().initialize();
    const sessionId = useWorkspaceStore.getState().sessions[0]?.id;
    if (!sessionId) throw new Error("missing session id");

    await useWorkspaceStore.getState().handleRunnerEvent({
      type: "run.tool_progress",
      payload: { runId: "run_1", sessionId, toolCallId: "tc_1", toolName: "bash" },
    });

    const progress = useWorkspaceStore.getState().toolProgressBySession[sessionId];
    expect(progress?.["tc_1"]?.toolName).toBe("bash");
  });

  it("handles run.blocked by tracking blocked tool state", async () => {
    const { gateway } = createGatewayMock();
    setRunnerGatewayForTests(gateway);
    await useWorkspaceStore.getState().initialize();
    const sessionId = useWorkspaceStore.getState().sessions[0]?.id;
    if (!sessionId) throw new Error("missing session id");

    await useWorkspaceStore.getState().handleRunnerEvent({
      type: "run.blocked",
      payload: { runId: "run_1", sessionId, toolCallId: "tc_1", toolName: "bash", input: { command: "rm -rf /" } },
    });

    const blocked = useWorkspaceStore.getState().blockedToolBySession[sessionId];
    expect(blocked?.toolCallId).toBe("tc_1");
    expect(blocked?.toolName).toBe("bash");
  });

  it("stores usage data from run.completed event", async () => {
    const { gateway } = createGatewayMock();
    setRunnerGatewayForTests(gateway);
    await useWorkspaceStore.getState().initialize();
    const sessionId = useWorkspaceStore.getState().sessions[0]?.id;
    if (!sessionId) throw new Error("missing session id");

    await useWorkspaceStore.getState().handleRunnerEvent({
      type: "run.started",
      payload: { runId: "run_1", sessionId, prompt: "hi" },
    });
    await useWorkspaceStore.getState().handleRunnerEvent({
      type: "run.completed",
      payload: {
        runId: "run_1",
        sessionId,
        usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10 },
        stopReason: "end_turn",
      },
    });

    const usage = useWorkspaceStore.getState().usageBySession[sessionId];
    expect(usage?.inputTokens).toBe(100);
    expect(usage?.outputTokens).toBe(50);
  });

  it("clears blocked state and pending tools on run.tool_decided", async () => {
    const { gateway } = createGatewayMock();
    setRunnerGatewayForTests(gateway);
    await useWorkspaceStore.getState().initialize();
    const sessionId = useWorkspaceStore.getState().sessions[0]?.id;
    if (!sessionId) throw new Error("missing session id");

    // Set up blocked state
    await useWorkspaceStore.getState().handleRunnerEvent({
      type: "run.blocked",
      payload: { runId: "run_1", sessionId, toolCallId: "tc_1", toolName: "bash", input: {} },
    });
    await useWorkspaceStore.getState().handleRunnerEvent({
      type: "run.tool_requested",
      payload: { runId: "run_1", sessionId, toolCallId: "tc_1", toolName: "bash", input: {}, requiresApproval: true },
    });

    expect(useWorkspaceStore.getState().blockedToolBySession[sessionId]?.toolCallId).toBe("tc_1");
    expect(useWorkspaceStore.getState().pendingToolCallsBySession[sessionId]).toHaveLength(1);

    // Decide
    await useWorkspaceStore.getState().handleRunnerEvent({
      type: "run.tool_decided",
      payload: { runId: "run_1", sessionId, toolCallId: "tc_1", toolName: "bash", decision: "approved" },
    });

    expect(useWorkspaceStore.getState().blockedToolBySession[sessionId]).toBeNull();
    expect(useWorkspaceStore.getState().pendingToolCallsBySession[sessionId]).toHaveLength(0);
  });
});
