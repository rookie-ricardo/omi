/**
 * Memory recall system: scanning, relevance matching, and memory file loading.
 *
 * Implements the "recall" phase of the memory pipeline:
 * - Scan memory directory for .md files (excluding MEMORY.md)
 * - Load and parse memory file frontmatter
 * - Match memories to query using LLM-based selection
 * - Verify memory references before use (drift defense)
 */

import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

import {
  MEMORY_INDEX_FILENAME,
  MEMORY_INDEX_ENTRY_REGEX,
  MAX_MEMORY_FILES,
  FRONTMATTER_MAX_LINES,
  MAX_RECALL_RESULTS,
  parseMemoryType,
  memoryFrontmatterSchema,
  type MemoryType,
  type MemoryFile,
  type MemoryIndex,
  type MemoryIndexEntry,
  PROTECTED_MEMORY_TAGS,
} from "./memory-types";

// ============================================================================
// Frontmatter Parsing
// ============================================================================

/**
 * Parse frontmatter from markdown content.
 * Returns the frontmatter object and the remaining body content.
 */
export function parseFrontmatter(
  content: string,
): { frontmatter: Record<string, unknown>; body: string } {
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
  if (!frontmatterMatch) {
    return { frontmatter: {}, body: content };
  }

  const frontmatterText = frontmatterMatch[1] ?? "";
  const body = content.slice(frontmatterMatch[0].length);

  try {
    const parsed = parseYaml(frontmatterText);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return {
        frontmatter: parsed as Record<string, unknown>,
        body,
      };
    }
  } catch {
    // Ignore invalid YAML and treat as no frontmatter.
  }

  return { frontmatter: {}, body: content };
}

function normalizePath(value: string): string {
  return resolve(value);
}

function splitLinkTarget(target: string): { path: string; fragment: string } {
  const hashIndex = target.indexOf("#");
  const path = hashIndex === -1 ? target : target.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? "" : target.slice(hashIndex + 1);
  return { path, fragment };
}

function extractMarkdownLinks(content: string): string[] {
  const links: string[] = [];
  const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = linkPattern.exec(content))) {
    if (match[1]) {
      links.push(match[1]);
    }
  }
  return links;
}

function isExternalLink(target: string): boolean {
  return /^(https?:|mailto:|file:\/\/)/i.test(target);
}

function hasProtectedTags(tags: readonly string[]): boolean {
  return tags.some((tag) => PROTECTED_MEMORY_TAGS.includes(tag.toLowerCase()));
}

function recentToolNoiseScore(memory: MemoryHeader, recentTools: readonly string[], query: string): number {
  if (recentTools.length === 0) return 0;

  const searchable = [
    memory.title,
    memory.description ?? "",
    memory.filename,
  ]
    .join("\n")
    .toLowerCase();
  const queryLower = query.toLowerCase();

  let score = 0;
  for (const tool of recentTools) {
    const normalizedTool = tool.trim().toLowerCase();
    if (!normalizedTool) continue;
    if (queryLower.includes(normalizedTool)) continue;
    if (searchable.includes(normalizedTool)) {
      score += 1;
    }
  }
  return score;
}

// ============================================================================
// Memory Index Loading and Validation
// ============================================================================

export interface MemoryIndexLoadResult {
  index: MemoryIndex;
  validPaths: Set<string>;
  invalidPaths: string[];
  duplicates: string[];
}

/**
 * Parse and validate MEMORY.md index.
 * Checks:
 * - Link validity (files exist)
 * - Duplicate entries (same file referenced multiple times)
 */
