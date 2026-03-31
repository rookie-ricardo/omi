import { type ChildProcess, fork } from "node:child_process";
import { join, resolve } from "node:path";

import { BrowserWindow, app, ipcMain } from "electron";

import { type commandMap } from "@omi/protocol";
import { createId } from "@omi/core";

let mainWindow: BrowserWindow | null = null;
let runner: ChildProcess | null = null;
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1100,
    minHeight: 760,
    backgroundColor: "#1b1b1f",
    titleBarStyle: process.platform === "darwin" ? "hidden" : undefined,
    trafficLightPosition: process.platform === "darwin" ? { x: 18, y: 18 } : undefined,
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
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

  runner = isPackaged
    ? fork(runnerEntry, ["--workspace-root", workspaceRoot], {
        stdio: ["pipe", "pipe", "pipe", "ipc"],
        env: {
          ...process.env,
        },
      })
    : fork(runnerEntry, ["--workspace-root", workspaceRoot], {
        stdio: ["pipe", "pipe", "pipe", "ipc"],
        execPath: process.execPath,
        execArgv: ["--import", "tsx"],
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
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

  const id = createId("rpc");
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

  createWindow();

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
  runner?.kill();
});
