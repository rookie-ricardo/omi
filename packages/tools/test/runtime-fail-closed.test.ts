import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createAllTools } from "../src/tools.ts";
import {
  createInMemoryTaskToolRuntime,
  runWithToolRuntimeContext,
  resetTaskToolRuntime,
  setMcpRegistryRuntime,
  setSubAgentClientRuntime,
  setTaskToolRuntime,
} from "../src/runtime.ts";

describe("tool runtime fail-closed behavior", () => {
  afterEach(() => {
    setMcpRegistryRuntime(null);
    setSubAgentClientRuntime(null);
    resetTaskToolRuntime();
  });

  it("fails closed for mcp.resource tools when MCP runtime is missing", async () => {
    setMcpRegistryRuntime(null);
    const root = mkdtempSync(join(tmpdir(), "omi-tools-"));
    const tools = createAllTools(root);

    await expect(
      tools["mcp.resource.list"]?.execute("call-mcp-list", {})
    ).rejects.toThrow("MCP registry runtime is not configured");
  });

  it("fails closed for subagent tools when SubAgent runtime is missing", async () => {
    setSubAgentClientRuntime(null);
    const root = mkdtempSync(join(tmpdir(), "omi-tools-"));
    const tools = createAllTools(root);

    await expect(
      tools["subagent.spawn"]?.execute("call-subagent", { task: "do work" })
    ).rejects.toThrow("SubAgent runtime is not configured");
  });

  it("fails closed for task tools when task runtime is missing", async () => {
    resetTaskToolRuntime();
    const root = mkdtempSync(join(tmpdir(), "omi-tools-"));
    const tools = createAllTools(root);

    await expect(
      tools["task.create"]?.execute("call-task-create", {
        title: "T",
        originSessionId: "S",
        candidateReason: "C",
      })
    ).rejects.toThrow("Task runtime is not configured");
  });

  it("allows task tools when runtime is explicitly injected", async () => {
    setTaskToolRuntime(createInMemoryTaskToolRuntime());
    const root = mkdtempSync(join(tmpdir(), "omi-tools-"));
    const tools = createAllTools(root);

    const result = await tools["task.create"]?.execute("call-task-create", {
      title: "T",
      originSessionId: "S",
      candidateReason: "C",
    });

    const text = result?.content?.find((c) => c.type === "text")?.text ?? "";
    expect(text).toContain("Created task");
  });

  it("uses scoped runtime context for a single execution", async () => {
    resetTaskToolRuntime();
    const root = mkdtempSync(join(tmpdir(), "omi-tools-"));
    const tools = createAllTools(root);
    const scopedRuntime = createInMemoryTaskToolRuntime();

    const scopedResult = await runWithToolRuntimeContext(
      { taskRuntime: scopedRuntime },
      () =>
        tools["task.create"]?.execute("call-task-create", {
          title: "Scoped",
          originSessionId: "S",
          candidateReason: "C",
        }),
    );

    const text = scopedResult?.content?.find((c) => c.type === "text")?.text ?? "";
    expect(text).toContain("Created task");

    await expect(
      tools["task.create"]?.execute("call-task-create", {
        title: "Outside",
        originSessionId: "S",
        candidateReason: "C",
      }),
    ).rejects.toThrow("Task runtime is not configured");
  });
});
