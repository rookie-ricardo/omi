/// <reference types="vite/client" />

import type { OpenDialogOptions, OpenDialogReturnValue } from "electron";

import type { RunnerCommandName, RunnerCommandParamsByName } from "@omi/core";
import type { DesktopSettings, DesktopSettingsPatch } from "../shared/desktop-settings";

interface RunnerEventEnvelope {
  type: string;
  payload: Record<string, unknown>;
}

declare global {
  interface Window {
    omi?: {
      invoke<TResult = unknown, TName extends RunnerCommandName = RunnerCommandName>(
        method: TName,
        params?: RunnerCommandParamsByName[TName],
      ): Promise<TResult>;
      subscribe(listener: (event: RunnerEventEnvelope) => void): () => void;
      showOpenDialog(options: OpenDialogOptions): Promise<OpenDialogReturnValue>;
      getDesktopSettings(): Promise<DesktopSettings>;
      patchDesktopSettings(patch: DesktopSettingsPatch): Promise<DesktopSettings>;
      openInFinder(targetPath: string): Promise<void>;
      onMenuNavigate(callback: (view: string) => void): () => void;
    };
  }
}

export {};
