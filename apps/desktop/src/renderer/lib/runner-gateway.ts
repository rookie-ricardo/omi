import type { OpenDialogOptions, OpenDialogReturnValue } from "electron";

import type { RunnerCommandName, RunnerCommandParamsByName, RunnerEventEnvelope } from "@omi/core";
import type { DesktopSettings, DesktopSettingsPatch } from "../../shared/desktop-settings";

export type { RunnerEventEnvelope } from "@omi/core";

export interface RunnerGateway {
  invoke<TResult = unknown, TName extends RunnerCommandName = RunnerCommandName>(
    method: TName,
    params?: RunnerCommandParamsByName[TName],
  ): Promise<TResult>;
  subscribe(listener: (event: RunnerEventEnvelope) => void): () => void;
  showOpenDialog(options: OpenDialogOptions): Promise<OpenDialogReturnValue>;
  getDesktopSettings(): Promise<DesktopSettings>;
  patchDesktopSettings(patch: DesktopSettingsPatch): Promise<DesktopSettings>;
  openInFinder(targetPath: string): Promise<void>;
}

let gatewayOverride: RunnerGateway | null | undefined;

export function getRunnerGateway(): RunnerGateway | null {
  if (gatewayOverride !== undefined) {
    return gatewayOverride;
  }
  if (typeof window === "undefined") {
    return null;
  }
  return window.omi ?? null;
}

export function setRunnerGatewayForTests(gateway: RunnerGateway | null): void {
  gatewayOverride = gateway;
}
