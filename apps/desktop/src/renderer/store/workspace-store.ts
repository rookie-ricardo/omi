import { create } from "zustand";

import { useDiagnosticsStore, type DiagnosticLogLevel } from "./diagnostics-store";

import type {
  GitDiffPreview,
  GitRepoState,
  ProviderConfig,
  Session,
  SessionMessage,
  Task,
  ToolCall,
} from "@omi/core";
import type {
  ModelListResult,
  RunnerCommandName,
  RunnerCommandParamsByName,
  SessionRuntimeGetResult,
  ToolListResult,
  ToolPendingListResult,
} from "@omi/core";
import type { DesktopPermissionMode, DesktopUiState } from "../../shared/desktop-settings";

import { getRunnerGateway, type RunnerEventEnvelope } from "../lib/runner-gateway";

const DEFAULT_REASONING_LEVEL: ReasoningLevel = "高";
const PROVIDER_PROTOCOL_VALUES = ["anthropic-messages", "openai-chat", "openai-responses"] as const;

let runnerUnsubscribe: (() => void) | null = null;
let desktopUiPersistTimer: ReturnType<typeof setTimeout> | null = null;

export type ReasoningLevel = "低" | "中" | "高" | "超高";
type ProviderProtocol = (typeof PROVIDER_PROTOCOL_VALUES)[number];
export type PermissionMode = DesktopPermissionMode;

interface SendPromptTextOptions {
  contextFiles?: string[];
  clearComposer?: boolean;
}

export interface WorkspaceFolder {
  id: string;
  name: string;
  path: string;
}

export interface SessionDetailResponse {
  session: Session;
  messages: SessionMessage[];
  tasks: Task[];
}

interface StreamingState {
  runId: string;
  content: string;
}

