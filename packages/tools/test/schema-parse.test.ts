import { afterEach, describe, expect, it, vi } from "vitest";

import { createTaskCreateTool } from "../src/task-tools.ts";
import { createWebSearchTool } from "../src/web-tools.ts";
import {
  createInMemoryTaskToolRuntime,
  resetTaskToolRuntime,
  setTaskToolRuntime,
} from "../src/runtime.ts";

describe("tool schema parse", () => {
  afterEach(() => {
    resetTaskToolRuntime();
    vi.restoreAllMocks();
  });

  it("rejects invalid task.create input before touching task runtime", async () => {
    const runtime = createInMemoryTaskToolRuntime();
    const createTaskSpy = vi.spyOn(runtime, "createTask");
    setTaskToolRuntime(runtime);

    const tool = createTaskCreateTool();

    await expect(
      tool.execute("task-create-invalid", {
        originSessionId: "session-1",
        candidateReason: "missing title",
      } as any)
    ).rejects.toThrow("Validation failed");

    expect(createTaskSpy).not.toHaveBeenCalled();
  });

  it("rejects invalid web.search input before network execution", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const tool = createWebSearchTool();

    await expect(
      tool.execute("web-search-invalid", {
        limit: 3,
      } as any)
    ).rejects.toThrow("Validation failed");

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
