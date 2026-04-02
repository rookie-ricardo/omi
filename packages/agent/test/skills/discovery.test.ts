import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  searchSkills,
  resolveSkillForPrompt,
  discoverSkills,
} from "../../src/skills/discovery";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

describe("discovery", () => {
  // Use unique workspace per test to avoid cross-test contamination
  const testWorkspaceBase = "/tmp/test-skill-ws";

  function createTestWorkspace(id: number) {
    const workspace = `${testWorkspaceBase}-${id}`;
    mkdirSync(workspace, { recursive: true });
    mkdirSync(join(workspace, ".agent", "skills"), { recursive: true });
    return workspace;
  }

  afterEach(() => {
    // Cleanup all test workspaces
    try {
      rmSync(testWorkspaceBase, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("searchSkills", () => {
    it("should find skills matching query", async () => {
      const workspace = createTestWorkspace(1);
      const skillDir = join(workspace, ".agent", "skills", "searchtest123");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, "SKILL.md"),
        `---
name: Search Test 123
description: A skill for testing purposes
---
This is a test skill body.`,
      );

      // Only search workspace skills to avoid user skill interference
      const results = await searchSkills(workspace, "searchtest123", {
        includeUserSkills: false,
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toBe("Search Test 123");
    });

    it("should return empty array for empty query", async () => {
      const workspace = createTestWorkspace(2);
      const results = await searchSkills(workspace, "", { includeUserSkills: false });
      expect(results).toEqual([]);
    });

    it("should score skills by relevance", async () => {
      const workspace = createTestWorkspace(3);

      const skillDir1 = join(workspace, ".agent", "skills", "score-refactor-xyz");
      mkdirSync(skillDir1, { recursive: true });
      writeFileSync(
        join(skillDir1, "SKILL.md"),
        `---
name: Score Refactor Xyz
description: Helps refactor code
---
Refactoring assistance.`,
      );

      const results = await searchSkills(workspace, "refactor", {
        includeUserSkills: false,
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toBe("Score Refactor Xyz");
    });
  });

  describe("resolveSkillForPrompt", () => {
    it("should resolve skill for matching prompt", async () => {
      const workspace = createTestWorkspace(4);
      const skillDir = join(workspace, ".agent", "skills", "resolve-refactor-abc");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, "SKILL.md"),
        `---
name: Resolve Refactor Abc
description: Assists with code refactoring
when_to_use: When you need to refactor code
allowed_tools:
  - read
  - edit
  - bash
---
Use refactoring patterns.`,
      );

      const resolved = await resolveSkillForPrompt(
        workspace,
        "refactor this function",
        { includeUserSkills: false },
      );

      expect(resolved).not.toBeNull();
      expect(resolved?.skill.name).toBe("Resolve Refactor Abc");
      expect(resolved?.enabledToolNames).toContain("read");
    });

    it("should filter unsupported tools", async () => {
      const workspace = createTestWorkspace(5);
      const skillDir = join(workspace, ".agent", "skills", "toolfilter-xyz");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, "SKILL.md"),
        `---
name: Tool Filter Xyz
description: Tests tool filtering
allowed_tools:
  - read
  - nonexistent_tool_xyz
  - bash
---
Body.`,
      );

      const resolved = await resolveSkillForPrompt(
        workspace,
        "tool filter xyz",
        { includeUserSkills: false },
      );

      expect(resolved).not.toBeNull();
      expect(resolved?.enabledToolNames).toContain("read");
      expect(resolved?.enabledToolNames).toContain("bash");
      expect(resolved?.enabledToolNames).not.toContain("nonexistent_tool_xyz");
      expect(resolved?.diagnostics.length).toBeGreaterThan(0);
    });
  });
});