interface RunUsageInfo {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

interface ResolvedSkillInfo {
  skillName: string;
  enabledToolNames: string[];
}

interface ToolProgressInfo {
  toolCallId: string;
  toolName: string;
  lastUpdated: string;
}

interface WorkspaceStoreData {
  initialized: boolean;
  initializing: boolean;
  bridgeAvailable: boolean;
  error: string | null;
  sessions: Session[];
  selectedSessionId: string | null;
  sessionDetailsById: Record<string, SessionDetailResponse>;
  sessionRuntimeById: Record<string, SessionRuntimeGetResult["runtime"]>;
  pendingToolCallsBySession: Record<string, ToolCall[]>;
  toolCallsBySession: Record<string, ToolCall[]>;
  activeToolsBySession: Record<string, Array<{ toolCallId: string; toolName: string }>>;
  toolProgressBySession: Record<string, Record<string, ToolProgressInfo>>;
  usageBySession: Record<string, RunUsageInfo>;
  resolvedSkillBySession: Record<string, ResolvedSkillInfo>;
  blockedToolBySession: Record<string, { toolCallId: string; toolName: string; input: Record<string, unknown> } | null>;
  firstUserMessageBySession: Record<string, string | null>;
  renamedSessionIds: Record<string, boolean>;
  streamingBySession: Record<string, StreamingState>;
  errorBySession: Record<string, string>;
  gitState: GitRepoState | null;
  diffPreview: GitDiffPreview | null;
  diffPath: string | null;
  modelCatalog: ModelListResult | null;
  folders: WorkspaceFolder[];
  folderAssignments: Record<string, string>;
  openFolderIds: Record<string, boolean>;
  activeFolderId: string | null;
  composerInput: string;
  selectedFiles: string[];
  reasoningBySession: Record<string, ReasoningLevel>;
  permissionModeBySession: Record<string, PermissionMode>;
  newThreadPermissionMode: PermissionMode;
  reasoningLevel: ReasoningLevel;
  editingSessionId: string | null;
  editingSessionDraft: string;
  uiPanels: {
    showDiffPanel: boolean;
    modelMenuOpen: boolean;
    reasoningMenuOpen: boolean;
    editorMenuOpen: boolean;
    commitMenuOpen: boolean;
    slashMenuOpen: boolean;
  };
}

interface WorkspaceStoreActions {
  initialize: () => Promise<void>;
  resetForTests: () => void;
  setComposerInput: (value: string) => void;
  sendPrompt: () => Promise<string | null>;
  sendPromptText: (prompt: string, options?: SendPromptTextOptions) => Promise<string | null>;
  applyStarterPrompt: (value: string) => void;
  beginNewThread: () => void;
  selectSession: (sessionId: string) => Promise<void>;
  refreshSession: (sessionId: string) => Promise<void>;
  refreshSelectedSession: () => Promise<void>;
  loadSessions: () => Promise<void>;
  loadGitStatus: () => Promise<void>;
  loadModelCatalog: () => Promise<void>;
  openComposerFileDialog: () => Promise<void>;
  removeSelectedFile: (path: string) => void;
  clearSelectedFiles: () => void;
  toggleDiffPanel: () => Promise<void>;
  openDiffPreview: (path: string) => Promise<void>;
  switchModel: (providerConfigId: string) => Promise<void>;
  saveProviderConfig: (params: {
    id?: string;
    name: string;
    protocol: "anthropic-messages" | "openai-chat" | "openai-responses";
    baseUrl?: string;
    model: string;
    apiKey: string;
    url?: string;
  }) => Promise<void>;
  deleteProviderConfig: (id: string) => Promise<void>;
  setReasoningLevel: (level: ReasoningLevel) => void;
  setPermissionMode: (mode: PermissionMode) => void;
  setUiPanelOpen: (
    panel: keyof WorkspaceStoreData["uiPanels"],
    open: boolean,
  ) => void;
  closeAllPanels: () => void;
  approveToolCall: (toolCallId: string) => Promise<void>;
  rejectToolCall: (toolCallId: string) => Promise<void>;
  cancelRun: () => Promise<void>;
  addFolderFromDialog: () => Promise<void>;
  toggleFolder: (folderId: string) => void;
  removeFolder: (folderId: string) => void;
  setActiveFolder: (folderId: string) => void;
  startRenameSession: (sessionId: string) => void;
  setEditingSessionDraft: (value: string) => void;
  cancelRenameSession: () => void;
  commitRenameSession: () => Promise<void>;
  executeSlashCommand: (command: string) => Promise<void>;
  handleRunnerEvent: (event: RunnerEventEnvelope) => Promise<void>;
}

export type WorkspaceStore = WorkspaceStoreData & WorkspaceStoreActions;

function createInitialData(): WorkspaceStoreData {
  const folders: WorkspaceFolder[] = [];
  return {
    initialized: false,
    initializing: false,
    bridgeAvailable: false,
    error: null,
    sessions: [],
    selectedSessionId: null,
    sessionDetailsById: {},
    sessionRuntimeById: {},
    pendingToolCallsBySession: {},
    toolCallsBySession: {},
    activeToolsBySession: {},
    toolProgressBySession: {},
    usageBySession: {},
    resolvedSkillBySession: {},
    blockedToolBySession: {},
    firstUserMessageBySession: {},
    renamedSessionIds: {},
    streamingBySession: {},
    errorBySession: {},
    gitState: null,
    diffPreview: null,
    diffPath: null,
    modelCatalog: null,
    folders,
    folderAssignments: {},
    openFolderIds: {},
    activeFolderId: null,
    composerInput: "",
    selectedFiles: [],
    reasoningBySession: {},
    permissionModeBySession: {},
    newThreadPermissionMode: "default",
    reasoningLevel: DEFAULT_REASONING_LEVEL,
    editingSessionId: null,
    editingSessionDraft: "",
    uiPanels: {
      showDiffPanel: false,
      modelMenuOpen: false,
      reasoningMenuOpen: false,
      editorMenuOpen: false,
      commitMenuOpen: false,
      slashMenuOpen: false,
    },
  };
}

function buildFolderName(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const segments = normalized.split("/").filter(Boolean);
  return segments.at(-1) ?? path;
}

function generateFolderId(path: string): string {
  const seed = path.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `real-${seed}-${Math.random().toString(36).slice(2, 8)}`;
}

function deriveSessionTitleFromPrompt(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  return normalized.slice(0, 28) || "新线程";
}

function assertProviderProtocol(protocol: unknown): ProviderProtocol {
  if (typeof protocol === "string" && PROVIDER_PROTOCOL_VALUES.includes(protocol as ProviderProtocol)) {
    return protocol as ProviderProtocol;
  }
  throw new Error(
    `provider.config.save requires protocol in ${PROVIDER_PROTOCOL_VALUES.join(" | ")}, received ${String(protocol)}`,
  );
}

function pushDiagnosticsLog(input: {
  level: DiagnosticLogLevel;
  component: string;
  message: string;
  context?: Record<string, unknown>;
}): void {
  useDiagnosticsStore.getState().addLog({
    timestamp: new Date().toISOString(),
    level: input.level,
    component: input.component,
    message: input.message,
    context: input.context ?? {},
  });
}

function requireGateway() {
  const gateway = getRunnerGateway();
  if (!gateway) {
    throw new Error("Desktop bridge is unavailable.");
  }
  return gateway;
}

async function invokeRunner<TResult, TName extends RunnerCommandName>(
  method: TName,
  params?: RunnerCommandParamsByName[TName],
): Promise<TResult> {
  const gateway = requireGateway();
  return gateway.invoke<TResult, TName>(method, params);
}

function firstUserMessage(messages: SessionMessage[]): string | null {
  const userMessage = messages.find((message) => message.role === "user");
  return userMessage?.content ?? null;
}

function openFolderIdListToMap(openFolderIds: string[]): Record<string, boolean> {
  return Object.fromEntries(openFolderIds.map((folderId) => [folderId, true]));
}

function openFolderMapToList(openFolderMap: Record<string, boolean>): string[] {
  return Object.entries(openFolderMap)
    .filter(([, isOpen]) => isOpen)
    .map(([folderId]) => folderId);
}

function toDesktopUiState(state: WorkspaceStoreData): DesktopUiState {
  return {
    folders: state.folders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      path: folder.path,
    })),
    sessionFolderAssignments: state.folderAssignments,
    openFolderIds: openFolderMapToList(state.openFolderIds),
    activeFolderId: state.activeFolderId,
    selectedSessionId: state.selectedSessionId,
    reasoningBySession: state.reasoningBySession,
    permissionModeBySession: state.permissionModeBySession,
    renamedSessionIds: state.renamedSessionIds,
  };
}

function schedulePersistDesktopUiState(state: WorkspaceStoreData): void {
  const gateway = getRunnerGateway();
  if (!gateway) {
    return;
  }
  const uiState = toDesktopUiState(state);
  if (desktopUiPersistTimer) {
    clearTimeout(desktopUiPersistTimer);
  }
  desktopUiPersistTimer = setTimeout(() => {
    void gateway.patchDesktopSettings({ uiState }).catch(() => undefined);
  }, 160);
}

async function persistDesktopUiStateNow(state: WorkspaceStoreData): Promise<void> {
  const gateway = getRunnerGateway();
  if (!gateway) {
    return;
  }
  if (desktopUiPersistTimer) {
    clearTimeout(desktopUiPersistTimer);
    desktopUiPersistTimer = null;
  }
  await gateway.patchDesktopSettings({ uiState: toDesktopUiState(state) }).catch(() => undefined);
}

function ensureOpenFolderMap(
  folders: WorkspaceFolder[],
  openMap: Record<string, boolean>,
): Record<string, boolean> {
  const nextMap: Record<string, boolean> = {};
  for (const folder of folders) {
    nextMap[folder.id] = openMap[folder.id] ?? folder.id === folders[0]?.id;
  }
  return nextMap;
}

function resolveFallbackFolderId(
  folders: WorkspaceFolder[],
  preferredId: string | null,
): string | null {
  if (preferredId && folders.some((folder) => folder.id === preferredId)) {
    return preferredId;
  }
  return folders[0]?.id ?? null;
}

