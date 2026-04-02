import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ResolvedSkill } from "@omi/core";

export interface ProjectContextFile {
  path: string;
  content: string;
}

/** Tool descriptions for system prompt */
const toolDescriptions: Record<string, string> = {
  read: "Read file contents",
  bash: "Execute bash commands (ls, grep, find, etc.)",
  edit: "Make surgical edits to files (find exact text and replace)",
  write: "Create or overwrite files",
  grep: "Search file contents for patterns (respects .gitignore)",
  find: "Find files by glob pattern (respects .gitignore)",
  ls: "List directory contents",
};

export interface BuildSystemPromptOptions {
  /** Custom system prompt (replaces default). */
  customPrompt?: string;
  /** Tools to include in prompt. Default: [read, bash, edit, write] */
  selectedTools?: string[];
  /** Optional one-line tool snippets keyed by tool name. */
  toolSnippets?: Record<string, string>;
  /** Additional guideline bullets appended to the default system prompt guidelines. */
  promptGuidelines?: string[];
  /** Text to append to system prompt. */
  appendSystemPrompt?: string;
  /** Working directory. Default: process.cwd() */
  cwd?: string;
  /** Pre-loaded context files. */
  projectContextFiles?: ProjectContextFile[];
  /** Pre-loaded skills. */
  resolvedSkill?: ResolvedSkill | null;
  /** Omi documentation paths. */
  docsPaths?: {
    readmePath?: string;
    docsPath?: string;
    examplesPath?: string;
  };
}

export function loadProjectContextFiles(workspaceRoot: string, agentDir?: string): ProjectContextFile[] {
  const files: ProjectContextFile[] = [];
  const seenPaths = new Set<string>();

  const appendContextFile = (directory: string): void => {
    for (const filename of ["AGENTS.md", "CLAUDE.md"]) {
      const filePath = join(directory, filename);
      if (!existsSync(filePath) || seenPaths.has(filePath)) {
        continue;
      }

      seenPaths.add(filePath);
      files.push({
        path: filePath,
        content: readFileSync(filePath, "utf-8"),
      });
      break;
    }
  };

  if (agentDir) {
    appendContextFile(agentDir);
  }

  let currentDir = resolve(workspaceRoot);
  const rootDir = resolve("/");

  while (true) {
    appendContextFile(currentDir);
    if (currentDir === rootDir) {
      break;
    }

    currentDir = resolve(currentDir, "..");
  }

  return files;
}

