import { describe, expect, it, beforeEach } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  SettingsManager,
  getAgentDir,
  getBinDir,
  type Settings,
  type CompactionSettings,
  type RetrySettings,
  type ImageSettings,
} from "../src/index";

describe("SettingsManager", () => {
  let testAgentDir: string;

  beforeEach(() => {
    testAgentDir = join(tmpdir(), `omi-test-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
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

      const result = {
        compaction: {
          enabled: false,
          reserveTokens: 10000,
        },
      };

      // Since deepMergeSettings is private, we test through SettingsManager
      const manager = SettingsManager.inMemory(base);
      manager.applyOverrides(overrides);

      expect(manager["settings"]).toMatchObject(result);
    });

    it("preserves primitives when override is undefined", () => {
      const base: Settings = {
        theme: "dark",
      };

      const overrides: Settings = {};

      const manager = SettingsManager.inMemory(base);
      manager.applyOverrides(overrides);

      expect(manager["settings"].theme).toBe("dark");
    });

    it("overrides primitives with new values", () => {
      const base: Settings = {
        theme: "dark",
      };

      const overrides: Settings = {
        theme: "light",
      };

      const manager = SettingsManager.inMemory(base);
      manager.applyOverrides(overrides);

      expect(manager["settings"].theme).toBe("light");
    });

    it("replaces arrays entirely", () => {
      const base: Settings = {
        packages: [{ source: "package-a" }],
      };

      const overrides: Settings = {
        packages: [{ source: "package-b" }],
      };

      const manager = SettingsManager.inMemory(base);
      manager.applyOverrides(overrides);

      expect(manager["settings"].packages).toEqual([{ source: "package-b" }]);
    });
  });

  describe("migrateSettings", () => {
    it("migrates queueMode to steeringMode", () => {
      const oldSettings: Record<string, unknown> = {
        queueMode: "all",
      };

      // migrateSettings is a private static method, call it directly
      const result = (SettingsManager as any).migrateSettings(oldSettings);

      expect(result.steeringMode).toBe("all");
      expect(result.queueMode).toBeUndefined();
    });

    it("migrates websockets boolean to transport enum", () => {
      const oldSettings: Record<string, unknown> = {
        websockets: true,
      };

      const result = (SettingsManager as any).migrateSettings(oldSettings);

      expect(result.transport).toBe("websocket");
      expect(result.websockets).toBeUndefined();
    });

    it("does not migrate when transport already set", () => {
      const oldSettings: Record<string, unknown> = {
        transport: "sse",
        websockets: true,
      };

      const result = (SettingsManager as any).migrateSettings(oldSettings);

      // transport stays as-is; websockets is NOT migrated (not deleted) since transport is already set
      expect(result.transport).toBe("sse");
      expect(result.websockets).toBe(true);
    });
  });

  describe("get/set methods", () => {
    it("gets and sets default provider", () => {
      const manager = SettingsManager.inMemory();

      expect(manager.getDefaultProvider()).toBeUndefined();

      manager.setDefaultProvider("openai");
      expect(manager.getDefaultProvider()).toBe("openai");
    });

    it("gets and sets default model", () => {
      const manager = SettingsManager.inMemory();

      expect(manager.getDefaultModel()).toBeUndefined();

      manager.setDefaultModel("gpt-4");
      expect(manager.getDefaultModel()).toBe("gpt-4");
    });

    it("sets both provider and model together", () => {
      const manager = SettingsManager.inMemory();

      manager.setDefaultModelAndProvider("anthropic", "claude-3");
      expect(manager.getDefaultProvider()).toBe("anthropic");
      expect(manager.getDefaultModel()).toBe("claude-3");
    });

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

    it("gets and sets enabled models", () => {
      const manager = SettingsManager.inMemory();

      expect(manager.getEnabledModels()).toBeUndefined();

      manager.setEnabledModels(["claude-*", "gpt-*"]);
      expect(manager.getEnabledModels()).toEqual(["claude-*", "gpt-*"]);
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