export function parseMemoryIndex(
  content: string,
  memoryDir: string,
): MemoryIndexLoadResult {
  const lines = content.split("\n").filter((line) => line.trim());
  const validPaths = new Set<string>();
  const invalidPaths = new Set<string>();
  const seenPaths = new Map<string, number>();
  const duplicates = new Set<string>();
  const entries: MemoryIndexEntry[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(MEMORY_INDEX_ENTRY_REGEX);
    if (!match) continue;

    const [, title, filePath, hookRaw] = match;
    const hook = hookRaw?.trim() ?? "";
    const fullPath = normalizePath(join(memoryDir, filePath));

    if (!existsSync(fullPath)) {
      invalidPaths.add(fullPath);
      continue;
    }

    const firstSeen = seenPaths.get(fullPath);
    if (firstSeen !== undefined) {
      duplicates.add(`Line ${firstSeen + 1} and ${i + 1}: ${filePath}`);
      continue;
    }

    seenPaths.set(fullPath, i);
    entries.push({
      title,
      filePath,
      hook,
      lineNumber: i + 1,
    });

    validPaths.add(fullPath);
  }

  return {
    index: {
      entries,
      truncated: lines.length > 200,
      lineCount: lines.length,
      byteCount: content.length,
    },
    validPaths,
    invalidPaths: [...invalidPaths],
    duplicates: [...duplicates],
  };
}

/**
 * Check if memory index links are still valid.
 * Returns list of invalid file paths that are referenced in MEMORY.md but don't exist.
 */
export async function checkIndexValidity(
  memoryDir: string,
  content: string,
): Promise<string[]> {
  const lines = content.split("\n");
  const invalidPaths = new Set<string>();

  for (const line of lines) {
    const match = line.match(MEMORY_INDEX_ENTRY_REGEX);
    if (!match) continue;

    const [, , filePath] = match;
    const fullPath = normalizePath(join(memoryDir, filePath));

    try {
      await stat(fullPath);
    } catch {
      invalidPaths.add(fullPath);
    }
  }

  return [...invalidPaths];
}

// ============================================================================
// Memory File Scanning
// ============================================================================

export interface MemoryHeader {
  path: string;
  filename: string;
  mtimeMs: number;
  title: string;
  description: string | null;
  type: MemoryType | undefined;
  tags: string[];
  updatedAt: string;
}

/**
 * Scan memory directory for .md files, read their frontmatter, and return
 * a header list sorted newest-first (capped at MAX_MEMORY_FILES).
 */
export async function scanMemoryFiles(
  memoryDir: string,
  signal?: AbortSignal,
): Promise<MemoryHeader[]> {
  if (signal?.aborted) return [];

  try {
    const entries = await readdir(memoryDir, { recursive: true });
    const mdFiles = entries.filter(
      (f) =>
        typeof f === "string" && f.endsWith(".md") && basename(f) !== MEMORY_INDEX_FILENAME,
    );

    const results = await Promise.allSettled(
      mdFiles.map(async (relativePath): Promise<MemoryHeader | null> => {
        if (signal?.aborted) return null;

        const filePath = join(memoryDir, relativePath);
        let fileStat: ReturnType<typeof stat> extends Promise<infer T> ? T : never;

        try {
          fileStat = await stat(filePath);
        } catch {
          return null;
        }

        const content = await readFileFrontmatterRange(filePath, FRONTMATTER_MAX_LINES, signal);
        const { frontmatter } = parseFrontmatter(content);
        const parseResult = memoryFrontmatterSchema.safeParse(frontmatter);
        if (!parseResult.success) {
          return null;
        }

        return {
          path: filePath,
          filename: relativePath,
          mtimeMs: fileStat.mtimeMs,
          title: parseResult.data.title,
          description: parseResult.data.description,
          type: parseMemoryType(parseResult.data.type),
          tags: parseResult.data.tags,
          updatedAt: parseResult.data.updatedAt,
        };
      }),
    );

    return results
      .filter((r): r is PromiseFulfilledResult<MemoryHeader> => r.status === "fulfilled" && r.value !== null)
      .map((r) => r.value as MemoryHeader)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || b.mtimeMs - a.mtimeMs)
      .slice(0, MAX_MEMORY_FILES);
  } catch {
    return [];
  }
}

async function readFileFrontmatterRange(
  filePath: string,
  maxLines: number,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) return "";

  const content = await readFile(filePath, { encoding: "utf-8", signal: signal as never });
  const lines = content.split("\n");
  return lines.slice(0, maxLines).join("\n");
}

// ============================================================================
// Memory Loading
// ============================================================================

/**
 * Load a memory file by path.
 */
