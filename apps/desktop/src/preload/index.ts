import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";

import type { RunnerCommandName } from "@omi/protocol";

contextBridge.exposeInMainWorld("omi", {
  invoke<T>(method: RunnerCommandName, params?: Record<string, unknown>) {
    return ipcRenderer.invoke("runner:invoke", method, params ?? {}) as Promise<T>;
  },
  subscribe(listener: (event: unknown) => void) {
    const wrapped = (_event: IpcRendererEvent, payload: unknown) => listener(payload);
    ipcRenderer.on("runner:event", wrapped);
    return () => ipcRenderer.removeListener("runner:event", wrapped);
  },
});
