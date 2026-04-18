import { type ChildProcess, fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { BrowserWindow, Menu, app, ipcMain, dialog, shell, type BrowserWindowConstructorOptions } from "electron";

import { type commandMap } from "@omi/core";
import {
  type DesktopSettings,
  type DesktopSettingsPatch,
  DEFAULT_DESKTOP_SETTINGS,
  mergeDesktopSettings,
  normalizeDesktopSettings,
} from "../shared/desktop-settings";

let mainWindow: BrowserWindow | null = null;
let runner: ChildProcess | null = null;
let desktopSettingsCache: DesktopSettings | null = null;
let windowStatePersistTimer: ReturnType<typeof setTimeout> | null = null;
const pendingRequests = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();

interface RunnerEventMessage {
  type: "event";
  event: {
    type: string;
    payload: Record<string, unknown>;
  };
}

interface RunnerResponseMessage {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: { message?: string };
}

function rejectPendingRequests(reason: string) {
  for (const [id, request] of pendingRequests.entries()) {
    pendingRequests.delete(id);
    request.reject(new Error(reason));
  }
}

function getWorkspaceRoot() {
  return resolve(app.getAppPath(), "../..");
}

function getOmiDir(): string {
  const envDir = process.env.OMI_DIR;
  if (!envDir) {
    return join(homedir(), ".omi");
  }
  if (envDir === "~") {
    return homedir();
  }
  if (envDir.startsWith("~/")) {
    return join(homedir(), envDir.slice(2));
  }
  return envDir;
}

function getDesktopSettingsPath() {
  return join(getOmiDir(), "desktop", "settings.json");
}

function getLegacyDesktopSettingsPath() {
  return join(app.getPath("userData"), "settings.json");
}

function ensureDesktopSettingsMigrated(): void {
  const nextPath = getDesktopSettingsPath();
  if (existsSync(nextPath)) {
    return;
  }

  const legacyPath = getLegacyDesktopSettingsPath();
  if (!existsSync(legacyPath)) {
    return;
  }

  mkdirSync(dirname(nextPath), { recursive: true });
  try {
    renameSync(legacyPath, nextPath);
  } catch {
    const raw = readFileSync(legacyPath, "utf8");
    writeFileSync(nextPath, raw, "utf8");
  }
}

function readDesktopSettingsFromDisk(): DesktopSettings {
  ensureDesktopSettingsMigrated();
  try {
    const raw = readFileSync(getDesktopSettingsPath(), "utf8");
    return normalizeDesktopSettings(JSON.parse(raw));
  } catch {
    return structuredClone(DEFAULT_DESKTOP_SETTINGS);
  }
}

function persistDesktopSettings(settings: DesktopSettings): void {
  const path = getDesktopSettingsPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2), "utf8");
  desktopSettingsCache = settings;
}

function getDesktopSettings(): DesktopSettings {
  if (!desktopSettingsCache) {
    desktopSettingsCache = readDesktopSettingsFromDisk();
  }
  return structuredClone(desktopSettingsCache);
}

function patchDesktopSettings(patch: DesktopSettingsPatch): DesktopSettings {
  const current = getDesktopSettings();
  const next = mergeDesktopSettings(current, patch);
  persistDesktopSettings(next);
  return structuredClone(next);
}

function persistCurrentWindowState(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  try {
    const bounds = mainWindow.getBounds();
    patchDesktopSettings({
      windowState: {
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        maximized: mainWindow.isMaximized(),
      },
    });
  } catch (error) {
    console.error("[desktop-settings] failed to persist window state", error);
  }
}

function scheduleWindowStatePersist(): void {
  if (windowStatePersistTimer) {
    clearTimeout(windowStatePersistTimer);
  }
  windowStatePersistTimer = setTimeout(() => {
    persistCurrentWindowState();
  }, 200);
}

