import { beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { DEFAULT_SETTINGS, SettingsManager, getAgentDir, getBinDir, type Settings } from "../src/index";

describe("SettingsManager", () => {
  let testAgentDir: string;

  beforeEach(() => {
    testAgentDir = join(tmpdir(), `omi-test-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
    rmSync(testAgentDir, { recursive: true, force: true });
  });

  describe("file storage", () => {
    it("creates the global settings file with defaults on first startup", () => {
      const manager = SettingsManager.create(testAgentDir);
      const settingsPath = join(testAgentDir, "settings.json");

      expect(existsSync(settingsPath)).toBe(true);

      const diskSettings = JSON.parse(readFileSync(settingsPath, "utf-8"));
      expect(diskSettings).toEqual(DEFAULT_SETTINGS);
      expect(manager.getGlobalSettings()).toEqual(DEFAULT_SETTINGS);
    });

    it("reads an existing global settings file without overwriting it", () => {
      mkdirSync(testAgentDir, { recursive: true });
      const settingsPath = join(testAgentDir, "settings.json");
      writeFileSync(
        settingsPath,
        `${JSON.stringify({ theme: "dark" }, null, 2)}\n`,
        "utf-8",
      );

      const manager = SettingsManager.create(testAgentDir);

      expect(manager.getTheme()).toBe("dark");
      expect(JSON.parse(readFileSync(settingsPath, "utf-8"))).toEqual({
        theme: "dark",
      });
    });

    it("persists updates into the global settings file", async () => {
      const manager = SettingsManager.create(testAgentDir);
      const settingsPath = join(testAgentDir, "settings.json");

      manager.setTheme("dark");
      manager.setRetryEnabled(false);
      await manager.flush();

      expect(JSON.parse(readFileSync(settingsPath, "utf-8"))).toMatchObject({
        ...DEFAULT_SETTINGS,
        theme: "dark",
        retry: {
          ...DEFAULT_SETTINGS.retry,
          enabled: false,
        },
      });
    });
  });

  describe("deepMergeSettings", () => {
    it("merges nested objects recursively", () => {
      const base: Settings = {
        compaction: {
          enabled: true,
          reserveTokens: 10000,
        },
      };

      const overrides: Settings = {
        compaction: {
          enabled: false,
        },
      };

      const manager = SettingsManager.inMemory(base);
      manager.applyOverrides(overrides);

      expect(manager["settings"]).toMatchObject({
        ...DEFAULT_SETTINGS,
        compaction: {
          enabled: false,
          reserveTokens: 10000,
          keepRecentTokens: 20000,
        },
      });
    });

    it("preserves primitives when override is undefined", () => {
      const manager = SettingsManager.inMemory({ theme: "dark" });
      manager.applyOverrides({});

      expect(manager["settings"].theme).toBe("dark");
    });

    it("overrides primitives with new values", () => {
      const manager = SettingsManager.inMemory({ theme: "dark" });
      manager.applyOverrides({ theme: "light" });

      expect(manager["settings"].theme).toBe("light");
    });

    it("replaces arrays entirely", () => {
      const manager = SettingsManager.inMemory({
        packages: [{ source: "package-a" }],
      });

      manager.applyOverrides({
        packages: [{ source: "package-b" }],
      });

      expect(manager["settings"].packages).toEqual([{ source: "package-b" }]);
    });
  });

  describe("migrateSettings", () => {
    it("keeps payload unchanged", () => {
      const oldSettings: Record<string, unknown> = {
        queueMode: "all",
        defaultProvider: "openai",
        defaultModel: "gpt-4.1-mini",
      };

      const result = (SettingsManager as any).migrateSettings(oldSettings);

      expect(result).toEqual(oldSettings);
    });
  });

  describe("get/set methods", () => {
    it("gets and sets theme", () => {
      const manager = SettingsManager.inMemory();

      expect(manager.getTheme()).toBeUndefined();

      manager.setTheme("dark");
      expect(manager.getTheme()).toBe("dark");
    });

    it("gets and sets compaction settings", () => {
      const manager = SettingsManager.inMemory();

      expect(manager.getCompactionEnabled()).toBe(true);
      expect(manager.getCompactionReserveTokens()).toBe(16384);
      expect(manager.getCompactionKeepRecentTokens()).toBe(20000);

      manager.setCompactionEnabled(false);
      expect(manager.getCompactionEnabled()).toBe(false);
    });

    it("gets and sets retry settings", () => {
      const manager = SettingsManager.inMemory();

      expect(manager.getRetryEnabled()).toBe(true);
      expect(manager.getRetrySettings()).toMatchObject({
        enabled: true,
        maxRetries: 3,
        baseDelayMs: 2000,
        maxDelayMs: 60000,
      });

      manager.setRetryEnabled(false);
      expect(manager.getRetryEnabled()).toBe(false);
    });

    it("gets and sets shell path", () => {
      const manager = SettingsManager.inMemory();

      expect(manager.getShellPath()).toBeUndefined();

      manager.setShellPath("/bin/zsh");
      expect(manager.getShellPath()).toBe("/bin/zsh");
    });

    it("gets and sets hide thinking block", () => {
      const manager = SettingsManager.inMemory();

      expect(manager.getHideThinkingBlock()).toBe(false);

      manager.setHideThinkingBlock(true);
      expect(manager.getHideThinkingBlock()).toBe(true);
    });

    it("gets and sets image auto-resize", () => {
      const manager = SettingsManager.inMemory();

      expect(manager.getImageAutoResize()).toBe(true);
      expect(manager.getBlockImages()).toBe(false);

      manager.setImageAutoResize(false);
      expect(manager.getImageAutoResize()).toBe(false);

      manager.setBlockImages(true);
      expect(manager.getBlockImages()).toBe(true);
    });

  });

  describe("resolveConfigValue", () => {
    it("resolves environment variables", () => {
      process.env.TEST_OMI_VAR = "test-value";

      const manager = SettingsManager.inMemory();
      const resolved = manager.resolveConfigValue(
        () => process.env.TEST_OMI_VAR,
        "default",
      );
      expect(resolved).toBe("test-value");

      delete process.env.TEST_OMI_VAR;
    });

    it("returns default value when undefined", () => {
      const manager = SettingsManager.inMemory();
      const resolved = manager.resolveConfigValue(
        () => undefined,
        "default",
      );
      expect(resolved).toBe("default");
    });

    it("returns value when defined", () => {
      const manager = SettingsManager.inMemory();
      const resolved = manager.resolveConfigValue(
        () => "custom",
        "default",
      );
      expect(resolved).toBe("custom");
    });
  });

  describe("path utilities", () => {
    it("getAgentDir returns expected path", () => {
      const dir = getAgentDir();
      expect(dir).toBeTruthy();
      expect(dir).toContain(".omi");
    });

    it("getBinDir returns expected path", () => {
      const dir = getBinDir();
      expect(dir).toBeTruthy();
      expect(dir).toContain(".omi");
      expect(dir).toContain("bin");
    });
  });
});
