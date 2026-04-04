import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildMemoryBehaviorSection,
  buildMemoryPromptWithBudget,
  DEFAULT_INJECTION_SETTINGS,
  MemoryInjectionLog,
  MemoryInjector,
} from "../src/memory-inject";
import type { MemoryFile } from "../src/memory-types";

const cleanupDirs: string[] = [];

afterEach(async () => {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function createTempMemoryDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "omi-memory-inject-"));
  cleanupDirs.push(dir);
  return dir;
}

async function writeIndex(dir: string, content: string): Promise<void> {
  const filePath = join(dir, "MEMORY.md");
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

async function writeMemoryFile(
  dir: string,
  relativePath: string,
  title: string,
  description: string,
  body: string,
): Promise<void> {
  const filePath = join(dir, relativePath);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    [
      "---",
      `title: ${title}`,
      `description: ${description}`,
      "type: user",
      "tags: [key]",
      "updatedAt: 2026-04-03T00:00:00.000Z",
      "---",
      "",
      body,
    ].join("\n"),
  );
}

function makeMemoryFile(path: string, title: string, body: string): MemoryFile {
  return {
    path,
    frontmatter: {
      title,
      description: "Keep answers concise",
      type: "user",
      tags: [],
      updatedAt: "2026-04-03T00:00:00.000Z",
    },
    body,
    mtimeMs: Date.now(),
    isValid: true,
  };
}

describe("memory-inject", () => {
  it("returns an empty prompt and logs a skip when memory is disabled", async () => {
    const dir = await createTempMemoryDir();
    await writeIndex(dir, "- [Pinned preference](pinned.md) — keep concise");

    const log = new MemoryInjectionLog();
    const injector = new MemoryInjector({
      memoryDir: dir,
      settings: {
        ...DEFAULT_INJECTION_SETTINGS,
        enabled: false,
      },
      log,
      estimateTokens: (text) => (text.trim().length > 0 ? 1 : 0),
    });

    const result = await injector.buildPrompt();

    expect(result.prompt).toBe("");
    expect(result.injectedMemories).toEqual([]);
    expect(log.getEvents()).toHaveLength(1);
    expect(log.getEvents()[0]).toMatchObject({
      type: "skipped",
      reason: "memory disabled",
    });
  });

  it("injects recalled memories and records audit events", async () => {
    const dir = await createTempMemoryDir();
    await writeIndex(dir, "- [Pinned preference](pinned.md) — keep concise");

    const log = new MemoryInjectionLog();
    const injector = new MemoryInjector({
      memoryDir: dir,
      settings: DEFAULT_INJECTION_SETTINGS,
      log,
      estimateTokens: (text) => text.length,
    });

    const recalled = [
      makeMemoryFile(join(dir, "pinned.md"), "Pinned preference", "Keep answers concise."),
    ];

    const result = await injector.buildPrompt(recalled);

    expect(result.prompt).toContain("## Recalled Memories");
    expect(result.prompt).toContain("Pinned preference");
    expect(result.prompt).toContain("Keep answers concise.");
    expect(result.injectedMemories).toEqual([join(dir, "pinned.md")]);
    expect(log.getInjectedMemories()).toEqual([join(dir, "pinned.md")]);
    expect(log.getEvents().filter((event) => event.type === "injected")).toHaveLength(1);
  });

  it("keeps recalled memories within the budget and stops before overflowing", async () => {
    const dir = await createTempMemoryDir();
    await writeIndex(dir, "- [Pinned preference](pinned.md) — keep concise");

    const recalled = [
      makeMemoryFile(join(dir, "pinned.md"), "Pinned preference", "Keep answers concise."),
      makeMemoryFile(join(dir, "extra.md"), "Extra note", "This should not fit."),
    ];

    const result = await buildMemoryPromptWithBudget(
      dir,
      { total: 3, used: 0, reserved: 0, available: 3 },
      recalled,
      (text) => (text.trim().length > 0 ? 1 : 0),
    );

    expect(result).not.toBeNull();
    expect(result?.sections.behavior).toContain("## What NOT to save in memory");
    expect(result?.sections.index).toContain("## MEMORY.md");
    expect(result?.sections.recalled).toContain("Pinned preference");
    expect(result?.sections.recalled).not.toContain("Extra note");
    expect(result?.injectedMemories).toEqual([join(dir, "pinned.md")]);
    expect(result?.tokens.total).toBeLessThanOrEqual(3);
  });

  it("builds the behavior section from the enabled guidance blocks", () => {
    const section = buildMemoryBehaviorSection(DEFAULT_INJECTION_SETTINGS);

    expect(section).toContain("## What NOT to save in memory");
    expect(section).toContain("## When to access memories");
    expect(section).toContain("## Before recommending from memory");
  });

  it("uses the user query for recall instead of empty-query full recall", async () => {
    const dir = await createTempMemoryDir();
    await writeMemoryFile(
      dir,
      "preference.md",
      "Pinned preference",
      "Keep answers concise",
      "Always answer in a short form.",
    );

    const injector = new MemoryInjector({
      memoryDir: dir,
      settings: DEFAULT_INJECTION_SETTINGS,
      log: new MemoryInjectionLog(),
      estimateTokens: (text) => text.length,
    });

    let capturedQuery = "";
    const result = await injector.buildPromptWithRecall(
      "remember my answer style",
      async ({ query }) => {
        capturedQuery = query;
        return ["preference.md"];
      },
    );

    expect(capturedQuery).toBe("remember my answer style");
    expect(result.prompt).toContain("Pinned preference");
  });

  it("skips memory injection for one turn when query says to ignore memory", async () => {
    const dir = await createTempMemoryDir();
    const log = new MemoryInjectionLog();
    const injector = new MemoryInjector({
      memoryDir: dir,
      settings: DEFAULT_INJECTION_SETTINGS,
      log,
      estimateTokens: (text) => text.length,
    });

    const selectMemories = vi.fn(async () => ["preference.md"]);
    const result = await injector.buildPromptWithRecall(
      "for this answer, ignore memory",
      selectMemories,
    );

    expect(result.prompt).toBe("");
    expect(result.injectedMemories).toEqual([]);
    expect(selectMemories).not.toHaveBeenCalled();
    expect(log.getEvents().at(-1)).toMatchObject({
      type: "skipped",
      reason: "memory ignored for current turn",
    });
  });
});
