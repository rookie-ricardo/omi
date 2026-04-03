import { describe, it, expect } from "vitest";
import {
  parseSkillFrontmatter,
  matchesActivationConditions,
  getEffortScore,
  skillFrontmatterSchema,
  type EffortLevel,
} from "../src/skills/frontmatter";

describe("frontmatter", () => {
  describe("parseSkillFrontmatter", () => {
    it("should parse valid frontmatter with all fields", () => {
      const content = `---
name: Test Skill
description: A test skill for validation
when_to_use: Use when testing
allowed_tools:
  - read
  - write
  - bash
effort: moderate
execution_mode: inline
activation:
  paths:
    - "*.ts"
    - "*.js"
  promptPatterns:
    - "test.*skill"
model:
  model: claude-3-5-sonnet
  maxTokens: 5000
context:
  maxTokens: 2000
  priority: 5
---
Skill body content here.`;

      const result = parseSkillFrontmatter(content);

      expect(result.frontmatter).not.toBeNull();
      expect(result.frontmatter?.name).toBe("Test Skill");
      expect(result.frontmatter?.description).toBe("A test skill for validation");
      expect(result.frontmatter?.when_to_use).toBe("Use when testing");
      expect(result.frontmatter?.allowed_tools).toEqual(["read", "write", "bash"]);
      expect(result.frontmatter?.effort).toBe("moderate");
      expect(result.frontmatter?.execution_mode).toBe("inline");
      expect(result.body).toBe("Skill body content here.");
    });

    it("should handle content without frontmatter", () => {
      const content = "Just plain content without frontmatter.";

      const result = parseSkillFrontmatter(content);

      expect(result.frontmatter).toBeNull();
      expect(result.body).toBe(content);
    });

    it("should handle minimal frontmatter", () => {
      const content = `---
name: Minimal Skill
description: Minimal description
---
Body content.`;

      const result = parseSkillFrontmatter(content);

      expect(result.frontmatter).not.toBeNull();
      expect(result.frontmatter?.name).toBe("Minimal Skill");
      expect(result.frontmatter?.description).toBe("Minimal description");
      expect(result.frontmatter?.effort).toBeUndefined();
      expect(result.frontmatter?.execution_mode).toBeUndefined();
    });

    it("should validate effort levels", () => {
      const validEfforts: EffortLevel[] = ["trivial", "simple", "moderate", "complex", "epic"];

      for (const effort of validEfforts) {
        const content = `---
name: Test Skill
description: Test
effort: ${effort}
---
Body.`;
        const result = parseSkillFrontmatter(content);
        expect(result.frontmatter?.effort).toBe(effort);
      }
    });

    it("should parse execution modes", () => {
      const content = `---
name: Fork Skill
description: Fork mode skill
execution_mode: fork
---
Body.`;

      const result = parseSkillFrontmatter(content);

      expect(result.frontmatter?.execution_mode).toBe("fork");
    });
  });

  describe("matchesActivationConditions", () => {
    it("should match path patterns", () => {
      const conditions = {
        paths: ["*.ts", "src/**/*.js"],
      };

      const context = {
        prompt: "test prompt",
        filePaths: ["test.ts", "src/utils.js"],
      };

      expect(matchesActivationConditions(conditions, context)).toBe(true);
    });

    it("should not match when path patterns don't match", () => {
      const conditions = {
        paths: ["*.py", "**/java/**/*.java"],
      };

      const context = {
        prompt: "test prompt",
        filePaths: ["test.ts", "src/utils.js"],
      };

      expect(matchesActivationConditions(conditions, context)).toBe(false);
    });

    it("should match prompt patterns", () => {
      const conditions = {
        promptPatterns: ["refactor.*code", "improve.*performance"],
      };

      const context = {
        prompt: "refactor the code to be faster",
        filePaths: [],
      };

      expect(matchesActivationConditions(conditions, context)).toBe(true);
    });

    it("should match git state conditions", () => {
      const conditions = {
        gitState: {
          branch: "main",
          dirty: true,
        },
      };

      const context = {
        prompt: "test",
        filePaths: [],
        gitBranch: "main",
        gitDirty: true,
      };

      expect(matchesActivationConditions(conditions, context)).toBe(true);
    });

    it("should return true when no conditions specified", () => {
      const conditions = {};
      const context = {
        prompt: "test",
        filePaths: [],
      };

      expect(matchesActivationConditions(conditions, context)).toBe(true);
    });
  });

  describe("getEffortScore", () => {
    it("should return correct scores for effort levels", () => {
      expect(getEffortScore("trivial")).toBe(1);
      expect(getEffortScore("simple")).toBe(2);
      expect(getEffortScore("moderate")).toBe(3);
      expect(getEffortScore("complex")).toBe(5);
      expect(getEffortScore("epic")).toBe(8);
    });

    it("should return default for unknown effort", () => {
      expect(getEffortScore("moderate" as EffortLevel)).toBe(3);
    });
  });
});
