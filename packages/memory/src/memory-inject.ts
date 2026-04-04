/**
 * Memory injection system: system prompt building with budget management.
 *
 * Implements the "inject" phase of the memory pipeline:
 * - Build memory behavioral instructions for system prompts
 * - Inject memory content within token budget
 * - Track memory injection events for auditability
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  MEMORY_INDEX_FILENAME,
  MAX_INDEX_LINES,
  MAX_INDEX_BYTES,
  MAX_RECALL_RESULTS,
  type MemoryFile,
  WHAT_NOT_TO_SAVE_SECTION,
  WHEN_TO_ACCESS_SECTION,
  TRUSTING_RECALL_SECTION,
  HOW_TO_SAVE_SECTION,
} from "./memory-types";
import { parseMemoryIndex, scanMemoryFiles, loadMemoryFiles } from "./memory-recall";

// ============================================================================
// Memory Injection Configuration
// ============================================================================

export interface MemoryInjectionSettings {
  /** Whether memory is enabled */
  enabled: boolean;
  /** Token budget reserved for memory injection */
  tokenBudget: number;
  /** Include how-to-save section */
  includeHowToSave: boolean;
  /** Include what-not-to-save section */
  includeWhatNotToSave: boolean;
  /** Include when-to-access section */
  includeWhenToAccess: boolean;
  /** Include trusting-recall section */
  includeTrustingRecall: boolean;
}

export const DEFAULT_INJECTION_SETTINGS: MemoryInjectionSettings = {
  enabled: true,
  tokenBudget: 2048,
  includeHowToSave: true,
  includeWhatNotToSave: true,
  includeWhenToAccess: true,
  includeTrustingRecall: true,
};

// ============================================================================
// Memory Injection Events (Audit Log)
// ============================================================================

export interface MemoryInjectionEvent {
  type: "injected" | "skipped" | "error";
  timestamp: number;
  memoryPath?: string;
  tokens?: number;
  reason?: string;
}

export class MemoryInjectionLog {
  private readonly events: MemoryInjectionEvent[] = [];

  log(event: Omit<MemoryInjectionEvent, "timestamp">): void {
    this.events.push({ ...event, timestamp: Date.now() });
  }

  getEvents(): readonly MemoryInjectionEvent[] {
    return this.events;
  }

  getInjectedMemories(): string[] {
    return this.events
      .filter((e): e is MemoryInjectionEvent & { memoryPath: string } => e.type === "injected" && e.memoryPath !== undefined)
      .map((e) => e.memoryPath as string);
  }

  clear(): void {
    this.events.length = 0;
  }
}

// ============================================================================
// Index Truncation
// ============================================================================

export interface TruncationResult {
  content: string;
  lineCount: number;
  byteCount: number;
  wasLineTruncated: boolean;
  wasByteTruncated: boolean;
}

/**
 * Truncate MEMORY.md content to the line AND byte caps.
 */
export function truncateIndexContent(raw: string): TruncationResult {
  const trimmed = raw.trim();
  const lines = trimmed.split("\n");
  const lineCount = lines.length;
  const byteCount = trimmed.length;

  const wasLineTruncated = lineCount > MAX_INDEX_LINES;
  const wasByteTruncated = byteCount > MAX_INDEX_BYTES;

  if (!wasLineTruncated && !wasByteTruncated) {
    return {
      content: trimmed,
      lineCount,
      byteCount,
      wasLineTruncated: false,
      wasByteTruncated: false,
    };
  }

  let truncated = wasLineTruncated ? lines.slice(0, MAX_INDEX_LINES).join("\n") : trimmed;

  if (truncated.length > MAX_INDEX_BYTES) {
    const cutAt = truncated.lastIndexOf("\n", MAX_INDEX_BYTES);
    truncated = truncated.slice(0, cutAt > 0 ? cutAt : MAX_INDEX_BYTES);
  }

  const linesPart = wasLineTruncated ? `${lineCount} lines` : "";
  const bytesPart = wasByteTruncated ? `${byteCount} bytes` : "";
  const reason = [linesPart, bytesPart].filter(Boolean).join(" and ");

  return {
    content:
      truncated +
      `\n\n> WARNING: MEMORY.md is ${reason} (limit: ${MAX_INDEX_LINES} lines / ${MAX_INDEX_BYTES} bytes). Keep index entries to one line under ~150 chars.`,
    lineCount,
    byteCount,
    wasLineTruncated,
    wasByteTruncated,
  };
}

// ============================================================================
// Memory Prompt Building
// ============================================================================

export interface MemoryPromptResult {
  prompt: string;
  sections: {
    behavior: string;
    index: string;
    recalled: string;
  };
  tokens: {
    behavior: number;
    index: number;
    recalled: number;
    total: number;
  };
  injectedMemories: string[];
}

/**
 * Build the memory behavioral instructions section.
 */