function createWindow() {
  const settings = getDesktopSettings();
  const windowState = settings.windowState;
  const browserWindowOptions: BrowserWindowConstructorOptions = {
    width: windowState.width,
    height: windowState.height,
    ...(typeof windowState.x === "number" ? { x: windowState.x } : {}),
    ...(typeof windowState.y === "number" ? { y: windowState.y } : {}),
    minWidth: 840,
    minHeight: 640,
    backgroundColor: "#00000000",
    transparent: true,
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 18, y: 18 },
    hasShadow: false,
    ...(process.platform !== "darwin" ? { titleBarOverlay: true } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  };

  mainWindow = new BrowserWindow(browserWindowOptions);
  if (windowState.maximized) {
    mainWindow.maximize();
  }

  mainWindow.on("resize", scheduleWindowStatePersist);
  mainWindow.on("move", scheduleWindowStatePersist);
  mainWindow.on("maximize", scheduleWindowStatePersist);
  mainWindow.on("unmaximize", scheduleWindowStatePersist);
  mainWindow.on("close", () => {
    persistCurrentWindowState();
  });

  startRunner();

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

function startRunner() {
  if (runner) {
    return;
  }

  const workspaceRoot = getWorkspaceRoot();
  const isPackaged = app.isPackaged;
  const runnerEntry = isPackaged
    ? resolve(process.resourcesPath, "runner", "dist", "index.js")
    : resolve(workspaceRoot, "apps/runner/src/index.ts");
  const nodeExecPath =
    process.env.npm_node_execpath ??
    process.env.NODE ??
    process.env.NODE_BINARY ??
    "node";

  runner = isPackaged
    ? fork(runnerEntry, ["--workspace-root", workspaceRoot], {
        stdio: ["pipe", "pipe", "pipe", "ipc"],
        env: {
          ...process.env,
        },
      })
    : fork(runnerEntry, ["--workspace-root", workspaceRoot], {
        stdio: ["pipe", "pipe", "pipe", "ipc"],
        execPath: nodeExecPath,
        execArgv: ["--import", "tsx"],
        env: {
          ...process.env,
        },
      });

  runner.stdout?.on("data", (chunk) => {
    process.stdout.write(`[runner] ${String(chunk)}`);
  });
  runner.stderr?.on("data", (chunk) => {
    process.stderr.write(`[runner] ${String(chunk)}`);
  });

  runner.on("message", (message) => {
    if (!message || typeof message !== "object") {
      return;
    }

    const runnerMessage = message as Partial<RunnerEventMessage & RunnerResponseMessage>;

    if (runnerMessage.type === "event" && runnerMessage.event) {
      mainWindow?.webContents.send("runner:event", runnerMessage.event);
      return;
    }

    if (typeof runnerMessage.id === "string") {
      const request = pendingRequests.get(runnerMessage.id);
      if (!request) {
        return;
      }

      pendingRequests.delete(runnerMessage.id);

      if (runnerMessage.ok) {
        request.resolve(runnerMessage.result);
      } else {
        request.reject(new Error(runnerMessage.error?.message ?? "Runner request failed"));
      }
    }
  });

  runner.on("error", (error) => {
    console.error("[runner] process error:", error);
    runner = null;
    rejectPendingRequests(`Runner process error: ${error.message}`);
  });

  runner.on("exit", (code, signal) => {
    const reason = `Runner exited with code ${code ?? "null"} signal ${signal ?? "null"}`;
    console.error("[runner]", reason);
    runner = null;
    rejectPendingRequests(reason);
  });
}

async function invokeRunner(method: keyof typeof commandMap, params: Record<string, unknown>) {
  startRunner();
  if (!runner || !runner.connected) {
    throw new Error("Runner failed to start");
  }

  const id = `rpc_${randomUUID()}`;
  const payload = { id, method, params };

  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    runner?.send(payload, (error) => {
      if (error) {
        pendingRequests.delete(id);
        reject(error);
      }
    });
  });
}

app.whenReady().then(() => {
  ipcMain.handle(
    "runner:invoke",
    async (_event, method: keyof typeof commandMap, params: unknown) =>
      invokeRunner(method, (params ?? {}) as Record<string, unknown>),
  );
  ipcMain.handle("desktop:settings.get", () => getDesktopSettings());
  ipcMain.handle("desktop:settings.patch", (_event, patch: DesktopSettingsPatch) =>
    patchDesktopSettings(patch ?? {}),
  );
  ipcMain.handle("desktop:openInFinder", async (_event, targetPath: string) => {
    if (typeof targetPath !== "string" || !targetPath.trim()) {
      return;
    }
    const errorMessage = await shell.openPath(targetPath);
    if (errorMessage) {
      throw new Error(errorMessage);
    }
  });

  ipcMain.handle("dialog:showOpenDialog", async (_event, options) => {
    if (!mainWindow) return { canceled: true, filePaths: [] };
    return dialog.showOpenDialog(mainWindow, options);
  });

  createWindow();
  buildApplicationMenu();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (windowStatePersistTimer) {
    clearTimeout(windowStatePersistTimer);
    windowStatePersistTimer = null;
  }
  persistCurrentWindowState();
  runner?.kill();
});

function buildApplicationMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    { label: app.name, submenu: [
      { role: "about" },
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      { type: "separator" },
      { role: "quit" },
    ]},
    { label: "Edit", submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" },
    ]},
    { label: "View", submenu: [
      { label: "诊断", accelerator: "Cmd+Shift+L", click: () => navigateRenderer("diagnostics") },
      { type: "separator" },
      { role: "toggleDevTools" },
      { type: "separator" },
      { role: "resetZoom" },
      { role: "zoomIn" },
      { role: "zoomOut" },
    ]},
    { label: "Window", submenu: [
      { role: "minimize" },
      { role: "close" },
    ]},
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function navigateRenderer(view: string) {
  mainWindow?.webContents.send("menu:navigate", view);
}
