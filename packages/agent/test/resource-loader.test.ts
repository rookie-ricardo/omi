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
    mkdirSync(join(homeRoot, ".omi", "extensions"), { recursive: true });
    mkdirSync(join(workspaceRoot, ".omi", "extensions"), { recursive: true });
    writeFileSync(
      join(homeRoot, ".omi", "extensions", "home.mjs"),
      `export default {
  name: "home-extension",
};`,
    );
    writeFileSync(
      join(workspaceRoot, ".omi", "extensions", "workspace.mjs"),
      `export default {
  name: "workspace-extension",
};`,
    );

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
    expect(skills).toHaveLength(2);
    expect(skills[0]?.name).toBe("Git Inspector");
    expect(skills[1]?.name).toBe("Repo Review");
    expect(skills[1]?.source.client).toBe("agent");

    const matches = await loader.searchSkills("show me git diff");
    expect(matches[0]?.name).toBe("Git Inspector");

    const resolved = await loader.resolveSkillForPrompt("show me git diff");
    expect(resolved?.skill.name).toBe("Git Inspector");
    expect(loader.buildSystemPrompt(resolved)).toContain("Activated skill: Git Inspector");
    expect(loader.getExtensions().diagnostics).toEqual([]);
    expect(loader.getExtensions().items.map((extension) => extension.name)).toEqual([
      "home-extension",
      "workspace-extension",
    ]);
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
