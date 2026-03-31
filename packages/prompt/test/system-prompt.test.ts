import { describe, expect, it } from "vitest";

import { buildSystemPrompt } from "../src/system-prompt";

describe("system prompt", () => {
  it("includes project context and resolved skill instructions", () => {
    const prompt = buildSystemPrompt({
      projectContextFiles: [
        {
          path: "/workspace/AGENTS.md",
          content: "Use concise diffs.",
        },
      ],
      resolvedSkill: {
        skill: {
          id: "skill_1",
          name: "Git Inspector",
          description: "Inspect git changes.",
          license: null,
          compatibility: null,
          metadata: {},
          allowedTools: [],
          body: "Review the git diff.",
          source: {
            scope: "workspace",
            client: "agent",
            basePath: "/workspace/.agent/skills",
            skillPath: "/workspace/.agent/skills/git-inspector/SKILL.md",
          },
          references: [],
          assets: [],
          scripts: [],
        },
        score: 10,
        injectedPrompt: "Activated skill: Git Inspector\n\nReview the git diff.",
        enabledToolNames: [],
        referencedFiles: [],
        diagnostics: [],
      },
    });

    expect(prompt).toContain("# Project Context");
    expect(prompt).toContain("Use concise diffs.");
    expect(prompt).toContain("The following skill is active: Git Inspector.");
    expect(prompt).toContain("Activated skill: Git Inspector");
  });
});
