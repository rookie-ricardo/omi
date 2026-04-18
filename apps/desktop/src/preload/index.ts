import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent, OpenDialogOptions } from "electron";

import type { RunnerCommandName, RunnerCommandParamsByName } from "@omi/core";
import type { DesktopSettings, DesktopSettingsPatch } from "../shared/desktop-settings";

contextBridge.exposeInMainWorld("omi", {
  invoke<TResult = unknown, TName extends RunnerCommandName = RunnerCommandName>(
    method: TName,
    params?: RunnerCommandParamsByName[TName],
  ) {
    return ipcRenderer.invoke("runner:invoke", method, params ?? {}) as Promise<TResult>;
  },
  subscribe(listener: (event: unknown) => void) {
    const wrapped = (_event: IpcRendererEvent, payload: unknown) => listener(payload);
    ipcRenderer.on("runner:event", wrapped);
    return () => ipcRenderer.removeListener("runner:event", wrapped);
  },
  showOpenDialog(options: OpenDialogOptions) {
    return ipcRenderer.invoke("dialog:showOpenDialog", options);
  },
  getDesktopSettings() {
    return ipcRenderer.invoke("desktop:settings.get") as Promise<DesktopSettings>;
  },
  patchDesktopSettings(patch: DesktopSettingsPatch) {
    return ipcRenderer.invoke("desktop:settings.patch", patch) as Promise<DesktopSettings>;
  },
  openInFinder(targetPath: string) {
    return ipcRenderer.invoke("desktop:openInFinder", targetPath) as Promise<void>;
  },
  onMenuNavigate(callback: (view: string) => void) {
    const handler = (_event: IpcRendererEvent, view: string) => callback(view);
    ipcRenderer.on("menu:navigate", handler);
    return () => ipcRenderer.removeListener("menu:navigate", handler);
  },
});