function ensureSessionAssignments(
  sessions: Session[],
  folders: WorkspaceFolder[],
  assignments: Record<string, string>,
): Record<string, string> {
  const folderIds = new Set(folders.map((folder) => folder.id));
  const nextAssignments: Record<string, string> = {};
  for (const session of sessions) {
    const assigned = assignments[session.id];
    if (assigned && folderIds.has(assigned)) {
      nextAssignments[session.id] = assigned;
    }
  }
  return nextAssignments;
}

function ensurePermissionModes(
  sessions: Session[],
  modes: Record<string, PermissionMode>,
): Record<string, PermissionMode> {
  const nextModes: Record<string, PermissionMode> = {};
  for (const session of sessions) {
    nextModes[session.id] = modes[session.id] ?? session.permissionMode ?? "default";
  }
  return nextModes;
}

function resolveSessionWorkspaceRoot(
  state: Pick<WorkspaceStoreData, "folders" | "folderAssignments">,
  sessionId: string,
): string | null {
  const assignedFolderId = state.folderAssignments[sessionId];
  if (!assignedFolderId) {
    return null;
  }
  const assignedFolder = state.folders.find((folder) => folder.id === assignedFolderId);
  return assignedFolder?.path ?? null;
}

export function deriveThreadTitle(
  sessionTitle: string,
  firstUserPrompt: string | null | undefined,
  renamed: boolean,
): string {
  const rawTitle = renamed ? sessionTitle : (firstUserPrompt?.trim() || sessionTitle);
  const normalized = rawTitle.replace(/\s+/g, " ").trim();
  if (normalized.length <= 34) {
    return normalized;
  }
  return `${normalized.slice(0, 31)}...`;
}

export function formatRelativeTime(input: string): string {
  const delta = Date.now() - new Date(input).getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (delta < hour) {
    return `${Math.max(1, Math.floor(delta / minute))} 分`;
  }
  if (delta < day) {
    return `${Math.max(1, Math.floor(delta / hour))} 小时`;
  }
  if (delta < day * 7) {
    return `${Math.max(1, Math.floor(delta / day))} 天`;
  }
  if (delta < day * 30) {
    return `${Math.max(1, Math.floor(delta / (day * 7)))} 周`;
  }
  return `${Math.max(1, Math.floor(delta / (day * 30)))} 月`;
}

