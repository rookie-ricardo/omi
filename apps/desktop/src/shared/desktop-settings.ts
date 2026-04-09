export type DesktopReasoningLevel = "低" | "中" | "高" | "超高";
export type DesktopPermissionMode = "default" | "full-access";

export interface DesktopUiFolder {
  id: string;
  name: string;
  path: string;
}

export interface DesktopUiState {
  folders: DesktopUiFolder[];
  sessionFolderAssignments: Record<string, string>;
  openFolderIds: string[];
  activeFolderId: string | null;
  selectedSessionId: string | null;
  reasoningBySession: Record<string, DesktopReasoningLevel>;
  permissionModeBySession: Record<string, DesktopPermissionMode>;
  renamedSessionIds: Record<string, boolean>;
}

export interface DesktopWindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized: boolean;
}

export interface DesktopSettings {
  version: 1;
  uiState: DesktopUiState;
  windowState: DesktopWindowState;
}

export interface DesktopSettingsPatch {
  uiState?: Partial<DesktopUiState>;
  windowState?: Partial<DesktopWindowState>;
}

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
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

function ensureRecordString(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") {
      result[key] = value;
    }
  }
  return result;
}

function ensureRecordBoolean(input: unknown): Record<string, boolean> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  const result: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "boolean") {
      result[key] = value;
    }
  }
  return result;
}

function ensurePermissionModeRecord(input: unknown): Record<string, DesktopPermissionMode> {
  const raw = ensureRecordString(input);
  const result: Record<string, DesktopPermissionMode> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === "default" || value === "full-access") {
      result[key] = value;
    }
  }
  return result;
}

export function normalizeDesktopSettings(raw: unknown): DesktopSettings {
  const input = (!raw || typeof raw !== "object" ? {} : raw) as Record<string, unknown>;
  const uiStateRaw =
    input.uiState && typeof input.uiState === "object" && !Array.isArray(input.uiState)
      ? (input.uiState as Record<string, unknown>)
      : {};
  const windowStateRaw =
    input.windowState && typeof input.windowState === "object" && !Array.isArray(input.windowState)
      ? (input.windowState as Record<string, unknown>)
      : {};

  const folders = Array.isArray(uiStateRaw.folders)
    ? uiStateRaw.folders
        .map((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) {
            return null;
          }
          const obj = item as Record<string, unknown>;
          if (typeof obj.id !== "string" || typeof obj.name !== "string" || typeof obj.path !== "string") {
            return null;
          }
          return { id: obj.id, name: obj.name, path: obj.path };
        })
        .filter((item): item is DesktopUiFolder => item !== null)
    : [];

  const openFolderIds = Array.isArray(uiStateRaw.openFolderIds)
    ? uiStateRaw.openFolderIds.filter((item): item is string => typeof item === "string")
    : [];

  const reasoningBySessionRaw = ensureRecordString(uiStateRaw.reasoningBySession);
  const reasoningBySession: Record<string, DesktopReasoningLevel> = {};
  for (const [key, value] of Object.entries(reasoningBySessionRaw)) {
    if (value === "低" || value === "中" || value === "高" || value === "超高") {
      reasoningBySession[key] = value;
    }
  }

  return {
    version: 1,
    uiState: {
      folders,
      sessionFolderAssignments: ensureRecordString(uiStateRaw.sessionFolderAssignments),
      openFolderIds,
      activeFolderId: typeof uiStateRaw.activeFolderId === "string" ? uiStateRaw.activeFolderId : null,
      selectedSessionId: typeof uiStateRaw.selectedSessionId === "string" ? uiStateRaw.selectedSessionId : null,
      reasoningBySession,
      permissionModeBySession: ensurePermissionModeRecord(uiStateRaw.permissionModeBySession),
      renamedSessionIds: ensureRecordBoolean(uiStateRaw.renamedSessionIds),
    },
    windowState: {
      width:
        typeof windowStateRaw.width === "number" && Number.isFinite(windowStateRaw.width)
          ? Math.max(640, Math.floor(windowStateRaw.width))
          : DEFAULT_DESKTOP_SETTINGS.windowState.width,
      height:
        typeof windowStateRaw.height === "number" && Number.isFinite(windowStateRaw.height)
          ? Math.max(480, Math.floor(windowStateRaw.height))
          : DEFAULT_DESKTOP_SETTINGS.windowState.height,
      x:
        typeof windowStateRaw.x === "number" && Number.isFinite(windowStateRaw.x)
          ? Math.floor(windowStateRaw.x)
          : undefined,
      y:
        typeof windowStateRaw.y === "number" && Number.isFinite(windowStateRaw.y)
          ? Math.floor(windowStateRaw.y)
          : undefined,
      maximized: windowStateRaw.maximized === true,
    },
  };
}

export function mergeDesktopSettings(
  current: DesktopSettings,
  patch: DesktopSettingsPatch,
): DesktopSettings {
  return normalizeDesktopSettings({
    ...current,
    uiState: patch.uiState ? { ...current.uiState, ...patch.uiState } : current.uiState,
    windowState: patch.windowState
      ? { ...current.windowState, ...patch.windowState }
      : current.windowState,
  });
}
