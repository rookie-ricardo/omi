import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Type } from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { executeTool, requiresApproval, toolRegistry } from "../src/index.ts";

describe("tools", () => {
  it("marks write operations as approval-required", () => {
    expect(requiresApproval("write_file")).toBe(true);
    expect(requiresApproval("read_file")).toBe(false);
  });

  it("reads files inside the workspace", async () => {
    const root = mkdtempSync(join(tmpdir(), "omi-tools-"));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "a.txt"), "hello");

    const result = await executeTool("read_file", { path: "src/a.txt" }, { workspaceRoot: root });
    expect(result.ok).toBe(true);
    expect(result.output?.content).toBe("hello");
  });

  it("rejects sibling prefix escapes outside the workspace", async () => {
    const base = mkdtempSync(join(tmpdir(), "omi-tools-"));
    const root = join(base, "foo");
    const sibling = join(base, "foobar");

    mkdirSync(root);
    mkdirSync(sibling);
    writeFileSync(join(sibling, "secret.txt"), "secret");

    const result = await executeTool(
      "read_file",
      { path: "../foobar/secret.txt" },
      { workspaceRoot: root },
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("PATH_OUTSIDE_WORKSPACE");
  });

  it("rejects invalid input", async () => {
    const root = mkdtempSync(join(tmpdir(), "omi-tools-"));
    const result = await executeTool("run_shell", { command: "" }, { workspaceRoot: root });
    expect(result.ok).toBe(false);
  });

  it("supports runtime tool registration", async () => {
    toolRegistry.register({
      name: "echo_test_tool",
      description: "Echo input for tests.",
      inputSchema: z.object({ value: z.string() }),
      parameters: Type.Object({ value: Type.String() }),
      approvalPolicy: "safe",
      async execute(input) {
        return { echoed: input.value };
      },
    });

    const result = await executeTool(
      "echo_test_tool",
      { value: "hello" },
      { workspaceRoot: mkdtempSync(join(tmpdir(), "omi-tools-")) },
    );

    expect(result.ok).toBe(true);
    expect(result.output?.echoed).toBe("hello");
  });

  it("searches workspace content recursively", async () => {
    const root = mkdtempSync(join(tmpdir(), "omi-tools-"));
    mkdirSync(join(root, "src", "nested"), { recursive: true });
    writeFileSync(join(root, "src", "nested", "worker.ts"), "const token = 'needle-value';\n");

    const result = await executeTool(
      "search_workspace",
      { query: "needle-value", path: "." },
      { workspaceRoot: root },
    );

    expect(result.ok).toBe(true);
    expect(result.output?.matches).toEqual(
      expect.arrayContaining([expect.stringContaining("src/nested/worker.ts")]),
    );
  });
});
