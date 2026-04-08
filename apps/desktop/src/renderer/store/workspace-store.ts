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
} from "@omi/protocol";

import { getRunnerGateway, type RunnerEventEnvelope } from "../lib/runner-gateway";

const FOLDER_STORAGE_KEY = "omi.desktop.folders.v1";
const ASSIGNMENT_STORAGE_KEY = "omi.desktop.folder-assignments.v1";
const OPEN_FOLDER_STORAGE_KEY = "omi.desktop.open-folders.v1";
const REASONING_STORAGE_KEY = "omi.desktop.reasoning.v1";
const RENAMED_SESSION_STORAGE_KEY = "omi.desktop.renamed-sessions.v1";

const DEFAULT_REASONING_LEVEL: ReasoningLevel = "高";

let runnerUnsubscribe: (() => void) | null = null;

export type ReasoningLevel = "低" | "中" | "高" | "超高";

export interface WorkspaceFolder {
  id: string;
  name: string;
  path: string | null;
  kind: "mock" | "real";
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
    type: string;
    protocol?: string;
    baseUrl?: string;
    model: string;
    apiKey: string;
  }) => Promise<void>;
  deleteProviderConfig: (id: string) => Promise<void>;
  setReasoningLevel: (level: ReasoningLevel) => void;
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

function defaultMockFolders(): WorkspaceFolder[] {
  return [
    { id: "mock-erduo-skills", name: "erduo-skills", path: null, kind: "mock" },
    { id: "mock-erduo-site", name: "erduo-site", path: null, kind: "mock" },
    { id: "mock-douyin-ai", name: "douyin-ai", path: null, kind: "mock" },
    { id: "mock-zettelkasten", name: "Zettelkasten", path: null, kind: "mock" },
    { id: "mock-myforge", name: "MyForge", path: null, kind: "mock" },
  ];
}

function createInitialData(): WorkspaceStoreData {
  const folders = defaultMockFolders();
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
    openFolderIds: Object.fromEntries(folders.map((folder) => [folder.id, folder.id === folders[0]?.id])),
    activeFolderId: folders[0]?.id ?? null,
    composerInput: "",
    selectedFiles: [],
    reasoningBySession: {},
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

function parseStoredJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") {
    return fallback;
  }
  const rawValue = window.localStorage.getItem(key);
  if (!rawValue) {
    return fallback;
  }
  try {
    return JSON.parse(rawValue) as T;
  } catch {
    return fallback;
  }
}