export function buildMemoryBehaviorSection(settings: MemoryInjectionSettings): string {
  const sections: string[] = [];

  if (settings.includeWhatNotToSave) {
    sections.push(...WHAT_NOT_TO_SAVE_SECTION, "");
  }

  if (settings.includeHowToSave) {
    sections.push(...HOW_TO_SAVE_SECTION, "");
  }

  if (settings.includeWhenToAccess) {
    sections.push(...WHEN_TO_ACCESS_SECTION, "");
  }

  if (settings.includeTrustingRecall) {
    sections.push(...TRUSTING_RECALL_SECTION, "");
  }

  return sections.join("\n");
}

/**
 * Build the memory index section from MEMORY.md content.
 */
export function buildMemoryIndexSection(memoryDir: string): Promise<{ content: string; truncated: TruncationResult }> {
  return loadIndexContent(memoryDir).then((content) => {
    const truncated = truncateIndexContent(content || "(empty)");
    return {
      content: `## MEMORY.md\n\n${truncated.content}`,
      truncated,
    };
  });
}

/**
 * Build the recalled memories section.
 */
export function buildRecalledMemoriesSection(memories: MemoryFile[]): string {
  if (memories.length === 0) {
    return "";
  }

  const sections: string[] = ["## Recalled Memories", ""];

  for (const memory of memories) {
    sections.push(`### ${memory.frontmatter.title}`, "");
    sections.push(`**Type:** ${memory.frontmatter.type}`, "");
    sections.push(`**Description:** ${memory.frontmatter.description}`, "");
    sections.push("");
    sections.push(memory.body, "");
    sections.push("---", "");
  }

  return sections.join("\n");
}

// ============================================================================
// Memory Injection
// ============================================================================

export interface MemoryInjectorConfig {
  memoryDir: string;
  settings: MemoryInjectionSettings;
  log: MemoryInjectionLog;
  estimateTokens: (text: string) => number;
}

export class MemoryInjector {
  private readonly memoryDir: string;
  private readonly settings: MemoryInjectionSettings;
  private readonly log: MemoryInjectionLog;
  private readonly estimateTokens: (text: string) => number;

  constructor(config: MemoryInjectorConfig) {
    this.memoryDir = config.memoryDir;
    this.settings = config.settings;
    this.log = config.log;
    this.estimateTokens = config.estimateTokens;
  }

  /**
   * Build the complete memory prompt section.
   */
  async buildPrompt(recalledMemories: MemoryFile[] = []): Promise<MemoryPromptResult> {
    if (!this.settings.enabled) {
      this.log.log({ type: "skipped", reason: "memory disabled" });
      return {
        prompt: "",
        sections: { behavior: "", index: "", recalled: "" },
        tokens: { behavior: 0, index: 0, recalled: 0, total: 0 },
        injectedMemories: [],
      };
    }

    // Build behavior section
    const behaviorSection = buildMemoryBehaviorSection(this.settings);
    const behaviorTokens = this.estimateTokens(behaviorSection);

    // Check if we have budget for index
    const remainingBudget = this.settings.tokenBudget - behaviorTokens;
    let indexSection = "";
    let indexTokens = 0;

    if (remainingBudget > 0) {
      const indexResult = await buildMemoryIndexSection(this.memoryDir);
      indexSection = indexResult.content;
      indexTokens = this.estimateTokens(indexSection);

      // Truncate if needed
      if (indexTokens > remainingBudget) {
        const ratio = remainingBudget / indexTokens;
        const maxChars = Math.floor(indexSection.length * ratio);
        indexSection = indexSection.slice(0, maxChars) + "\n\n> [truncated]";
        indexTokens = this.estimateTokens(indexSection);
      }
    }

    // Check for recalled memories
    const recalledSection = buildRecalledMemoriesSection(recalledMemories);
    const recalledTokens = this.estimateTokens(recalledSection);

    // Build full prompt
    const sections = {
      behavior: behaviorSection,
      index: indexSection,
      recalled: recalledSection,
    };

    const prompt = [sections.behavior, sections.index, sections.recalled]
      .filter((s) => s.trim().length > 0)
      .join("\n\n");

    const tokens = {
      behavior: behaviorTokens,
      index: indexTokens,
      recalled: recalledTokens,
      total: behaviorTokens + indexTokens + recalledTokens,
    };

    // Log injection events
    for (const memory of recalledMemories) {
      this.log.log({
        type: "injected",
        memoryPath: memory.path,
        tokens: this.estimateTokens(
          `${memory.frontmatter.title}\n\n${memory.frontmatter.description}\n\n${memory.body}`,
        ),
      });
    }

    return {
      prompt,
      sections,
      tokens,
      injectedMemories: recalledMemories.map((m) => m.path),
    };
  }

