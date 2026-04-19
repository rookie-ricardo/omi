import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createAllTools } from "../src/tools";

describe("tool surface contract", () => {
  it("only exposes the curated default built-ins", () => {
    const root = mkdtempSync(join(tmpdir(), "omi-tools-"));
    const tools = createAllTools(root);

    expect(Object.keys(tools).sort()).toEqual([
      "skill",
      "subagent",
    ]);
  });

  it("fails closed for removed tool families", () => {
    const root = mkdtempSync(join(tmpdir(), "omi-tools-"));
    const tools = createAllTools(root);

    expect(tools["bash"]).toBeUndefined();
    expect(tools["edit"]).toBeUndefined();
    expect(tools["read"]).toBeUndefined();
    expect(tools["write"]).toBeUndefined();
    expect(tools["mcp.resource.list"]).toBeUndefined();
    expect(tools["subagent.spawn"]).toBeUndefined();
    expect(tools["task.create"]).toBeUndefined();
    expect(tools["web.search"]).toBeUndefined();
    expect(tools["plan.enter"]).toBeUndefined();
    expect(tools["enter_worktree"]).toBeUndefined();
  });
});