export async function loadMemoryFile(
  path: string,
  signal?: AbortSignal,
): Promise<MemoryFile | null> {
  if (signal?.aborted) return null;

  try {
    const [content, fileStat] = await Promise.all([
      readFile(path, { encoding: "utf-8", signal: signal as never }),
      stat(path),
    ]);

    const { frontmatter: rawFrontmatter, body } = parseFrontmatter(content);
    const parseResult = memoryFrontmatterSchema.safeParse(rawFrontmatter);

    if (!parseResult.success) {
      return null;
    }

    const referenceValidation = await validateMemoryReferenceLinks(path, body, signal);
    if (!referenceValidation.isValid) {
      return null;
    }

    return {
      path,
      frontmatter: parseResult.data,
      body,
      mtimeMs: fileStat.mtimeMs,
      isValid: true,
    };
  } catch {
    return null;
  }
}

/**
 * Load multiple memory files by path.
 */
export async function loadMemoryFiles(
  paths: string[],
  signal?: AbortSignal,
): Promise<MemoryFile[]> {
  const results = await Promise.allSettled(
    paths.map((path) => loadMemoryFile(path, signal)),
  );

  return results
    .filter((r): r is PromiseFulfilledResult<MemoryFile> => r.status === "fulfilled" && r.value !== null)
    .map((r) => r.value as MemoryFile);
}

// ============================================================================
// Memory Manifest
// ============================================================================

/**
 * Format memory headers as a text manifest for LLM selection.
 */
export function formatMemoryManifest(memories: MemoryHeader[]): string {
  const ordered = [...memories].sort((a, b) => {
    const aProtected = hasProtectedTags(a.tags);
    const bProtected = hasProtectedTags(b.tags);
    if (aProtected !== bProtected) {
      return aProtected ? -1 : 1;
    }
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || b.mtimeMs - a.mtimeMs;
  });

  return ordered
    .map((m) => {
      const tag = m.type ? `[${m.type}] ` : "";
      const ts = new Date(m.mtimeMs).toISOString().split("T")[0];
      return m.description
        ? `- ${tag}${m.title} (${m.filename}, ${ts}): ${m.description}`
        : `- ${tag}${m.title} (${m.filename}, ${ts})`;
    })
    .join("\n");
}

// ============================================================================
// LLM-based Relevance Selection
// ============================================================================

export interface RecallOptions {
  /** Memory directory path */
  memoryDir: string;
  /** User query for relevance matching */
  query: string;
  /** Abort signal */
  signal?: AbortSignal;
  /** Recently used tool names (to avoid surfacing tool reference docs) */
  recentTools?: readonly string[];
  /** Already surfaced memory paths (to avoid re-selecting) */
  alreadySurfaced?: ReadonlySet<string>;
}

export interface RecallResult {
  /** Selected memory files */
  memories: MemoryFile[];
  /** Total candidates scanned */
  totalCandidates: number;
  /** Selection timestamp */
  recalledAt: number;
}

/**
 * Find memory files relevant to a query by scanning memory file headers
 * and asking the LLM to select the most relevant ones.
 *
 * Returns up to MAX_RECALL_RESULTS memory files that are clearly useful
 * for processing the query.
 */
export async function recallRelevantMemories(
  options: RecallOptions,
  selectMemories: (params: {
    query: string;
    manifest: string;
    recentTools: readonly string[];
    signal?: AbortSignal;
  }) => Promise<string[]>,
): Promise<RecallResult> {
  const {
    memoryDir,
    query,
    signal,
    recentTools = [],
    alreadySurfaced = new Set(),
  } = options;

  const candidates = await scanMemoryFiles(memoryDir, signal);

  // Filter out already surfaced memories
  const filtered = candidates
    .filter((m) => !alreadySurfaced.has(m.path))
    .filter((m) => recentToolNoiseScore(m, recentTools, query) === 0)
    .sort((a, b) => {
      const aProtected = hasProtectedTags(a.tags);
      const bProtected = hasProtectedTags(b.tags);
      if (aProtected !== bProtected) {
        return aProtected ? -1 : 1;
      }
      return Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || b.mtimeMs - a.mtimeMs;
    });

  if (filtered.length === 0) {
    return { memories: [], totalCandidates: 0, recalledAt: Date.now() };
  }

  const manifest = formatMemoryManifest(filtered);
  const selectedFilenames = await selectMemories({
    query,
    manifest,
    recentTools,
    signal,
  });

  // Load selected memory files
  const selectedPaths = [...new Set(
    selectedFilenames
      .map((filename) => filtered.find((m) => m.filename === filename)?.path)
      .filter((p): p is string => p !== undefined),
  )];

  const memories = await loadMemoryFiles(selectedPaths, signal);

  return {
    memories,
    totalCandidates: candidates.length,
    recalledAt: Date.now(),
  };
}