  /**
   * Build prompt with recalled memories included in budget.
   */
  async buildPromptWithRecall(
    query: string,
    selectMemories: (params: {
      query: string;
      manifest: string;
      recentTools: readonly string[];
      signal?: AbortSignal;
    }) => Promise<string[]>,
    options?: {
      signal?: AbortSignal;
      recentTools?: readonly string[];
      alreadySurfaced?: ReadonlySet<string>;
      skipMemory?: boolean;
    },
  ): Promise<MemoryPromptResult> {
    if (options?.skipMemory || shouldIgnoreMemoryForQuery(query)) {
      this.log.log({ type: "skipped", reason: "memory ignored for current turn" });
      return {
        prompt: "",
        sections: { behavior: "", index: "", recalled: "" },
        tokens: { behavior: 0, index: 0, recalled: 0, total: 0 },
        injectedMemories: [],
      };
    }

    const recallQuery = query.trim();
    if (recallQuery.length === 0) {
      return this.buildPrompt([]);
    }

    // Import recall system
    const { recallRelevantMemories } = await import("./memory-recall");

    const result = await recallRelevantMemories(
      {
        memoryDir: this.memoryDir,
        query: recallQuery,
        signal: options?.signal,
        recentTools: options?.recentTools,
        alreadySurfaced: options?.alreadySurfaced,
      },
      selectMemories,
    );

    return this.buildPrompt(result.memories);
  }
}

function shouldIgnoreMemoryForQuery(query: string): boolean {
  const normalized = query.trim();
  if (normalized.length === 0) {
    return false;
  }

  return (
    /\b(ignore|skip|without|don't use|do not use)\b.*\bmemory\b/i.test(normalized) ||
    /忽略记忆|不要使用记忆|不使用记忆/.test(normalized)
  );
}

// ============================================================================
// Standalone Functions
// ============================================================================

/**
 * Load MEMORY.md index content.
 */
export async function loadIndexContent(memoryDir: string): Promise<string> {
  try {
    const indexPath = join(memoryDir, MEMORY_INDEX_FILENAME);
    return await readFile(indexPath, { encoding: "utf-8" });
  } catch {
    return "";
  }
}

/**
 * Check if memory directory has any memories.
 */
export async function hasMemories(memoryDir: string): Promise<boolean> {
  const headers = await scanMemoryFiles(memoryDir);
  return headers.length > 0;
}

/**
 * Get memory count.
 */
export async function getMemoryCount(memoryDir: string): Promise<number> {
  const headers = await scanMemoryFiles(memoryDir);
  return headers.length;
}

// ============================================================================
// Memory Injection with Context Budget
// ============================================================================

interface ContextBudget {
  total: number;
  used: number;
  reserved: number;
  available: number;
}

function createContextBudget(total: number, reserved: number): ContextBudget {
  return {
    total,
    used: 0,
    reserved,
    available: total - reserved,
  };
}

export function allocateMemoryBudget(budget: ContextBudget, memoryTokens: number): boolean {
  return memoryTokens <= budget.available;
}

/**
 * Build memory prompt with budget awareness.
 * Returns null if budget is insufficient.
 */
export async function buildMemoryPromptWithBudget(
  memoryDir: string,
  budget: ContextBudget,
  recalledMemories: MemoryFile[],
  estimateTokens: (text: string) => number,
): Promise<MemoryPromptResult | null> {
  // Build behavior section first
  const behaviorSection = buildMemoryBehaviorSection(DEFAULT_INJECTION_SETTINGS);
  const behaviorTokens = estimateTokens(behaviorSection);

  const remainingBudget = budget.available - behaviorTokens;
  if (remainingBudget <= 0) {
    return null;
  }

  // Build index section within budget
  const indexResult = await buildMemoryIndexSection(memoryDir);
  let indexSection = indexResult.content;
  let indexTokens = estimateTokens(indexSection);

  if (indexTokens > remainingBudget) {
    // Truncate index to fit
    const ratio = remainingBudget / indexTokens;
    const maxChars = Math.floor(indexSection.length * ratio);
    indexSection = indexSection.slice(0, maxChars) + "\n\n> [truncated]";
    indexTokens = estimateTokens(indexSection);
  }

  const newRemaining = remainingBudget - indexTokens;

  // Build recalled memories within remaining budget
  let recalledSection = "";
  let recalledTokens = 0;
  const selectedMemories: MemoryFile[] = [];

  for (const memory of recalledMemories) {
    const memoryText = `${memory.frontmatter.title}\n\n${memory.frontmatter.description}\n\n${memory.body}`;
    const memoryTokens = estimateTokens(memoryText);

    if (recalledTokens + memoryTokens <= newRemaining) {
      selectedMemories.push(memory);
      recalledTokens += memoryTokens;
    } else {
      break; // Budget exhausted
    }
  }

  if (selectedMemories.length > 0) {
    recalledSection = buildRecalledMemoriesSection(selectedMemories);
    recalledTokens = estimateTokens(recalledSection);
  }

  const sections = {
    behavior: behaviorSection,
    index: indexSection,
    recalled: recalledSection,
  };

  const prompt = [sections.behavior, sections.index, sections.recalled]
    .filter((s) => s.trim().length > 0)
    .join("\n\n");

  return {
    prompt,
    sections,
    tokens: {
      behavior: behaviorTokens,
      index: indexTokens,
      recalled: recalledTokens,
      total: behaviorTokens + indexTokens + recalledTokens,
    },
    injectedMemories: selectedMemories.map((m) => m.path),
  };
}