function persistJson<T>(key: string, value: T): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(value));
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
  fallbackFolderId: string | null,
): Record<string, string> {
  const folderIds = new Set(folders.map((folder) => folder.id));
  const nextAssignments: Record<string, string> = {};
  for (const session of sessions) {
    const assigned = assignments[session.id];
    if (assigned && folderIds.has(assigned)) {
      nextAssignments[session.id] = assigned;
      continue;
    }
    const preferredFolder = fallbackFolderId ?? folders[0]?.id ?? null;
    if (preferredFolder) {
      nextAssignments[session.id] = preferredFolder;
    }
  }
  return nextAssignments;
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

    const storedRealFolders = parseStoredJson<WorkspaceFolder[]>(FOLDER_STORAGE_KEY, []);
    const storedAssignments = parseStoredJson<Record<string, string>>(ASSIGNMENT_STORAGE_KEY, {});
    const storedOpenFolders = parseStoredJson<Record<string, boolean>>(OPEN_FOLDER_STORAGE_KEY, {});
    const storedReasoning = parseStoredJson<Record<string, ReasoningLevel>>(REASONING_STORAGE_KEY, {});
    const storedRenamedSessions = parseStoredJson<Record<string, boolean>>(
      RENAMED_SESSION_STORAGE_KEY,
      {},
    );

    const folders = [
      ...defaultMockFolders(),
      ...storedRealFolders.filter((folder) => folder.kind === "real"),
    ];
    const openFolderIds = ensureOpenFolderMap(folders, storedOpenFolders);
    const activeFolderId = resolveFallbackFolderId(folders, folders[0]?.id ?? null);

    set({
      bridgeAvailable: getRunnerGateway() !== null,
      folders,
      folderAssignments: storedAssignments,
      openFolderIds,
      activeFolderId,
      reasoningBySession: storedReasoning,
      renamedSessionIds: storedRenamedSessions,
    });

    const gateway = getRunnerGateway();
    if (!gateway) {
      set({
        initialized: true,
        initializing: false,
        bridgeAvailable: false,
      });
      return;
    }

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
      console.log("[bridge] 实时连接已启用");
    } catch (error) {
      set({
        initializing: false,
        bridgeAvailable: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  resetForTests() {
    if (runnerUnsubscribe) {
      runnerUnsubscribe();
      runnerUnsubscribe = null;
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

    let sessionId = get().selectedSessionId;
    if (!sessionId) {
      const session = await invokeRunner<Session, "session.create">("session.create", {
        title: deriveSessionTitleFromPrompt(prompt),
      });
      sessionId = session.id;
      set((state) => ({
        selectedSessionId: session.id,
        sessions: [session, ...state.sessions.filter((item) => item.id !== session.id)],
      }));
    }

    const files = get().selectedFiles;
    await invokeRunner("run.start", {
      sessionId,
      taskId: null,
      prompt,
      ...(files.length > 0 ? { contextFiles: files } : {}),
    });

    set((state) => ({
      composerInput: "",
      selectedFiles: [],
      uiPanels: {
        ...state.uiPanels,
        slashMenuOpen: false,
      },
    }));

    await Promise.all([
      get().loadSessions(),
      get().refreshSession(sessionId),
      get().loadGitStatus(),
    ]);
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
  },

  async selectSession(sessionId) {
    const preferredReasoning = get().reasoningBySession[sessionId] ?? DEFAULT_REASONING_LEVEL;
    set({
      selectedSessionId: sessionId,
      reasoningLevel: preferredReasoning,
      uiPanels: {
        ...get().uiPanels,
        showDiffPanel: false,
      },
      diffPreview: null,
      diffPath: null,
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
    set((state) => ({
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
      sessions: state.sessions.map((session) =>
        session.id === detail.session.id ? detail.session : session,
      ),
    }));
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
    const activeFolderId = resolveFallbackFolderId(currentState.folders, currentState.activeFolderId);
    const folderAssignments = ensureSessionAssignments(
      sessions,
      currentState.folders,
      currentState.folderAssignments,
      activeFolderId,
    );
    const selectedSessionId =
      currentState.selectedSessionId && sessions.some((session) => session.id === currentState.selectedSessionId)
        ? currentState.selectedSessionId
        : sessions[0]?.id ?? null;

    set({
      sessions,
      selectedSessionId,
      folderAssignments,
      activeFolderId,
      reasoningLevel:
        selectedSessionId && currentState.reasoningBySession[selectedSessionId]
          ? currentState.reasoningBySession[selectedSessionId]
          : currentState.reasoningLevel,
    });

    persistJson(ASSIGNMENT_STORAGE_KEY, folderAssignments);

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
    await invokeRunner("provider.config.save", {
      id: params.id,
      type: params.type,
      protocol: params.protocol as "anthropic-messages" | "openai-chat" | "openai-responses" | undefined,
      baseUrl: params.baseUrl ?? "",
      model: params.model,
      apiKey: params.apiKey,
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
      persistJson(REASONING_STORAGE_KEY, nextReasoningBySession);
      return {
        reasoningLevel: level,
        reasoningBySession: nextReasoningBySession,
      };
    });
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
    const activeRunId = runtime?.activeRunId;
    if (!activeRunId) return;
    await invokeRunner("run.cancel", { runId: activeRunId });
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

    set((state) => {
      const existingPaths = new Set(
        state.folders.filter((folder) => folder.kind === "real").map((folder) => folder.path),
      );
      const createdFolders = result.filePaths
        .filter((path) => !existingPaths.has(path))
        .map((path) => ({
          id: generateFolderId(path),
          name: buildFolderName(path),
          path,
          kind: "real" as const,
        }));
      if (createdFolders.length === 0) {
        return state;
      }

      const nextFolders = [...state.folders, ...createdFolders];
      const nextOpenFolders = {
        ...state.openFolderIds,
        ...Object.fromEntries(createdFolders.map((folder) => [folder.id, true])),
      };
      persistJson(
        FOLDER_STORAGE_KEY,
        nextFolders.filter((folder) => folder.kind === "real"),
      );
      persistJson(OPEN_FOLDER_STORAGE_KEY, nextOpenFolders);
      return {
        folders: nextFolders,
        openFolderIds: nextOpenFolders,
        activeFolderId: createdFolders[0]?.id ?? state.activeFolderId,
      };
    });
  },

  toggleFolder(folderId) {
    set((state) => {
      const nextOpenFolders = {
        ...state.openFolderIds,
        [folderId]: !state.openFolderIds[folderId],
      };
      persistJson(OPEN_FOLDER_STORAGE_KEY, nextOpenFolders);
      return {
        openFolderIds: nextOpenFolders,
      };
    });
  },

  removeFolder(folderId) {
    set((state) => {
      const folderToRemove = state.folders.find((folder) => folder.id === folderId);
      if (!folderToRemove || folderToRemove.kind !== "real") {
        return state;
      }
      const nextFolders = state.folders.filter((folder) => folder.id !== folderId);
      const fallbackFolderId =
        resolveFallbackFolderId(nextFolders, state.activeFolderId) ??
        state.folders[0]?.id ??
        "mock-erduo-skills";
      const nextAssignments: Record<string, string> = {};
      for (const [sessionId, assignedFolderId] of Object.entries(state.folderAssignments)) {
        nextAssignments[sessionId] =
          assignedFolderId === folderId ? fallbackFolderId : assignedFolderId;
      }
      const nextOpenFolders = ensureOpenFolderMap(nextFolders, state.openFolderIds);
      persistJson(
        FOLDER_STORAGE_KEY,
        nextFolders.filter((folder) => folder.kind === "real"),
      );
      persistJson(OPEN_FOLDER_STORAGE_KEY, nextOpenFolders);
      persistJson(ASSIGNMENT_STORAGE_KEY, nextAssignments);
      return {
        folders: nextFolders,
        openFolderIds: nextOpenFolders,
        activeFolderId: fallbackFolderId,
        folderAssignments: nextAssignments,
      };
    });
  },

  setActiveFolder(folderId) {
    set({ activeFolderId: folderId });
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
      persistJson(RENAMED_SESSION_STORAGE_KEY, nextRenamedSessionIds);
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
      case "compact": {
        const sessionId = get().selectedSessionId;
        if (sessionId) {
          set((state) => ({
            composerInput: "",
            uiPanels: { ...state.uiPanels, slashMenuOpen: false },
          }));
          await invokeRunner("session.compact", { sessionId });
          await get().refreshSession(sessionId);
        }
        break;
      }
      case "计划模式":
      case "plan": {
        const sessionId = get().selectedSessionId;
        if (sessionId) {
          set((state) => ({
            composerInput: "",
            uiPanels: { ...state.uiPanels, slashMenuOpen: false },
          }));
          await invokeRunner("session.mode.enter", { sessionId, mode: "plan" });
          await get().refreshSession(sessionId);
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
        return {
          streamingBySession: {
            ...state.streamingBySession,
            [sessionId]: {
              runId,
              content: "",
            },
          },
          errorBySession: nextErrors,
        };
      });
    }

    if (event.type === "run.tool_started" && sessionId) {
      const toolCallId = typeof event.payload.toolCallId === "string" ? event.payload.toolCallId : "";
      const toolName = typeof event.payload.toolName === "string" ? event.payload.toolName : "";
      if (toolCallId) {
        set((state) => ({
          activeToolsBySession: {
            ...state.activeToolsBySession,
            [sessionId]: [
              ...(state.activeToolsBySession[sessionId] ?? []),
              { toolCallId, toolName },
            ],
          },
        }));
      }
    }

    if (event.type === "run.tool_finished" && sessionId) {
      const toolCallId = typeof event.payload.toolCallId === "string" ? event.payload.toolCallId : "";
      if (toolCallId) {
        set((state) => ({
          activeToolsBySession: {
            ...state.activeToolsBySession,
            [sessionId]: (state.activeToolsBySession[sessionId] ?? []).filter(
              (t) => t.toolCallId !== toolCallId,
            ),
          },
        }));
      }
    }

    if (
      (event.type === "run.completed" ||
        event.type === "run.failed" ||
        event.type === "run.canceled") &&
      sessionId
    ) {
      set((state) => {
        const nextStreaming = { ...state.streamingBySession };
        delete nextStreaming[sessionId];
        const nextErrors = { ...state.errorBySession };
        if (event.type === "run.failed") {
          const errorMsg =
            typeof event.payload.error === "string"
              ? event.payload.error
              : "运行失败";
          nextErrors[sessionId] = errorMsg;
        }
        return {
          streamingBySession: nextStreaming,
          errorBySession: nextErrors,
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