// ============================================================================
// Memory Recall System
// ============================================================================

export interface MemoryRecallConfig {
  memoryDir: string;
  enabled: boolean;
  maxResults?: number;
}

export class MemoryRecallSystem {
  private readonly memoryDir: string;
  private readonly maxResults: number;

  constructor(config: MemoryRecallConfig) {
    this.memoryDir = config.memoryDir;
    this.maxResults = config.maxResults ?? MAX_RECALL_RESULTS;
  }

  /**
   * Get all memory files from the directory.
   */
  async getAllMemories(signal?: AbortSignal): Promise<MemoryFile[]> {
    const headers = await scanMemoryFiles(this.memoryDir, signal);
    const paths = headers.map((h) => h.path);
    return loadMemoryFiles(paths, signal);
  }

  /**
   * Get memories relevant to a query.
   */
  async recall(
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
    },
  ): Promise<RecallResult> {
    return recallRelevantMemories(
      {
        memoryDir: this.memoryDir,
        query,
        signal: options?.signal,
        recentTools: options?.recentTools,
        alreadySurfaced: options?.alreadySurfaced,
      },
      selectMemories,
    );
  }

  /**
   * Load a specific memory file by filename.
   */
  async loadByFilename(filename: string, signal?: AbortSignal): Promise<MemoryFile | null> {
    const path = join(this.memoryDir, filename);
    return loadMemoryFile(path, signal);
  }

  /**
   * Parse and validate MEMORY.md index.
   */
  async loadIndex(content: string): Promise<MemoryIndexLoadResult> {
    return parseMemoryIndex(content, this.memoryDir);
  }
}

// ============================================================================
// Memory Content Validation (Drift Defense)
// ============================================================================

export interface ValidationResult {
  path: string;
  isValid: boolean;
  reason?: string;
}

/**
 * Validate that a memory's references are still accurate.
 * Checks:
 * - File exists
 * - File has not been deleted
 */
export async function validateMemoryReference(path: string): Promise<ValidationResult> {
  try {
    const content = await readFile(path, { encoding: "utf-8" });
    const { body } = parseFrontmatter(content);
    const referenceCheck = await validateMemoryReferenceLinks(path, body);
    if (!referenceCheck.isValid) {
      return referenceCheck;
    }
    return { path, isValid: true };
  } catch (error: unknown) {
    return {
      path,
      isValid: false,
      reason: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Validate multiple memory references.
 */
export async function validateMemoryReferences(
  paths: string[],
): Promise<ValidationResult[]> {
  const results = await Promise.all(paths.map(validateMemoryReference));
  return results;
}

async function validateMemoryReferenceLinks(
  path: string,
  body: string,
  signal?: AbortSignal,
): Promise<ValidationResult> {
  const links = extractMarkdownLinks(body);
  const baseDir = dirname(path);

  for (const target of links) {
    if (isExternalLink(target)) continue;
    const { path: linkPath } = splitLinkTarget(target);
    if (!linkPath) continue;

    const fullPath = normalizePath(resolve(baseDir, linkPath));
    if (signal?.aborted) {
      return {
        path,
        isValid: false,
        reason: "Aborted",
      };
    }
    try {
      await stat(fullPath);
    } catch (error: unknown) {
      return {
        path,
        isValid: false,
        reason: `Missing linked reference: ${fullPath}`,
      };
    }
  }

  return { path, isValid: true };
}
