import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { DefaultResourceLoader } from "../src/resource-loader";

const originalHome = process.env.HOME;

afterEach(() => {
  process.env.HOME = originalHome;
});

describe("resource loader", () => {
  it("loads workspace, parent, and user context while delegating skill discovery", async () => {
    const homeRoot = mkdtempSync(join(tmpdir(), "omi-resource-home-"));
    const projectRoot = mkdtempSync(join(tmpdir(), "omi-resource-project-"));
    const workspaceRoot = join(projectRoot, "workspace");
    mkdirSync(workspaceRoot, { recursive: true });
    process.env.HOME = homeRoot;

    mkdirSync(join(homeRoot, ".omi"), { recursive: true });
    writeFileSync(join(homeRoot, ".omi", "AGENTS.md"), "User context from .omi.");
    writeFileSync(join(projectRoot, "CLAUDE.md"), "Parent workspace context.");
    writeFileSync(join(workspaceRoot, "AGENTS.md"), "Workspace context.");

    writeSkill(
      join(homeRoot, ".agent", "skills", "review"),
      "Repo Review",
      "Review repositories carefully.",
      "allowed-tools: read grep",
    );
    writeSkill(
      join(workspaceRoot, ".agent", "skills", "review"),
      "Repo Review",
      "Review this workspace with stronger instructions.",
      "allowed-tools: read bash",
    );
    writeSkill(
      join(workspaceRoot, ".claude", "skills", "git-inspector"),
      "Git Inspector",
      "Inspect git changes and diff previews.",
      "allowed-tools: read bash",
    );

    const loader = new DefaultResourceLoader(workspaceRoot);
    await loader.reload();

    const contextFiles = loader.getProjectContextFiles();
    expect(contextFiles.map((entry) => basename(entry.path))).toEqual([
      "AGENTS.md",
      "AGENTS.md",
      "CLAUDE.md",
    ]);
    expect(contextFiles[0]?.content).toContain("User context from .omi.");
    expect(contextFiles[1]?.content).toContain("Workspace context.");
    expect(contextFiles[2]?.content).toContain("Parent workspace context.");

    const skills = await loader.listSkills();
    expect(skills).toHaveLength(3);
    expect(skills[0]?.name).toBe("Git Inspector");
    expect(skills[0]?.source.client).toBe("claude");
    expect(skills[1]?.name).toBe("Repo Review");
    expect(skills[1]?.source.client).toBe("agent");
    expect(skills[2]?.name).toBe("Repo Review");
    expect(skills[2]?.source.client).toBe("agent");

    const matches = await loader.searchSkills("show me git diff");
    expect(matches[0]?.name).toBe("Git Inspector");

    const resolved = await loader.resolveSkillForPrompt("show me git diff");
    expect(resolved?.skill.name).toBe("Git Inspector");
    expect(loader.buildSystemPrompt(null)).toContain(
      `Current working directory: ${workspaceRoot.replace(/\\/g, "/")}`,
    );
    expect(loader.buildSystemPrompt(null, "/tmp/override-cwd")).toContain(
      "Current working directory: /tmp/override-cwd",
    );
    expect(loader.buildSystemPrompt(resolved)).toContain("Activated skill: Git Inspector");
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
