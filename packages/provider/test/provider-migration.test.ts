import { beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { removeLegacyProviderSettings } from "../src";

describe("removeLegacyProviderSettings", () => {
  let testAgentDir: string;

  beforeEach(() => {
    testAgentDir = join(tmpdir(), `omi-provider-migration-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
    rmSync(testAgentDir, { recursive: true, force: true });
  });

  it("removes provider-owned fields from legacy settings.json", () => {
    mkdirSync(testAgentDir, { recursive: true });
    const settingsPath = join(testAgentDir, "settings.json");
    writeFileSync(
      settingsPath,
      `${JSON.stringify(
        {
          theme: "dark",
          defaultProvider: "openai",
          defaultModel: "gpt-5.4",
          enabledModels: ["gpt-*"],
          defaultThinkingLevel: "high",
          transport: "sse",
          websockets: true,
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );

    removeLegacyProviderSettings(testAgentDir);

    expect(JSON.parse(readFileSync(settingsPath, "utf-8"))).toEqual({
      theme: "dark",
    });
  });

  it("keeps unrelated settings.json content untouched", () => {
    mkdirSync(testAgentDir, { recursive: true });
    const settingsPath = join(testAgentDir, "settings.json");
    writeFileSync(
      settingsPath,
      `${JSON.stringify(
        {
          theme: "dark",
          collapseChangelog: true,
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );

    removeLegacyProviderSettings(testAgentDir);

    expect(JSON.parse(readFileSync(settingsPath, "utf-8"))).toEqual({
      theme: "dark",
      collapseChangelog: true,
    });
  });
});
