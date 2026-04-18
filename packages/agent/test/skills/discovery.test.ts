import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  searchSkills,
  resolveSkillForPrompt,
} from "../../src/skills/discovery";
import { clearBundledSkills } from "../../src/skills/bundled/registry";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("discovery", () => {
  let testWorkspace = "";

  beforeEach(() => {
    // Create test workspace
    clearBundledSkills();
    testWorkspace = mkdtempSync(join(tmpdir(), "test-skill-workspace-discovery-"));
    mkdirSync(join(testWorkspace, ".agent", "skills"), { recursive: true });
  });

  afterEach(() => {
    // Cleanup test workspace
    try {
      rmSync(testWorkspace, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    clearBundledSkills();
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

      const results = await searchSkills(testWorkspace, "test skill", {
        includeUserSkills: false,
      });

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

      const results = await searchSkills(testWorkspace, "refactor", {
        includeUserSkills: false,
      });

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
  - skill
---
Use refactoring patterns and best practices.`,
      );

      const resolved = await resolveSkillForPrompt(
        testWorkspace,
        "refactor this function",
        { includeUserSkills: false },
      );

      expect(resolved).not.toBeNull();
      expect(resolved?.skill.name).toBe("Refactor Helper");
      // Only OMI-registered tools (skill) pass the isBuiltInTool filter
      expect(resolved?.enabledToolNames).toContain("skill");
    });

    it("should return null when no matching skill", async () => {
      // The test workspace has no skills, so searching should return null.
      const resolved = await resolveSkillForPrompt(
        testWorkspace,
        "zzznomatchxyz999aaa",
        { includeUserSkills: false },
      );

      expect(resolved).toBeNull();
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
  - skill
  - nonexistent_tool
  - read
---
Body.`,
      );

      const resolved = await resolveSkillForPrompt(
        testWorkspace,
        "tool skill",
        { includeUserSkills: false },
      );

      expect(resolved).not.toBeNull();
      // Only "skill" is a recognized OMI built-in tool
      expect(resolved?.enabledToolNames).toContain("skill");
      expect(resolved?.enabledToolNames).not.toContain("nonexistent_tool");
      // "read" is an SDK tool, not in OMI registry, so it's filtered out
      expect(resolved?.enabledToolNames).not.toContain("read");
      expect(resolved?.diagnostics.length).toBeGreaterThan(0);
    });
  });
});
