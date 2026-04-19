import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@omi/core";

const LEGACY_PROVIDER_SETTING_KEYS = [
  "defaultProvider",
  "defaultModel",
  "defaultThinkingLevel",
  "enabledModels",
  "transport",
  "websockets",
] as const;

export function removeLegacyProviderSettings(agentDir: string = getAgentDir()): void {
  const settingsPath = join(agentDir, "settings.json");
  if (!existsSync(settingsPath)) {
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(settingsPath, "utf-8"));
  } catch {
    return;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return;
  }

  const settings = parsed as Record<string, unknown>;
  let changed = false;
  for (const key of LEGACY_PROVIDER_SETTING_KEYS) {
    if (key in settings) {
      delete settings[key];
      changed = true;
    }
  }

  if (!changed) {
    return;
  }

  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf-8");
}
