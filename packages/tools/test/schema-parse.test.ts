import { afterEach, describe, expect, it, vi } from "vitest";

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createWriteTool } from "../src/write.ts";
import { createToolArray } from "../src/tools.ts";

describe("tool schema parse", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects invalid write input before file mutations", async () => {
    const root = mkdtempSync(join(tmpdir(), "omi-tools-"));
    const tool = createWriteTool(root);

    await expect(
      tool.execute("write-invalid", {
        content: "missing path",
      } as any)
    ).rejects.toThrow();
  });

  it("registers tool.search in the curated default surface", () => {
    const root = mkdtempSync(join(tmpdir(), "omi-tools-"));
    const names = createToolArray(root).map((tool) => tool.name);

    expect(names).toContain("tool.search");
  });
});
