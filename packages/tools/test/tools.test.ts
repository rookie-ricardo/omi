import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { executeTool, requiresApproval, isBuiltInTool, createAllTools } from "../src/index.ts";

describe("tools", () => {
  it("marks mutating and shell tools as approval-required", () => {
    expect(requiresApproval("write")).toBe(true);
    expect(requiresApproval("edit")).toBe(true);
    expect(requiresApproval("notebook_edit")).toBe(true);
    expect(requiresApproval("bash")).toBe(true);
    expect(requiresApproval("read")).toBe(false);
    expect(requiresApproval("grep")).toBe(false);
  });

  it("identifies built-in tools", () => {
    expect(isBuiltInTool("read")).toBe(true);
    expect(isBuiltInTool("bash")).toBe(true);
    expect(isBuiltInTool("edit")).toBe(true);
    expect(isBuiltInTool("write")).toBe(true);
    expect(isBuiltInTool("ls")).toBe(true);
    expect(isBuiltInTool("grep")).toBe(true);
    expect(isBuiltInTool("glob")).toBe(true);
    expect(isBuiltInTool("tool.search")).toBe(true);
    expect(isBuiltInTool("unknown_tool")).toBe(false);
  });

  it("creates all tools for a workspace", () => {
    const root = mkdtempSync(join(tmpdir(), "omi-tools-"));
    const tools = createAllTools(root);
    expect(Object.keys(tools)).toEqual([
      "read",
      "ls",
      "grep",
      "glob",
      "bash",
      "edit",
      "notebook_edit",
      "write",
      "tool.search",
    ]);
    for (const tool of Object.values(tools)) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("reads files via executeTool", async () => {
    const root = mkdtempSync(join(tmpdir(), "omi-tools-"));
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "a.txt"), "hello world\n");

    const result = await executeTool(
      "read",
      { path: "src/a.txt" },
      { workspaceRoot: root },
    );

    expect(result.ok).toBe(true);
    expect(result.output?.content).toContain("hello world");
    expect((result.output as { meta?: unknown })?.meta).toBeDefined();
  });

  it("runs bash via executeTool", async () => {
    const root = mkdtempSync(join(tmpdir(), "omi-tools-"));
    const result = await executeTool(
      "bash",
      { command: "echo hello" },
      { workspaceRoot: root },
    );

    expect(result.ok).toBe(true);
    expect(result.output?.content).toContain("hello");
    expect((result.output as { meta?: unknown })?.meta).toBeDefined();
  });

  it("returns error for unknown tool", async () => {
    const root = mkdtempSync(join(tmpdir(), "omi-tools-"));
    const result = await executeTool(
      "unknown_tool",
      {},
      { workspaceRoot: root },
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("UNKNOWN_TOOL");
  });
});
