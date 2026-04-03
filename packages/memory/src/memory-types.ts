/**
 * Memory type taxonomy for OMI.
 *
 * Memories are constrained to four types capturing context NOT derivable
 * from the current project state. Code patterns, architecture, git history,
 * and file structure are derivable (via grep/git/CLAUDE.md) and should NOT
 * be saved as memories.
 */

import { z } from "zod";

// ============================================================================
// Memory Types
// ============================================================================

export const MEMORY_TYPES = ["user", "feedback", "project", "reference"] as const;

export type MemoryType = (typeof MEMORY_TYPES)[number];

/**
 * Parse a raw frontmatter value into a MemoryType.
 * Invalid or missing values return undefined.
 */
export function parseMemoryType(raw: unknown): MemoryType | undefined {
  if (typeof raw !== "string") return undefined;
  return MEMORY_TYPES.find((t) => t === raw);
}

/**
 * Tags that mark a memory as protected from compaction and aggressive pruning.
 */
export const PROTECTED_MEMORY_TAGS: readonly string[] = ["key", "protected"];

// ============================================================================
// Memory File Frontmatter Schema
// ============================================================================

export const memoryFrontmatterSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  type: z.enum(["user", "feedback", "project", "reference"]),
  tags: z.array(z.string()),
  updatedAt: z.string().min(1),
});

export type MemoryFrontmatter = z.infer<typeof memoryFrontmatterSchema>;

// ============================================================================
// Memory File Structure
// ============================================================================

export interface MemoryFile {
  /** Absolute path to the memory file */
  path: string;
  /** Frontmatter metadata */
  frontmatter: MemoryFrontmatter;
  /** Raw markdown body content */
  body: string;
  /** Last modified time (ms) */
  mtimeMs: number;
  /** Whether the link in MEMORY.md is valid */
  isValid: boolean;
}

// ============================================================================
// MEMORY.md Index Entry
// ============================================================================

export const MEMORY_INDEX_ENTRY_REGEX = /^- \[([^\]]+)\]\(([^)]+)\) — (.+)$/;

export interface MemoryIndexEntry {
  title: string;
  filePath: string;
  hook: string;
  lineNumber: number;
}

export interface MemoryIndex {
  entries: MemoryIndexEntry[];
  truncated: boolean;
  lineCount: number;
  byteCount: number;
}

// ============================================================================
// Constants
// ============================================================================

export const MEMORY_INDEX_FILENAME = "MEMORY.md";
export const MAX_INDEX_LINES = 200;
export const MAX_INDEX_BYTES = 25_000;
export const MAX_MEMORY_FILES = 200;
export const FRONTMATTER_MAX_LINES = 30;
export const MAX_RECALL_RESULTS = 5;

/**
 * Frontmatter format example.
 */
export const MEMORY_FRONTMATTER_EXAMPLE = [
  "```markdown",
  "---",
  "title: {{memory title}}",
  "description: {{one-line description — used to decide relevance in future conversations, so be specific}}",
  `type: {{${MEMORY_TYPES.join(", ")}}}`,
  "tags: [{{tag-1}}, {{tag-2}}]",
  "updatedAt: 2026-04-03T00:00:00.000Z",
  "---",
  "",
  "{{memory content — for feedback/project types, structure as: rule/fact, then **Why:** and **How to apply:** lines}}",
  "```",
];

// ============================================================================
// Behavioral Guidance Sections
// ============================================================================

/**
 * What NOT to save in memory section.
 */
export const WHAT_NOT_TO_SAVE_SECTION = [
  "## What NOT to save in memory",
  "",
  "- Code patterns, conventions, architecture, file paths, or project structure — these can be derived by reading the current project state.",
  "- Git history, recent changes, or who-changed-what — `git log` / `git blame` are authoritative.",
  "- Debugging solutions or fix recipes — the fix is in the code; the commit message has the context.",
  "- Anything already documented in CLAUDE.md files.",
  "- Ephemeral task details: in-progress work, temporary state, current conversation context.",
  "",
  'These exclusions apply even when the user explicitly asks you to save. If they ask you to save a PR list or activity summary, ask what was *surprising* or *non-obvious* about it — that is the part worth keeping.',
];

/**
 * When to access memories section.
 */
export const WHEN_TO_ACCESS_SECTION = [
  "## When to access memories",
  "- When memories seem relevant, or the user references prior-conversation work.",
  "- You MUST access memory when the user explicitly asks you to check, recall, or remember.",
  "- If the user says to *ignore* or *not use* memory: proceed as if MEMORY.md were empty. Do not apply remembered facts, cite, compare against, or mention memory content.",
  "- Memory records can become stale over time. Before answering the user or building assumptions based solely on information in memory records, verify that the memory is still correct and up-to-date by reading the current state of the files or resources.",
];

/**
 * Before recommending from memory section.
 */
export const TRUSTING_RECALL_SECTION = [
  "## Before recommending from memory",
  "",
  "A memory that names a specific function, file, or flag is a claim that it existed *when the memory was written*. It may have been renamed, removed, or never merged. Before recommending it:",
  "",
  "- If the memory names a file path: check the file exists.",
  "- If the memory names a function or flag: grep for it.",
  "- If the user is about to act on your recommendation (not just asking about history), verify first.",
  "",
  '"The memory says X exists" is not the same as "X exists now."',
  "",
  "A memory that summarizes repo state (activity logs, architecture snapshots) is frozen in time. If the user asks about *recent* or *current* state, prefer `git log` or reading the code over recalling the snapshot.",
];

/**
 * How to save memories section.
 */
export const HOW_TO_SAVE_SECTION = [
  "## How to save memories",
  "",
  "Saving a memory is a two-step process:",
  "",
  '**Step 1** — write the memory to its own file (e.g., `user_role.md`, `feedback_testing.md`) using this frontmatter format:',
  "",
  ...MEMORY_FRONTMATTER_EXAMPLE,
  "",
  '**Step 2** — add a pointer to that file in `MEMORY.md`. `MEMORY.md` is an index, not a memory — each entry should be one line, under ~150 characters: `- [Title](file.md) — one-line hook`. It has no frontmatter. Never write memory content directly into `MEMORY.md`.',
  "",
  `- \`MEMORY.md\` is always loaded into your conversation context — lines after ${MAX_INDEX_LINES} will be truncated, so keep the index concise`,
  "- Keep the name, description, and type fields in memory files up-to-date with the content",
  "- Organize memory semantically by topic, not chronologically",
  "- Update or remove memories that turn out to be wrong or outdated",
  "- Do not write duplicate memories. First check if there is an existing memory you can update before writing a new one.",
];