/** Build the system prompt with tools, guidelines, and context */
export function buildSystemPrompt(options: BuildSystemPromptOptions = {}): string {
  const {
    customPrompt,
    selectedTools,
    toolSnippets,
    promptGuidelines,
    appendSystemPrompt,
    cwd,
    projectContextFiles: providedContextFiles,
    resolvedSkill,
    docsPaths,
  } = options;
  const resolvedCwd = cwd ?? process.cwd();
  const promptCwd = resolvedCwd.replace(/\\/g, "/");

  const date = new Date().toISOString().slice(0, 10);

  const appendSection = appendSystemPrompt ? `\n\n${appendSystemPrompt}` : "";

  const contextFiles = providedContextFiles ?? [];

  if (customPrompt) {
    let prompt = customPrompt;

    if (appendSection) {
      prompt += appendSection;
    }

    // Append project context files
    if (contextFiles.length > 0) {
      prompt += "\n\n# Project Context\n\n";
      prompt += "Project-specific instructions and guidelines:\n\n";
      for (const { path: filePath, content } of contextFiles) {
        prompt += `## ${filePath}\n\n${content}\n\n`;
      }
    }

    // Append skills section (only if read tool is available)
    const customPromptHasRead = !selectedTools || selectedTools.includes("read");
    if (customPromptHasRead && resolvedSkill) {
      prompt += formatSkillForPrompt(resolvedSkill);
    }

    // Add date and working directory last
    prompt += `\nCurrent date: ${date}`;
    prompt += `\nCurrent working directory: ${promptCwd}`;

    return prompt;
  }

  // Build tools list based on selected tools.
  // Built-ins use toolDescriptions. Custom tools can provide one-line snippets.
  const tools = selectedTools || ["read", "bash", "edit", "write"];
  const visibleTools = tools.filter((name) => name in toolDescriptions || toolSnippets?.[name]);
  const toolsList =
    visibleTools.length > 0
      ? visibleTools
          .map((name) => {
            const snippet = toolSnippets?.[name] ?? toolDescriptions[name] ?? name;
            return `- ${name}: ${snippet}`;
          })
          .join("\n")
      : "(none)";

  // Build guidelines based on which tools are actually available
  const guidelinesList: string[] = [];
  const guidelinesSet = new Set<string>();
  const addGuideline = (guideline: string): void => {
    if (guidelinesSet.has(guideline)) {
      return;
    }
    guidelinesSet.add(guideline);
    guidelinesList.push(guideline);
  };

  const hasBash = tools.includes("bash");
  const hasEdit = tools.includes("edit");
  const hasWrite = tools.includes("write");
  const hasGrep = tools.includes("grep");
  const hasFind = tools.includes("find");
  const hasLs = tools.includes("ls");
  const hasRead = tools.includes("read");

  // File exploration guidelines
  if (hasBash && !hasGrep && !hasFind && !hasLs) {
    addGuideline("Use bash for file operations like ls, rg, find");
  } else if (hasBash && (hasGrep || hasFind || hasLs)) {
    addGuideline("Prefer grep/find/ls tools over bash for file exploration (faster, respects .gitignore)");
  }

  // Read before edit guideline
  if (hasRead && hasEdit) {
    addGuideline("Use read to examine files before editing. You must use this tool instead of cat or sed.");
  }

  // Edit guideline
  if (hasEdit) {
    addGuideline("Use edit for precise changes (old text must match exactly)");
  }

  // Write guideline
  if (hasWrite) {
    addGuideline("Use write only for new files or complete rewrites");
  }

  // Output guideline (only when actually writing or executing)
  if (hasEdit || hasWrite) {
    addGuideline(
      "When summarizing your actions, output plain text directly - do NOT use cat or bash to display what you did",
    );
  }

  for (const guideline of promptGuidelines ?? []) {
    const normalized = guideline.trim();
    if (normalized.length > 0) {
      addGuideline(normalized);
    }
  }

  // Always include these
  addGuideline("Be concise in your responses");
  addGuideline("Show file paths clearly when working with files");

  const guidelines = guidelinesList.map((g) => `- ${g}`).join("\n");

  let prompt = `You are an expert coding assistant operating inside omi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.

Available tools:
${toolsList}

In addition to the tools above, you may have access to other custom tools depending on the project.

Guidelines:
${guidelines}`;

  // Add documentation paths if provided
  if (docsPaths?.readmePath || docsPaths?.docsPath || docsPaths?.examplesPath) {
    prompt += "\n\nOmi documentation (read only when the user asks about omi itself, its SDK, extensions, or skills):";
    if (docsPaths.readmePath) {
      prompt += `\n- Main documentation: ${docsPaths.readmePath}`;
    }
    if (docsPaths.docsPath) {
      prompt += `\n- Additional docs: ${docsPaths.docsPath}`;
    }
    if (docsPaths.examplesPath) {
      prompt += `\n- Examples: ${docsPaths.examplesPath}`;
    }
  }

  if (appendSection) {
    prompt += appendSection;
  }

  // Append project context files
  if (contextFiles.length > 0) {
    prompt += "\n\n# Project Context\n\n";
    prompt += "Project-specific instructions and guidelines:\n\n";
    for (const { path: filePath, content } of contextFiles) {
      prompt += `## ${filePath}\n\n${content}\n\n`;
    }
  }

  // Append skills section (only if read tool is available)
  if (hasRead && resolvedSkill) {
    prompt += formatSkillForPrompt(resolvedSkill);
  }

  // Add date and working directory last
  prompt += `\nCurrent date: ${date}`;
  prompt += `\nCurrent working directory: ${promptCwd}`;

  return prompt;
}

/**
 * Format a single skill for inclusion in a system prompt.
 * Uses XML format per Agent Skills standard.
 */
function formatSkillForPrompt(resolvedSkill: ResolvedSkill): string {
  if (resolvedSkill.skill.disableModelInvocation) {
    return "";
  }

  const lines = [
    "\n\nThe following skill provides specialized instructions for this task.",
    "",
    "<active_skill>",
    `  <name>${escapeXml(resolvedSkill.skill.name)}</name>`,
    `  <description>${escapeXml(resolvedSkill.skill.description)}</description>`,
    `  <location>${escapeXml(resolvedSkill.skill.license || "")}</location>`,
    "  <instructions>",
  ];

  // Add the injected prompt content
  const instructions = resolvedSkill.injectedPrompt
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
  lines.push(instructions);

  lines.push("  </instructions>");
  lines.push("</active_skill>");

  return lines.join("\n");
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatProjectContext(projectContextFiles: ProjectContextFile[]): string {
  const sections = [
    "# Project Context",
    "Project-specific instructions and guidelines:",
    ...projectContextFiles.map(
      ({ path: filePath, content }) => `## ${filePath}\n\n${content}`,
    ),
  ];

  return sections.join("\n\n");
}
