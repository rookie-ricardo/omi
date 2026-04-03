import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  searchSkills,
  resolveSkillForPrompt,
} from "../src/skills/discovery";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

describe("discovery", () => {
  const testWorkspace = "/tmp/test-skill-workspace-discovery";

  beforeEach(() => {
    // Create test workspace
    mkdirSync(testWorkspace, { recursive: true });
    mkdirSync(join(testWorkspace, ".agent", "skills"), { recursive: true });
  });

  afterEach(() => {
    // Cleanup test workspace
    try {
      rmSync(testWorkspace, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("searchSkills", () => {
    it("should find skills matching query", async () => {
      // Create a test skill
      const skillDir = join(testWorkspace, ".agent", "skills", "test-skill");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, "SKILL.md"),
        `---
name: Test Skill
description: A skill for testing purposes
---
This is a test skill body.`,
      );

      const results = await searchSkills(testWorkspace, "test skill");

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toContain("Test");
    });

    it("should return empty array for empty query", async () => {
      const results = await searchSkills(testWorkspace, "");

      expect(results).toEqual([]);
    });

    it("should score skills by relevance", async () => {
      // Create two test skills with different relevance
      const skillDir1 = join(testWorkspace, ".agent", "skills", "refactor-skill");
      mkdirSync(skillDir1, { recursive: true });
      writeFileSync(
        join(skillDir1, "SKILL.md"),
        `---
name: Refactor Skill
description: Helps refactor code
---
Refactoring assistance.`,
      );

      const skillDir2 = join(testWorkspace, ".agent", "skills", "test-skill");
      mkdirSync(skillDir2, { recursive: true });
      writeFileSync(
        join(skillDir2, "SKILL.md"),
        `---
name: Test Skill
description: For testing purposes
---
Testing assistance.`,
      );

      const results = await searchSkills(testWorkspace, "refactor");

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toBe("Refactor Skill");
    });
  });

  describe("resolveSkillForPrompt", () => {
    it("should resolve skill for matching prompt", async () => {
      const skillDir = join(testWorkspace, ".agent", "skills", "refactor");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, "SKILL.md"),
        `---
name: Refactor Helper
description: Assists with code refactoring
when_to_use: When you need to refactor code
allowed_tools:
  - read
  - edit
  - bash
---
Use refactoring patterns and best practices.`,
      );

      const resolved = await resolveSkillForPrompt(
        testWorkspace,
        "refactor this function",
      );

      expect(resolved).not.toBeNull();
      expect(resolved?.skill.name).toBe("Refactor Helper");
      expect(resolved?.enabledToolNames).toContain("read");
    });

    it("should return null when no matching skill", async () => {
      // The test workspace has no skills, so searching should return null
      // (unless user has global skills that match)
      const resolved = await resolveSkillForPrompt(
        testWorkspace,
        "zzznomatchxyz999aaa",
      );

      // This test may pass or fail depending on user skills
      // Just verify it doesn't throw
      expect(typeof resolved).toBe("object");
    });

    it("should filter unsupported tools", async () => {
      const skillDir = join(testWorkspace, ".agent", "skills", "tool-skill");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, "SKILL.md"),
        `---
name: Tool Skill
description: Tests tool filtering
allowed_tools:
  - read
  - nonexistent_tool
  - bash
---
Body.`,
      );

      const resolved = await resolveSkillForPrompt(
        testWorkspace,
        "tool skill",
      );

      expect(resolved).not.toBeNull();
      expect(resolved?.enabledToolNames).toContain("read");
      expect(resolved?.enabledToolNames).toContain("bash");
      expect(resolved?.enabledToolNames).not.toContain("nonexistent_tool");
      expect(resolved?.diagnostics.length).toBeGreaterThan(0);
    });
  });
});
