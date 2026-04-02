import { describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { buildSystemPrompt, loadProjectContextFiles } from "../src/system-prompt";

describe("system prompt", () => {
  describe("buildSystemPrompt 基本功能", () => {
    it("包含默认的工具描述", () => {
      const prompt = buildSystemPrompt();
      expect(prompt).toContain("Available tools:");
      expect(prompt).toContain("read: Read file contents");
      expect(prompt).toContain("bash: Execute bash commands");
    });

    it("包含默认的指南", () => {
      const prompt = buildSystemPrompt();
      expect(prompt).toContain("Guidelines:");
      expect(prompt).toContain("Be concise in your responses");
    });

    it("包含当前日期", () => {
      const prompt = buildSystemPrompt();
      const today = new Date().toISOString().slice(0, 10);
      expect(prompt).toContain(`Current date: ${today}`);
    });

    it("包含当前工作目录", () => {
      const prompt = buildSystemPrompt();
      expect(prompt).toContain("Current working directory:");
    });
  });

  describe("selectedTools 参数", () => {
    it("可以指定要包含的工具", () => {
      const prompt = buildSystemPrompt({ selectedTools: ["read", "write"] });
      expect(prompt).toContain("read: Read file contents");
      expect(prompt).toContain("write: Create or overwrite files");
      expect(prompt).not.toContain("bash:");
    });

    it("空的 selectedTools 显示 (none)", () => {
      const prompt = buildSystemPrompt({ selectedTools: [] });
      expect(prompt).toContain("Available tools:");
      expect(prompt).toContain("(none)");
    });

    it("只包含 read 时不显示 bash 指南", () => {
      const prompt = buildSystemPrompt({ selectedTools: ["read"] });
      expect(prompt).not.toContain("Use bash for file operations");
    });
  });

  describe("customPrompt 替换模式", () => {
    it("使用自定义 prompt 完全替换默认内容", () => {
      const customPrompt = "You are a custom assistant. Do things your way.";
      const prompt = buildSystemPrompt({ customPrompt });

      expect(prompt).toContain(customPrompt);
      expect(prompt).not.toContain("Available tools:");
      expect(prompt).not.toContain("Guidelines:");
    });

    it("customPrompt 仍包含项目上下文", () => {
      const prompt = buildSystemPrompt({
        customPrompt: "Custom instructions.",
        projectContextFiles: [
          { path: "/workspace/CLAUDE.md", content: "Use TypeScript." },
        ],
      });

      expect(prompt).toContain("Custom instructions.");
      expect(prompt).toContain("# Project Context");
      expect(prompt).toContain("Use TypeScript.");
    });

    it("customPrompt 仍包含日期和 CWD", () => {
      const prompt = buildSystemPrompt({ customPrompt: "Hello" });
      const today = new Date().toISOString().slice(0, 10);

      expect(prompt).toContain(`Current date: ${today}`);
      expect(prompt).toContain("Current working directory:");
    });
  });

  describe("appendSystemPrompt 追加模式", () => {
    it("在默认 prompt 末尾追加内容", () => {
      const prompt = buildSystemPrompt({ appendSystemPrompt: "Additional instructions." });
      expect(prompt).toContain("Additional instructions.");
      expect(prompt).toContain("Current date:");
    });

    it("在 customPrompt 后追加内容", () => {
      const prompt = buildSystemPrompt({
        customPrompt: "Custom.",
        appendSystemPrompt: "Appended text.",
      });
      expect(prompt).toContain("Custom.");
      expect(prompt).toContain("Appended text.");
    });
  });

  describe("projectContextFiles", () => {
    it("包含项目上下文文件内容", () => {
      const prompt = buildSystemPrompt({
        projectContextFiles: [
          { path: "/workspace/AGENTS.md", content: "Test AGENTS content." },
        ],
      });

      expect(prompt).toContain("# Project Context");
      expect(prompt).toContain("## /workspace/AGENTS.md");
      expect(prompt).toContain("Test AGENTS content.");
    });

    it("包含多个上下文文件", () => {
      const prompt = buildSystemPrompt({
        projectContextFiles: [
          { path: "/workspace/AGENTS.md", content: "AGENTS content." },
          { path: "/workspace/CLAUDE.md", content: "CLAUDE content." },
        ],
      });

      expect(prompt).toContain("AGENTS content.");
      expect(prompt).toContain("CLAUDE content.");
    });
  });

  describe("resolvedSkill", () => {
    it("包含技能指令", () => {
      const prompt = buildSystemPrompt({
        resolvedSkill: {
          skill: {
            id: "skill_1",
            name: "Test Skill",
            description: "A test skill.",
            license: null,
            compatibility: null,
            metadata: {},
            allowedTools: [],
            body: "Skill body.",
            source: {
              scope: "workspace",
              client: "agent",
              basePath: "/workspace/.agent/skills",
              skillPath: "/workspace/.agent/skills/test/SKILL.md",
            },
            references: [],
            assets: [],
            scripts: [],
            disableModelInvocation: false,
          },
          score: 10,
          injectedPrompt: "Skill instructions here.",
          enabledToolNames: [],
          referencedFiles: [],
          diagnostics: [],
        },
      });

      expect(prompt).toContain("The following skill provides specialized instructions for this task.");
      expect(prompt).toContain("<active_skill>");
      expect(prompt).toContain("<name>Test Skill</name>");
      expect(prompt).toContain("Skill instructions here.");
    });

    it("禁用模型调用的技能不显示", () => {
      const prompt = buildSystemPrompt({
        resolvedSkill: {
          skill: {
            id: "skill_disabled",
            name: "Disabled Skill",
            description: "Disabled.",
            license: null,
            compatibility: null,
            metadata: {},
            allowedTools: [],
            body: "Body.",
            source: {
              scope: "workspace",
              client: "agent",
              basePath: "/workspace/.agent/skills",
              skillPath: "/workspace/.agent/skills/disabled/SKILL.md",
            },
            references: [],
            assets: [],
            scripts: [],
            disableModelInvocation: true,
          },
          score: 10,
          injectedPrompt: "Disabled instructions.",
          enabledToolNames: [],
          referencedFiles: [],
          diagnostics: [],
        },
      });

      expect(prompt).not.toContain("Disabled Skill");
    });
  });

  describe("工具组合动态指南", () => {
    it("有 bash 和 grep 时推荐使用 grep", () => {
      const prompt = buildSystemPrompt({ selectedTools: ["bash", "grep"] });
      expect(prompt).toContain("Prefer grep/find/ls tools over bash for file exploration");
    });

    it("有 read 和 edit 时建议先读取", () => {
      const prompt = buildSystemPrompt({ selectedTools: ["read", "edit"] });
      expect(prompt).toContain("Use read to examine files before editing");
    });

    it("有 edit 时包含精确编辑指南", () => {
      const prompt = buildSystemPrompt({ selectedTools: ["edit"] });
      expect(prompt).toContain("Use edit for precise changes");
    });

    it("有 write 时包含写入指南", () => {
      const prompt = buildSystemPrompt({ selectedTools: ["write"] });
      expect(prompt).toContain("Use write only for new files or complete rewrites");
    });

    it("有 edit 或 write 时包含输出指南", () => {
      const prompt1 = buildSystemPrompt({ selectedTools: ["edit"] });
      expect(prompt1).toContain("output plain text directly");

      const prompt2 = buildSystemPrompt({ selectedTools: ["write"] });
      expect(prompt2).toContain("output plain text directly");
    });
  });

  describe("promptGuidelines 自定义指南", () => {
    it("追加自定义指南", () => {
      const prompt = buildSystemPrompt({
        promptGuidelines: ["Always comment your code.", "Write tests first."],
      });

      expect(prompt).toContain("Always comment your code.");
      expect(prompt).toContain("Write tests first.");
    });

    it("跳过空指南", () => {
      const prompt = buildSystemPrompt({ promptGuidelines: ["", "  ", "Valid guideline."] });
      expect(prompt).toContain("Valid guideline.");
      expect(prompt).not.toContain("  ");
    });

    it("唯一化自定义指南", () => {
      // 自定义指南中的重复会被去重
      const prompt = buildSystemPrompt({
        promptGuidelines: ["Custom guideline 1.", "Custom guideline 1."],
      });

      const matches = (prompt.match(/Custom guideline 1./g) || []).length;
      expect(matches).toBe(1);
    });
  });

  describe("docsPaths 文档路径", () => {
    it("包含 README 路径", () => {
      const prompt = buildSystemPrompt({
        docsPaths: { readmePath: "/docs/README.md" },
      });

      expect(prompt).toContain("Main documentation: /docs/README.md");
    });

    it("包含额外文档路径", () => {
      const prompt = buildSystemPrompt({
        docsPaths: { docsPath: "/docs/guide.md" },
      });

      expect(prompt).toContain("Additional docs: /docs/guide.md");
    });

    it("包含示例路径", () => {
      const prompt = buildSystemPrompt({
        docsPaths: { examplesPath: "/examples" },
      });

      expect(prompt).toContain("Examples: /examples");
    });
  });

  describe("cwd 工作目录", () => {
    it("使用自定义 cwd", () => {
      const prompt = buildSystemPrompt({ cwd: "/custom/path" });
      expect(prompt).toContain("Current working directory: /custom/path");
    });

    it("转义反斜杠", () => {
      const prompt = buildSystemPrompt({ cwd: "C:\\Users\\Test" });
      expect(prompt).toContain("C:/Users/Test");
    });
  });

  describe("loadProjectContextFiles", () => {
    it("加载 AGENTS.md 文件", () => {
      const testDir = join(tmpdir(), `omi-test-${randomUUID()}`);
      mkdirSync(testDir, { recursive: true });
      try {
        writeFileSync(join(testDir, "AGENTS.md"), "Workspace AGENTS content.");

        const files = loadProjectContextFiles(testDir);
        expect(files.length).toBeGreaterThan(0);
        expect(files.some((f) => f.content.includes("Workspace AGENTS content."))).toBe(true);
      } finally {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    it("加载 CLAUDE.md 文件", () => {
      const testDir = join(tmpdir(), `omi-test-${randomUUID()}`);
      mkdirSync(testDir, { recursive: true });
      try {
        writeFileSync(join(testDir, "CLAUDE.md"), "Workspace CLAUDE content.");

        const files = loadProjectContextFiles(testDir);
        expect(files.some((f) => f.content.includes("Workspace CLAUDE content."))).toBe(true);
      } finally {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    it("优先加载 agentDir 中的文件", () => {
      const testDir = join(tmpdir(), `omi-test-${randomUUID()}`);
      mkdirSync(testDir, { recursive: true });
      try {
        const agentDir = join(testDir, ".agent");
        mkdirSync(agentDir, { recursive: true });
        writeFileSync(join(agentDir, "CLAUDE.md"), "Agent-specific CLAUDE.");

        const files = loadProjectContextFiles(testDir, agentDir);
        // Agent dir files should be included
        expect(files.some((f) => f.content.includes("Agent-specific CLAUDE."))).toBe(true);
      } finally {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    it("避免加载重复文件", () => {
      const testDir = join(tmpdir(), `omi-test-${randomUUID()}`);
      mkdirSync(testDir, { recursive: true });
      try {
        const subDir = join(testDir, "sub");
        mkdirSync(subDir, { recursive: true });
        writeFileSync(join(testDir, "AGENTS.md"), "Root.");
        writeFileSync(join(subDir, "AGENTS.md"), "Sub.");

        const files = loadProjectContextFiles(testDir);
        // Should not have duplicate paths
        const paths = files.map((f) => f.path);
        expect(new Set(paths).size).toBe(paths.length);
      } finally {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    it("返回空数组当没有上下文文件时", () => {
      const testDir = join(tmpdir(), `omi-test-${randomUUID()}`);
      mkdirSync(testDir, { recursive: true });
      try {
        const files = loadProjectContextFiles(testDir);
        expect(Array.isArray(files)).toBe(true);
      } finally {
        rmSync(testDir, { recursive: true, force: true });
      }
    });
  });

  describe("包含项目上下文和 resolved skill", () => {
    it("包含项目上下文和技能指令", () => {
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
            disableModelInvocation: false,
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
      expect(prompt).toContain("The following skill provides specialized instructions for this task.");
      expect(prompt).toContain("<active_skill>");
      expect(prompt).toContain("<name>Git Inspector</name>");
      expect(prompt).toContain("Activated skill: Git Inspector");
    });
  });

  describe("XML 转义", () => {
    it("转义技能名称中的特殊字符", () => {
      const prompt = buildSystemPrompt({
        resolvedSkill: {
          skill: {
            id: "skill_xss",
            name: "XSS <script>alert(1)</script>",
            description: "Safe description.",
            license: null,
            compatibility: null,
            metadata: {},
            allowedTools: [],
            body: "Body.",
            source: {
              scope: "workspace",
              client: "agent",
              basePath: "/workspace/.agent/skills",
              skillPath: "/workspace/.agent/skills/xss/SKILL.md",
            },
            references: [],
            assets: [],
            scripts: [],
            disableModelInvocation: false,
          },
          score: 10,
          injectedPrompt: "Instructions.",
          enabledToolNames: [],
          referencedFiles: [],
          diagnostics: [],
        },
      });

      // 应该转义 < 和 >
      expect(prompt).toContain("&lt;script&gt;");
      // 不应该包含原始的 < 或 >
      expect(prompt).not.toContain("<script>");
    });

    it("转义描述中的特殊字符", () => {
      const prompt = buildSystemPrompt({
        resolvedSkill: {
          skill: {
            id: "skill_amp",
            name: "Skill Name",
            description: "Use &amp; instead of &",
            license: null,
            compatibility: null,
            metadata: {},
            allowedTools: [],
            body: "Body.",
            source: {
              scope: "workspace",
              client: "agent",
              basePath: "/workspace/.agent/skills",
              skillPath: "/workspace/.agent/skills/amp/SKILL.md",
            },
            references: [],
            assets: [],
            scripts: [],
            disableModelInvocation: false,
          },
          score: 10,
          injectedPrompt: "Instructions.",
          enabledToolNames: [],
          referencedFiles: [],
          diagnostics: [],
        },
      });

      expect(prompt).toContain("&amp;amp;");
    });
  });
});
