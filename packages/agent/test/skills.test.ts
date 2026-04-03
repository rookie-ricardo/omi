import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { listSkills, resolveSkillForPrompt, searchSkills } from "../src/index";

const originalHome = process.env.HOME;

afterEach(() => {
  process.env.HOME = originalHome;
});

describe("skills", () => {
  it("discovers workspace and user skill roots and prefers workspace agent skills", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "omi-skills-workspace-"));
    const homeRoot = mkdtempSync(join(tmpdir(), "omi-skills-home-"));
    process.env.HOME = homeRoot;

    writeSkill(
      join(homeRoot, ".claude", "skills", "review"),
      "Repo Review",
      "Review repositories carefully.",
      "allowed_tools:\n  - read\n  - grep",
    );
    writeSkill(
      join(workspaceRoot, ".agent", "skills", "review"),
      "Repo Review",
      "Review this workspace with stronger instructions.",
      "allowed_tools:\n  - read\n  - bash",
    );

    const skills = await listSkills(workspaceRoot);
    expect(skills).toHaveLength(2);

    const workspaceSkill = skills.find((skill) => skill.source.scope === "workspace");
    const userSkill = skills.find((skill) => skill.source.scope === "user");

    expect(workspaceSkill?.source.client).toBe("agent");
    expect(workspaceSkill?.allowedTools).toEqual(["read", "bash"]);
    expect(userSkill?.source.client).toBe("claude");
    expect(userSkill?.allowedTools).toEqual(["read", "grep"]);
  });

  it("searches and resolves the best matching skill without blocking", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "omi-skills-search-"));
    const homeRoot = mkdtempSync(join(tmpdir(), "omi-skills-home-"));
    process.env.HOME = homeRoot;

    writeSkill(
      join(workspaceRoot, ".agent", "skills", "git-inspector"),
      "Git Inspector",
      "Inspect git changes and diff previews.",
      "allowed_tools:\n  - read\n  - bash",
    );

    const matches = await searchSkills(workspaceRoot, "show me git diff");
    expect(matches[0]?.name).toBe("Git Inspector");

    const resolved = await resolveSkillForPrompt(workspaceRoot, "show me git diff");
    expect(resolved?.skill.name).toBe("Git Inspector");
    expect(resolved?.enabledToolNames).toEqual(["read", "bash"]);
    expect(resolved?.diagnostics).toEqual([]);
  });

  it("filters unsupported skill tools and records diagnostics", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "omi-skills-filter-"));
    const homeRoot = mkdtempSync(join(tmpdir(), "omi-skills-home-"));
    process.env.HOME = homeRoot;

    writeSkill(
      join(workspaceRoot, ".agent", "skills", "repo-review"),
      "Repo Review",
      "Review the repository with precision.",
      "allowed_tools:\n  - read\n  - rogue_tool\n  - bash",
    );

    const resolved = await resolveSkillForPrompt(workspaceRoot, "review this repo");
    expect(resolved?.enabledToolNames).toEqual(["read", "bash"]);
    expect(resolved?.diagnostics).toEqual([
      "Ignored unsupported skill tools: rogue_tool",
    ]);
    expect(resolved?.injectedPrompt).toContain("Suggested tools from skill: read, bash");
    expect(resolved?.injectedPrompt).not.toContain("rogue_tool");
  });
});

function writeSkill(
  directory: string,
  name: string,
  description: string,
  extraFrontmatter = "",
) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "SKILL.md"),
    `---
name: ${name}
description: ${description}
${extraFrontmatter}
---
# ${name}

Use this skill when the task clearly matches ${name}.
`,
  );
}
