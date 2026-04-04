import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  checkIndexValidity,
  formatMemoryManifest,
  type MemoryHeader,
  parseFrontmatter,
  parseMemoryIndex,
  recallRelevantMemories,
  scanMemoryFiles,
  validateMemoryReference,
} from "../src/memory-recall";
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
  const dir = await mkdtemp(join(tmpdir(), "omi-memory-"));
  cleanupDirs.push(dir);
  return dir;
}

async function writeMemoryFile(
  dir: string,
  relativePath: string,
  frontmatter: {
    title: string;
    description: string;
    type: "user" | "feedback" | "project" | "reference";
    tags: string[];
    updatedAt: string;
  },
  body = "",
): Promise<string> {
  const filePath = join(dir, relativePath);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    [
      "---",
      `title: ${frontmatter.title}`,
      `description: ${frontmatter.description}`,
      `type: ${frontmatter.type}`,
      `tags: [${frontmatter.tags.join(", ")}]`,
      `updatedAt: ${frontmatter.updatedAt}`,
      "---",
      "",
      body,
    ].join("\n"),
  );
  return filePath;
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

describe("memory-recall", () => {
  it("loads memory files that have the required frontmatter structure", async () => {
    const dir = await createTempMemoryDir();
    const filePath = await writeMemoryFile(
      dir,
      "preference.md",
      {
        title: "User preference",
        description: "Keep answers concise",
        type: "user",
        tags: ["key", "preference"],
        updatedAt: "2026-04-03T00:00:00.000Z",
      },
      "Remember to keep answers short.",
    );

    const headers = await scanMemoryFiles(dir);

    expect(headers).toHaveLength(1);
    expect(headers[0]).toMatchObject({
      path: filePath,
      filename: "preference.md",
      title: "User preference",
      description: "Keep answers concise",
      type: "user",
      tags: ["key", "preference"],
      updatedAt: "2026-04-03T00:00:00.000Z",
    });
  });

  it("parses full YAML frontmatter semantics (multiline and list syntax)", () => {
    const content = [
      "---",
      "title: \"User preference: concise\"",
      "description: |",
      "  Keep responses short.",
      "  Prefer bullet points when possible.",
      "type: user",
      "tags:",
      "  - key",
      "  - preference",
      "updatedAt: 2026-04-03T00:00:00.000Z",
      "metadata:",
      "  source: conversation",
      "---",
      "",
      "Body content.",
    ].join("\n");

    const result = parseFrontmatter(content);

    expect(result.body.trim()).toBe("Body content.");
    expect(result.frontmatter.title).toBe("User preference: concise");
    expect(result.frontmatter.description).toContain("Prefer bullet points");
    expect(result.frontmatter.tags).toEqual(["key", "preference"]);
    expect(result.frontmatter.metadata).toEqual({ source: "conversation" });
  });

  it("deduplicates index entries and drops missing links", async () => {
    const dir = await createTempMemoryDir();
    await writeMemoryFile(
      dir,
      "alpha.md",
      {
        title: "Alpha",
        description: "First",
        type: "user",
        tags: [],
        updatedAt: "2026-04-03T00:00:00.000Z",
      },
    );
    await writeMemoryFile(
      dir,
      "nested/beta.md",
      {
        title: "Beta",
        description: "Second",
        type: "feedback",
        tags: [],
        updatedAt: "2026-04-02T00:00:00.000Z",
      },
    );

    const content = [
      "- [Alpha](alpha.md) — first",
      "- [Alpha duplicate](./alpha.md) — duplicate",
      "- [Missing](missing.md) — missing",
      "- [Missing again](missing.md) — missing duplicate",
      "- [Beta](nested/beta.md) — second",
    ].join("\n");

    const result = parseMemoryIndex(content, dir);

    expect(result.index.entries.map((entry) => entry.title)).toEqual(["Alpha", "Beta"]);
    expect(result.validPaths.size).toBe(2);
    expect(result.invalidPaths).toHaveLength(1);
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0]).toContain("Line 1 and 2");
  });

  it("returns each missing index target only once when validating the index", async () => {
    const dir = await createTempMemoryDir();
    const content = [
      "- [Missing](missing.md) — missing",
      "- [Missing again](missing.md) — missing duplicate",
    ].join("\n");

    const invalidPaths = await checkIndexValidity(dir, content);

    expect(invalidPaths).toHaveLength(1);
    expect(invalidPaths[0]).toContain("/missing.md");
  });

  it("accepts MEMORY.md entry format variants while preserving dedupe", async () => {
    const dir = await createTempMemoryDir();
    await writeMemoryFile(
      dir,
      "alpha.md",
      {
        title: "Alpha",
        description: "First",
        type: "user",
        tags: [],
        updatedAt: "2026-04-03T00:00:00.000Z",
      },
    );
    await writeMemoryFile(
      dir,
      "beta.md",
      {
        title: "Beta",
        description: "Second",
        type: "project",
        tags: [],
        updatedAt: "2026-04-02T00:00:00.000Z",
      },
    );

    const content = [
      "* [Alpha](alpha.md) - first hook",
      "  + [Beta](beta.md) — second hook",
      "- [Alpha duplicate](./alpha.md) – duplicate",
    ].join("\n");

    const result = parseMemoryIndex(content, dir);

    expect(result.index.entries.map((entry) => entry.title)).toEqual(["Alpha", "Beta"]);
    expect(result.duplicates).toHaveLength(1);
  });

  it("puts protected memories ahead of regular memories in the manifest", () => {
    const headers: MemoryHeader[] = [
      {
        path: "/tmp/regular.md",
        filename: "regular.md",
        mtimeMs: 2000,
        title: "Regular note",
        description: "Normal context",
        type: "project",
        tags: [],
        updatedAt: "2026-04-03T00:00:00.000Z",
      },
      {
        path: "/tmp/protected.md",
        filename: "protected.md",
        mtimeMs: 1000,
        title: "Pinned preference",
        description: "Always keep this",
        type: "user",
        tags: ["key"],
        updatedAt: "2026-04-01T00:00:00.000Z",
      },
    ];

    const manifest = formatMemoryManifest(headers);

    expect(manifest.split("\n")[0]).toContain("Pinned preference");
    expect(manifest.split("\n")[0]).toContain("protected.md");
  });

  it("filters recent tool noise and deduplicates recalled selections", async () => {
    const dir = await createTempMemoryDir();
    const protectedPath = await writeMemoryFile(
      dir,
      "protected.md",
      {
        title: "Pinned preference",
        description: "Keep answers concise",
        type: "user",
        tags: ["key"],
        updatedAt: "2026-04-01T00:00:00.000Z",
      },
      "Always answer in a short form.",
    );
    const normalPath = await writeMemoryFile(
      dir,
      "normal.md",
      {
        title: "General note",
        description: "Useful non-tool guidance",
        type: "project",
        tags: [],
        updatedAt: "2026-04-03T00:00:00.000Z",
      },
      "This note should be recalled.",
    );
    await writeMemoryFile(
      dir,
      "noise.md",
      {
        title: "Tool reference",
        description: "pnpm vitest usage notes",
        type: "reference",
        tags: ["tool"],
        updatedAt: "2026-04-02T00:00:00.000Z",
      },
      "Tool docs should be filtered when the query is unrelated.",
    );

    let capturedManifest = "";
    const result = await recallRelevantMemories(
      {
        memoryDir: dir,
        query: "what should I remember",
        recentTools: ["pnpm", "vitest"],
      },
      async ({ manifest }) => {
        capturedManifest = manifest;
        const lines = manifest.split("\n").filter(Boolean);
        const filenames = lines
          .slice(0, 2)
          .map((line) => {
            const match = line.match(/\(([^,]+),/);
            return match?.[1] ?? "";
          })
          .filter(Boolean);
        return [...filenames, ...filenames];
      },
    );

    expect(capturedManifest).toContain("Pinned preference");
    expect(capturedManifest).not.toContain("noise.md");
    expect(result.totalCandidates).toBe(3);
    expect(result.memories.map((memory) => memory.path)).toEqual([protectedPath, normalPath]);
  });

  it("invalidates memory references when a linked file is missing", async () => {
    const dir = await createTempMemoryDir();
    const filePath = await writeMemoryFile(
      dir,
      "reference.md",
      {
        title: "Reference note",
        description: "Points to a nested file",
        type: "reference",
        tags: [],
        updatedAt: "2026-04-03T00:00:00.000Z",
      },
      "See [missing](./missing.md) for the underlying detail.",
    );

    const result = await validateMemoryReference(filePath);

    expect(result.isValid).toBe(false);
    expect(result.reason).toContain("Missing linked reference");
  });
});