export function formatProviderConfigLabel(config: ProviderConfig): string {
  return `${config.name} · ${config.model}`;
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  ...createInitialData(),

  async initialize() {
    if (get().initialized || get().initializing) {
      return;
    }

    set({ initializing: true, error: null });

    const gateway = getRunnerGateway();
    if (!gateway) {
      set({
        initialized: true,
        initializing: false,
        bridgeAvailable: false,
      });
      return;
    }

    let persistedUiState: DesktopUiState = {
      folders: [],
      sessionFolderAssignments: {},
      openFolderIds: [],
      activeFolderId: null,
      selectedSessionId: null,
      reasoningBySession: {},
      permissionModeBySession: {},
      renamedSessionIds: {},
    };
    try {
      const desktopSettings = await gateway.getDesktopSettings();
      persistedUiState = desktopSettings.uiState;
    } catch {
      // ignore settings load failures and continue with in-memory defaults
    }

    const folders = persistedUiState.folders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      path: folder.path,
    }));
    const openFolderIds = ensureOpenFolderMap(
      folders,
      openFolderIdListToMap(persistedUiState.openFolderIds),
    );
    const activeFolderId = resolveFallbackFolderId(folders, persistedUiState.activeFolderId);

    set({
      bridgeAvailable: true,
      folders,
      folderAssignments: persistedUiState.sessionFolderAssignments,
      openFolderIds,
      activeFolderId,
      selectedSessionId: persistedUiState.selectedSessionId,
      reasoningBySession: persistedUiState.reasoningBySession,
      permissionModeBySession: persistedUiState.permissionModeBySession,
      newThreadPermissionMode: "default",
      renamedSessionIds: persistedUiState.renamedSessionIds,
    });

    if (!runnerUnsubscribe) {
      runnerUnsubscribe = gateway.subscribe((event) => {
        void get().handleRunnerEvent(event);
      });
    }

    try {
      await Promise.all([get().loadModelCatalog(), get().loadGitStatus(), get().loadSessions()]);
      const selectedSessionId = get().selectedSessionId;
      if (selectedSessionId) {
        await get().refreshSession(selectedSessionId);
      }
      set({ initialized: true, initializing: false, bridgeAvailable: true });
      pushDiagnosticsLog({
        level: "info",
        component: "desktop:bridge",
        message: "实时连接已启用",
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      set({
        initializing: false,
        bridgeAvailable: false,
        error: errorMessage,
      });
      pushDiagnosticsLog({
        level: "error",
        component: "desktop:bridge",
        message: "初始化失败",
        context: { error: errorMessage },
      });
    }
  },

  resetForTests() {
    if (runnerUnsubscribe) {
      runnerUnsubscribe();
      runnerUnsubscribe = null;
    }
    if (desktopUiPersistTimer) {
      clearTimeout(desktopUiPersistTimer);
      desktopUiPersistTimer = null;
    }
    const currentData = createInitialData();
    set(currentData);
  },

  setComposerInput(value) {
    set((state) => ({
      composerInput: value,
      uiPanels: {
        ...state.uiPanels,
        slashMenuOpen: value.trimStart().startsWith("/"),
      },
    }));
  },

  async sendPrompt() {
    const prompt = get().composerInput.trim();
    if (!prompt) {
      return null;
    }
    return get().sendPromptText(prompt, {
      contextFiles: get().selectedFiles,
      clearComposer: true,
    });
  },

  async sendPromptText(rawPrompt, options) {
    const prompt = rawPrompt.trim();
    if (!prompt) {
      return null;
    }

    let sessionId = get().selectedSessionId;
    const pendingPermissionMode = get().newThreadPermissionMode;
    if (!sessionId) {
      const session = await invokeRunner<Session, "session.create">("session.create", {
        title: deriveSessionTitleFromPrompt(prompt),
      });
      sessionId = session.id;
      const activeFolderId = get().activeFolderId;
      set((state) => ({
        selectedSessionId: session.id,
        sessions: [session, ...state.sessions.filter((item) => item.id !== session.id)],
        folderAssignments:
          activeFolderId && state.folders.some((folder) => folder.id === activeFolderId)
            ? {
                ...state.folderAssignments,
                [session.id]: activeFolderId,
              }
            : state.folderAssignments,
        permissionModeBySession: {
          ...state.permissionModeBySession,
          [session.id]: pendingPermissionMode,
        },
      }));
      schedulePersistDesktopUiState(get());
    }

    const contextFiles = options?.contextFiles ?? [];
    const sessionWorkspaceRoot = resolveSessionWorkspaceRoot(get(), sessionId);
    await invokeRunner("session.workspace.set", {
      sessionId,
      workspaceRoot: sessionWorkspaceRoot,
    });
    const sessionPermissionMode = get().permissionModeBySession[sessionId] ?? "default";
    await invokeRunner("session.permission.set", {
      sessionId,
      mode: sessionPermissionMode,
    });
    const run = await invokeRunner<{ id?: string }, "run.start">("run.start", {
      sessionId,
      taskId: null,
      prompt,
      ...(contextFiles.length > 0 ? { contextFiles } : {}),
    });
    const runId = typeof run?.id === "string" ? run.id : `local-${Date.now()}`;
    const clearComposer = options?.clearComposer === true;

    const optimisticMessage: SessionMessage = {
      id: `optimistic-${Date.now()}`,
      sessionId,
      taskId: null,
      parentMessageId: null,
      role: "user",
      messageType: "text",
      content: prompt,
      model: null,
      tokens: 0,
      totalTokens: 0,
      compressedFromMessageId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    set((state) => {
      const nextErrors = { ...state.errorBySession };
      delete nextErrors[sessionId];
      const existingDetail = state.sessionDetailsById[sessionId];
      const nextDetails = {
        ...state.sessionDetailsById,
        [sessionId]: existingDetail
          ? {
              ...existingDetail,
              messages: [...existingDetail.messages, optimisticMessage],
            }
          : {
              session: state.sessions.find((s) => s.id === sessionId) ?? {
                id: sessionId,
                title: "",
                providerConfigId: null,
                model: null,
                permissionMode: pendingPermissionMode,
                thinkLevel: "medium",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                latestUserMessage: prompt,
                latestAssistantMessage: null,
              },
              messages: [optimisticMessage],
              tasks: [],
            },
      };
      return {
        ...(clearComposer
          ? {
              composerInput: "",
              selectedFiles: [],
              uiPanels: {
                ...state.uiPanels,
                slashMenuOpen: false,
              },
            }
          : {}),
        errorBySession: nextErrors,
        sessionDetailsById: nextDetails,
        streamingBySession: {
          ...state.streamingBySession,
          [sessionId]: {
            runId,
            content: "",
          },
        },
      };
    });

    await Promise.all([get().loadSessions(), get().loadGitStatus()]);
    return sessionId;
  },

  applyStarterPrompt(value) {
    set((state) => ({
      composerInput: value,
      uiPanels: {
        ...state.uiPanels,
        slashMenuOpen: value.trimStart().startsWith("/"),
      },
    }));
  },

  beginNewThread() {
    set({
      selectedSessionId: null,
      diffPreview: null,
      diffPath: null,
      uiPanels: {
        ...get().uiPanels,
        showDiffPanel: false,
      },
    });
    schedulePersistDesktopUiState(get());
  },

  async selectSession(sessionId) {
    const preferredReasoning = get().reasoningBySession[sessionId] ?? DEFAULT_REASONING_LEVEL;
    const assignedFolderId = get().folderAssignments[sessionId];
    const nextActiveFolderId =
      assignedFolderId && get().folders.some((folder) => folder.id === assignedFolderId)
        ? assignedFolderId
        : get().activeFolderId;
    set({
      selectedSessionId: sessionId,
      activeFolderId: nextActiveFolderId,
      reasoningLevel: preferredReasoning,
      uiPanels: {
        ...get().uiPanels,
        showDiffPanel: false,
      },
      diffPreview: null,
      diffPath: null,
    });
    schedulePersistDesktopUiState(get());
    await invokeRunner("session.workspace.set", {
      sessionId,
      workspaceRoot: resolveSessionWorkspaceRoot(get(), sessionId),
    });
    await Promise.all([get().refreshSession(sessionId), get().loadGitStatus()]);
  },

  async refreshSession(sessionId) {
    const [detail, runtime, pendingTools, allTools] = await Promise.all([
      invokeRunner<SessionDetailResponse, "session.get">("session.get", { sessionId }),
      invokeRunner<SessionRuntimeGetResult, "session.runtime.get">("session.runtime.get", {
        sessionId,
      }),
      invokeRunner<ToolPendingListResult, "tool.pending.list">("tool.pending.list", {
        sessionId,
      }),
      invokeRunner<ToolListResult, "tool.list">("tool.list", {
        sessionId,
      }),
    ]);

    const firstUserPrompt = firstUserMessage(detail.messages);
    const hasActiveRun = Boolean(runtime.runtime.activeRunId);
    set((state) => {
      const nextStreaming = { ...state.streamingBySession };
      if (!hasActiveRun && nextStreaming[sessionId]) {
        delete nextStreaming[sessionId];
      }
      return {
        sessionDetailsById: {
          ...state.sessionDetailsById,
          [sessionId]: detail,
        },
        sessionRuntimeById: {
          ...state.sessionRuntimeById,
          [sessionId]: runtime.runtime,
        },
        pendingToolCallsBySession: {
          ...state.pendingToolCallsBySession,
          [sessionId]: pendingTools.pendingToolCalls,
        },
        toolCallsBySession: {
          ...state.toolCallsBySession,
          [sessionId]: allTools.toolCalls,
        },
        firstUserMessageBySession: {
          ...state.firstUserMessageBySession,
          [sessionId]: firstUserPrompt,
        },
        streamingBySession: nextStreaming,
        sessions: state.sessions.map((session) =>
          session.id === detail.session.id ? detail.session : session,
        ),
      };
    });
  },

  async refreshSelectedSession() {
    const sessionId = get().selectedSessionId;
    if (!sessionId) {
      return;
    }
    await get().refreshSession(sessionId);
  },

  async loadSessions() {
    const sessions = await invokeRunner<Session[], "session.list">("session.list", {});
    const currentState = get();
    const fallbackFolderId = resolveFallbackFolderId(currentState.folders, currentState.activeFolderId);
    const folderAssignments = ensureSessionAssignments(
      sessions,
      currentState.folders,
      currentState.folderAssignments,
    );
    const permissionModeBySession = ensurePermissionModes(
      sessions,
      currentState.permissionModeBySession,
    );
    const sessionIds = new Set(sessions.map((session) => session.id));
    const selectedSessionId =
      currentState.selectedSessionId && sessionIds.has(currentState.selectedSessionId)
        ? currentState.selectedSessionId
        : currentState.selectedSessionId === null
          ? null
          : sessions[0]?.id ?? null;
    const activeFolderId =
      selectedSessionId && folderAssignments[selectedSessionId]
        ? folderAssignments[selectedSessionId]
        : fallbackFolderId;

    set({
      sessions,
      selectedSessionId,
      folderAssignments,
      permissionModeBySession,
      activeFolderId,
      reasoningLevel:
        selectedSessionId && currentState.reasoningBySession[selectedSessionId]
          ? currentState.reasoningBySession[selectedSessionId]
          : currentState.reasoningLevel,
    });
    schedulePersistDesktopUiState(get());

    const unresolvedSessionIds = sessions
      .filter(
        (session) =>
          !get().firstUserMessageBySession[session.id] && !get().renamedSessionIds[session.id],
      )
      .map((session) => session.id);

    if (unresolvedSessionIds.length === 0) {
      return;
    }

    const responses = await Promise.all(
      unresolvedSessionIds.map(async (sessionId) => {
        try {
          const detail = await invokeRunner<SessionDetailResponse, "session.get">("session.get", {
            sessionId,
          });
          return { sessionId, detail };
        } catch {
          return null;
        }
      }),
    );

    const validResponses = responses.filter(
      (entry): entry is { sessionId: string; detail: SessionDetailResponse } => entry !== null,
    );

    if (validResponses.length === 0) {
      return;
    }

    set((state) => {
      const nextDetails = { ...state.sessionDetailsById };
      const nextFirstPrompts = { ...state.firstUserMessageBySession };
      for (const response of validResponses) {
        nextDetails[response.sessionId] = response.detail;
        nextFirstPrompts[response.sessionId] = firstUserMessage(response.detail.messages);
      }
      return {
        sessionDetailsById: nextDetails,
        firstUserMessageBySession: nextFirstPrompts,
      };
    });
  },

  async loadGitStatus() {
    const gitState = await invokeRunner<GitRepoState, "git.status">("git.status", {});
    set({ gitState });
  },

  async loadModelCatalog() {
    const modelCatalog = await invokeRunner<ModelListResult, "model.list">("model.list", {});
    set({ modelCatalog });
  },

  async openComposerFileDialog() {
    const gateway = requireGateway();
    const result = await gateway.showOpenDialog({
      title: "添加文件或目录到上下文",
      properties: ["openDirectory", "openFile", "multiSelections"],
    });
    if (result.canceled) {
      return;
    }
    set((state) => ({
      selectedFiles: [...new Set([...state.selectedFiles, ...result.filePaths])],
    }));
  },

  removeSelectedFile(path) {
    set((state) => ({
      selectedFiles: state.selectedFiles.filter((value) => value !== path),
    }));
  },

  clearSelectedFiles() {
    set({ selectedFiles: [] });
  },

  async toggleDiffPanel() {
    const showDiffPanel = !get().uiPanels.showDiffPanel;
    set((state) => ({
      uiPanels: {
        ...state.uiPanels,
        showDiffPanel,
      },
    }));
    if (showDiffPanel) {
      await get().loadGitStatus();
    }
  },

  async openDiffPreview(path) {
    const preview = await invokeRunner<GitDiffPreview, "git.diff">("git.diff", { path });
    set((state) => ({
      diffPath: path,
      diffPreview: preview,
      uiPanels: {
        ...state.uiPanels,
        showDiffPanel: true,
      },
    }));
  },

  async switchModel(providerConfigId) {
    const sessionId = get().selectedSessionId;
    if (!sessionId || !providerConfigId) {
      return;
    }
    await invokeRunner("session.model.switch", {
      sessionId,
      providerConfigId,
    });
    await get().refreshSession(sessionId);
  },

  async saveProviderConfig(params) {
    const protocol = assertProviderProtocol(params.protocol);
    await invokeRunner("provider.config.save", {
      id: params.id,
      name: params.name,
      protocol,
      baseUrl: params.baseUrl ?? "",
      model: params.model,
      apiKey: params.apiKey,
      url: params.url ?? "",
    });
    await get().loadModelCatalog();
  },

  async deleteProviderConfig(id) {
    await invokeRunner("provider.config.delete", { id });
    await get().loadModelCatalog();
  },

  setReasoningLevel(level) {
    const sessionId = get().selectedSessionId;
    set((state) => {
      const nextReasoningBySession = sessionId
        ? { ...state.reasoningBySession, [sessionId]: level }
        : state.reasoningBySession;
      return {
        reasoningLevel: level,
        reasoningBySession: nextReasoningBySession,
      };
    });
    schedulePersistDesktopUiState(get());
  },

  setPermissionMode(mode) {
    const sessionId = get().selectedSessionId;
    set((state) => ({
      permissionModeBySession: sessionId
        ? {
            ...state.permissionModeBySession,
            [sessionId]: mode,
          }
        : state.permissionModeBySession,
      newThreadPermissionMode: mode,
    }));
    if (sessionId) {
      void invokeRunner("session.permission.set", {
        sessionId,
        mode,
      }).catch(() => undefined);
    }
    schedulePersistDesktopUiState(get());
  },

  setUiPanelOpen(panel, open) {
    set((state) => ({
      uiPanels: {
        ...state.uiPanels,
        [panel]: open,
      },
    }));
  },

  closeAllPanels() {
    set((state) => ({
      uiPanels: {
        ...state.uiPanels,
        modelMenuOpen: false,
        reasoningMenuOpen: false,
        editorMenuOpen: false,
        commitMenuOpen: false,
        slashMenuOpen: false,
      },
    }));
  },

  async approveToolCall(toolCallId) {
    await invokeRunner("tool.approve", {
      toolCallId,
      decision: "approved",
    });
    await Promise.all([get().refreshSelectedSession(), get().loadGitStatus()]);
  },

  async rejectToolCall(toolCallId) {
    await invokeRunner("tool.reject", {
      toolCallId,
    });
    await Promise.all([get().refreshSelectedSession(), get().loadGitStatus()]);
  },

  async cancelRun() {
    const sessionId = get().selectedSessionId;
    if (!sessionId) return;
    const runtime = get().sessionRuntimeById[sessionId];
    const streamingRunId = get().streamingBySession[sessionId]?.runId;
    const activeRunId = runtime?.activeRunId ?? streamingRunId;
    if (!activeRunId) return;

    try {
      await invokeRunner("run.cancel", { runId: activeRunId });
    } catch {
      // Cancel may fail if the run already completed.
    }
    await get().refreshSession(sessionId);
  },

  async addFolderFromDialog() {
    const gateway = requireGateway();
    const result = await gateway.showOpenDialog({
      title: "添加真实目录",
      properties: ["openDirectory", "multiSelections"],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return;
    }

    const selectedPaths = [...new Set(result.filePaths)];
    set((state) => {
      const existingFolderIdsByPath = new Map(
        state.folders.map((folder) => [folder.path, folder.id]),
      );
      const existingSelectedFolderIds = selectedPaths
        .map((path) => existingFolderIdsByPath.get(path))
        .filter((folderId): folderId is string => typeof folderId === "string");
      const createdFolders = selectedPaths
        .filter((path) => !existingFolderIdsByPath.has(path))
        .map((path) => ({
          id: generateFolderId(path),
          name: buildFolderName(path),
          path,
        }));

      if (createdFolders.length === 0 && existingSelectedFolderIds.length === 0) {
        return state;
      }

      const nextFolders = createdFolders.length > 0 ? [...state.folders, ...createdFolders] : state.folders;
      const nextOpenFolders = {
        ...state.openFolderIds,
        ...Object.fromEntries(existingSelectedFolderIds.map((folderId) => [folderId, true])),
        ...Object.fromEntries(createdFolders.map((folder) => [folder.id, true])),
      };
      return {
        folders: nextFolders,
        openFolderIds: nextOpenFolders,
        activeFolderId: createdFolders[0]?.id ?? existingSelectedFolderIds[0] ?? state.activeFolderId,
      };
    });
    await persistDesktopUiStateNow(get());
  },

  toggleFolder(folderId) {
    set((state) => {
      const nextOpenFolders = {
        ...state.openFolderIds,
        [folderId]: !state.openFolderIds[folderId],
      };
      return {
        openFolderIds: nextOpenFolders,
      };
    });
    schedulePersistDesktopUiState(get());
  },

  removeFolder(folderId) {
    set((state) => {
      const folderToRemove = state.folders.find((folder) => folder.id === folderId);
      if (!folderToRemove) {
        return state;
      }
      const nextFolders = state.folders.filter((folder) => folder.id !== folderId);
      const fallbackFolderId = resolveFallbackFolderId(nextFolders, state.activeFolderId);
      const nextFolderIdSet = new Set(nextFolders.map((folder) => folder.id));
      const nextAssignments: Record<string, string> = {};
      for (const [sessionId, assignedFolderId] of Object.entries(state.folderAssignments)) {
        if (assignedFolderId !== folderId && nextFolderIdSet.has(assignedFolderId)) {
          nextAssignments[sessionId] = assignedFolderId;
        }
      }
      const nextOpenFolders = ensureOpenFolderMap(nextFolders, state.openFolderIds);
      return {
        folders: nextFolders,
        openFolderIds: nextOpenFolders,
        activeFolderId: fallbackFolderId,
        folderAssignments: nextAssignments,
      };
    });
    schedulePersistDesktopUiState(get());
  },

  setActiveFolder(folderId) {
    const sessionId = get().selectedSessionId;
    set((state) => ({
      activeFolderId: folderId,
      folderAssignments: sessionId
        ? {
            ...state.folderAssignments,
            [sessionId]: folderId,
          }
        : state.folderAssignments,
    }));
    if (sessionId) {
      void invokeRunner("session.workspace.set", {
        sessionId,
        workspaceRoot: resolveSessionWorkspaceRoot(get(), sessionId),
      }).catch(() => undefined);
    }
    schedulePersistDesktopUiState(get());
  },

  startRenameSession(sessionId) {
    const state = get();
    const session = state.sessions.find((item) => item.id === sessionId);
    if (!session) {
      return;
    }
    const firstPrompt = state.firstUserMessageBySession[sessionId];
    const renamed = Boolean(state.renamedSessionIds[sessionId]);
    set({
      editingSessionId: sessionId,
      editingSessionDraft: deriveThreadTitle(session.title, firstPrompt, renamed),
    });
  },

  setEditingSessionDraft(value) {
    set({ editingSessionDraft: value });
  },

  cancelRenameSession() {
    set({
      editingSessionId: null,
      editingSessionDraft: "",
    });
  },

  async commitRenameSession() {
    const { editingSessionId, editingSessionDraft } = get();
    if (!editingSessionId) {
      return;
    }
    const title = editingSessionDraft.trim();
    if (!title) {
      get().cancelRenameSession();
      return;
    }

    const result = await invokeRunner<{ session: Session }, "session.title.update">(
      "session.title.update",
      {
        sessionId: editingSessionId,
        title,
      },
    );

    set((state) => {
      const nextRenamedSessionIds = {
        ...state.renamedSessionIds,
        [editingSessionId]: true,
      };
      return {
        sessions: state.sessions.map((session) =>
          session.id === editingSessionId ? result.session : session,
        ),
        sessionDetailsById: state.sessionDetailsById[editingSessionId]
          ? {
              ...state.sessionDetailsById,
              [editingSessionId]: {
                ...state.sessionDetailsById[editingSessionId],
                session: result.session,
              },
            }
          : state.sessionDetailsById,
        renamedSessionIds: nextRenamedSessionIds,
        editingSessionId: null,
        editingSessionDraft: "",
      };
    });
    schedulePersistDesktopUiState(get());
  },

  async executeSlashCommand(command) {
    const lower = command.toLowerCase();
    switch (lower) {
      case "model":
        set((state) => ({
          composerInput: "",
          uiPanels: { ...state.uiPanels, slashMenuOpen: false, modelMenuOpen: true },
        }));
        break;
      case "reasoning":
        set((state) => ({
          composerInput: "",
          uiPanels: { ...state.uiPanels, slashMenuOpen: false, reasoningMenuOpen: true },
        }));
        break;
      case "计划模式":
      case "plan": {
        set((state) => ({
          composerInput: "",
          uiPanels: { ...state.uiPanels, slashMenuOpen: false },
        }));
        await get().sendPromptText("/plan", { clearComposer: true });
        break;
      }
      case "compact": {
        const sessionId = get().selectedSessionId;
        set((state) => ({
          composerInput: "",
          uiPanels: { ...state.uiPanels, slashMenuOpen: false },
        }));
        if (sessionId) {
          set((state) => ({
            errorBySession: {
              ...state.errorBySession,
              [sessionId]: "命令 /compact 已下线，请使用 /plan 或直接描述需求。",
            },
          }));
        }
        break;
      }
      case "状态":
      case "status": {
        const sessionId = get().selectedSessionId;
        set((state) => ({
          composerInput: "",
          uiPanels: { ...state.uiPanels, slashMenuOpen: false },
        }));
        if (sessionId) {
          const runtime = get().sessionRuntimeById[sessionId];
          const status = runtime?.activeRunId ? "运行中" : "空闲";
          set((state) => ({
            errorBySession: {
              ...state.errorBySession,
              [sessionId]: `会话 ID: ${sessionId} | 状态: ${status}`,
            },
          }));
        }
        break;
      }
      default:
        set((state) => ({
          composerInput: "",
          uiPanels: { ...state.uiPanels, slashMenuOpen: false },
        }));
        break;
    }
  },

  async handleRunnerEvent(event) {
    // Route log entries to diagnostics store
    if (event.type === "log.entry") {
      const level = String(event.payload.level ?? "info") as DiagnosticLogLevel;
      const { enableDebug } = useDiagnosticsStore.getState();
      if (level === "debug" && !enableDebug) return;
      useDiagnosticsStore.getState().addLog({
        timestamp: String(event.payload.timestamp ?? ""),
        level,
        component: String(event.payload.component ?? ""),
        message: String(event.payload.message ?? ""),
        context: (event.payload.context as Record<string, unknown>) ?? {},
      });
      return;
    }

    const sessionId =
      typeof event.payload.sessionId === "string" ? event.payload.sessionId : null;
    const fallbackSessionId =
      event.type === "run.tool_started" || event.type === "run.tool_finished"
        ? get().selectedSessionId
        : null;
    const targetSessionId = sessionId ?? fallbackSessionId;
    const runId = typeof event.payload.runId === "string" ? event.payload.runId : "";

    if (event.type === "run.delta" && sessionId) {
      const delta = typeof event.payload.delta === "string" ? event.payload.delta : "";
      if (delta) {
        set((state) => {
          const currentStreaming = state.streamingBySession[sessionId];
          const nextContent =
            currentStreaming && currentStreaming.runId === runId
              ? `${currentStreaming.content}${delta}`
              : delta;
          return {
            streamingBySession: {
              ...state.streamingBySession,
              [sessionId]: {
                runId,
                content: nextContent,
              },
            },
          };
        });
      }
      return;
    }

    if (event.type === "run.started" && sessionId) {
      set((state) => {
        const nextErrors = { ...state.errorBySession };
        delete nextErrors[sessionId];
        const nextBlocked = { ...state.blockedToolBySession };
        delete nextBlocked[sessionId];
        const nextSkills = { ...state.resolvedSkillBySession };
        delete nextSkills[sessionId];
        const nextUsage = { ...state.usageBySession };
        delete nextUsage[sessionId];
        return {
          streamingBySession: {
            ...state.streamingBySession,
            [sessionId]: { runId, content: "" },
          },
          errorBySession: nextErrors,
          blockedToolBySession: nextBlocked,
          resolvedSkillBySession: nextSkills,
          usageBySession: nextUsage,
          toolProgressBySession: {
            ...state.toolProgressBySession,
            [sessionId]: {},
          },
        };
      });
    }

    if ((event.type === "run.skills_resolved" || event.type === "run.skill_selected") && sessionId) {
      const skillName = typeof event.payload.skillName === "string" ? event.payload.skillName : "";
      const enabledToolNames = Array.isArray(event.payload.enabledToolNames)
        ? (event.payload.enabledToolNames as string[])
        : [];
      if (skillName) {
        set((state) => ({
          resolvedSkillBySession: {
            ...state.resolvedSkillBySession,
            [sessionId]: { skillName, enabledToolNames },
          },
        }));
      }
      return;
    }

    if (event.type === "run.tool_requested" && targetSessionId) {
      const toolCallId = typeof event.payload.toolCallId === "string" ? event.payload.toolCallId : "";
      const toolName = typeof event.payload.toolName === "string" ? event.payload.toolName : "";
      const requiresApproval = event.payload.requiresApproval === true;
      if (toolCallId && requiresApproval) {
        set((state) => ({
          pendingToolCallsBySession: {
            ...state.pendingToolCallsBySession,
            [targetSessionId]: [
              ...(state.pendingToolCallsBySession[targetSessionId] ?? []),
              {
                id: toolCallId,
                messageId: toolCallId,
                sessionId: targetSessionId,
                toolName,
                approvalState: "pending" as const,
                input: (event.payload.input as Record<string, unknown>) ?? {},
                output: null,
                error: null,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            ],
          },
        }));
      }
      return;
    }

    if (event.type === "run.tool_started" && targetSessionId) {
      const toolCallId = typeof event.payload.toolCallId === "string" ? event.payload.toolCallId : "";
      const toolName = typeof event.payload.toolName === "string" ? event.payload.toolName : "";
      if (toolCallId) {
        set((state) => ({
          activeToolsBySession: {
            ...state.activeToolsBySession,
            [targetSessionId]: [
              ...(state.activeToolsBySession[targetSessionId] ?? []),
              { toolCallId, toolName },
            ],
          },
        }));
      }
    }

    if ((event.type === "run.tool_finished" || event.type === "run.tool_failed") && targetSessionId) {
      const toolCallId = typeof event.payload.toolCallId === "string" ? event.payload.toolCallId : "";
      if (toolCallId) {
        set((state) => {
          const nextProgress = { ...(state.toolProgressBySession[targetSessionId] ?? {}) };
          delete nextProgress[toolCallId];
          return {
            activeToolsBySession: {
              ...state.activeToolsBySession,
              [targetSessionId]: (state.activeToolsBySession[targetSessionId] ?? []).filter(
                (t) => t.toolCallId !== toolCallId,
              ),
            },
            toolProgressBySession: {
              ...state.toolProgressBySession,
              [targetSessionId]: nextProgress,
            },
          };
        });
      }
    }

    if (event.type === "run.tool_progress" && targetSessionId) {
      const toolCallId = typeof event.payload.toolCallId === "string" ? event.payload.toolCallId : "";
      const toolName = typeof event.payload.toolName === "string" ? event.payload.toolName : "";
      if (toolCallId) {
        set((state) => ({
          toolProgressBySession: {
            ...state.toolProgressBySession,
            [targetSessionId]: {
              ...(state.toolProgressBySession[targetSessionId] ?? {}),
              [toolCallId]: { toolCallId, toolName, lastUpdated: new Date().toISOString() },
            },
          },
        }));
      }
      return;
    }

    if (event.type === "run.blocked" && sessionId) {
      const toolCallId = typeof event.payload.toolCallId === "string" ? event.payload.toolCallId : "";
      const toolName = typeof event.payload.toolName === "string" ? event.payload.toolName : "";
      const input = (event.payload.input as Record<string, unknown>) ?? {};
      set((state) => ({
        blockedToolBySession: {
          ...state.blockedToolBySession,
          [sessionId]: { toolCallId, toolName, input },
        },
      }));
    }

    if (event.type === "run.tool_decided" && sessionId) {
      set((state) => {
        const blocked = state.blockedToolBySession[sessionId];
        const toolCallId = typeof event.payload.toolCallId === "string" ? event.payload.toolCallId : "";
        const nextBlocked = blocked?.toolCallId === toolCallId
          ? { ...state.blockedToolBySession, [sessionId]: null }
          : state.blockedToolBySession;
        return {
          blockedToolBySession: nextBlocked,
          pendingToolCallsBySession: {
            ...state.pendingToolCallsBySession,
            [sessionId]: (state.pendingToolCallsBySession[sessionId] ?? []).filter(
              (tc) => tc.id !== toolCallId,
            ),
          },
        };
      });
    }

    if (
      (event.type === "run.completed" ||
        event.type === "run.failed" ||
        event.type === "run.canceled") &&
      sessionId
    ) {
      set((state) => {
        const nextErrors = { ...state.errorBySession };
        if (event.type === "run.failed") {
          const errorMsg =
            typeof event.payload.error === "string"
              ? event.payload.error
              : "运行失败";
          nextErrors[sessionId] = errorMsg;
        }

        // Store usage from run.completed
        let nextUsage = state.usageBySession;
        if (event.type === "run.completed" && event.payload.usage) {
          const usage = event.payload.usage as Record<string, unknown>;
          nextUsage = {
            ...state.usageBySession,
            [sessionId]: {
              inputTokens: Number(usage.inputTokens ?? 0),
              outputTokens: Number(usage.outputTokens ?? 0),
              cacheReadTokens: Number(usage.cacheReadTokens ?? 0) || undefined,
              cacheCreationTokens: Number(usage.cacheCreationTokens ?? 0) || undefined,
            },
          };
        }

        // Clear blocked state on terminal events
        const nextBlocked = { ...state.blockedToolBySession };
        delete nextBlocked[sessionId];

        return {
          errorBySession: nextErrors,
          usageBySession: nextUsage,
          blockedToolBySession: nextBlocked,
        };
      });
    }

    if (sessionId) {
      await get().refreshSession(sessionId);
    } else if (event.type.startsWith("run.")) {
      await get().refreshSelectedSession();
    }

    if (event.type.startsWith("run.")) {
      await get().loadSessions();
    }

    if (
      event.type === "run.completed" ||
      event.type === "run.failed" ||
      event.type === "run.canceled" ||
      event.type === "run.tool_finished" ||
      event.type === "run.tool_decided"
    ) {
      await get().loadGitStatus();
    }
  },
}));
