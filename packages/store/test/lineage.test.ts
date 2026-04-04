import { describe, expect, it } from "vitest";

import { createAppDatabase } from "../src";

describe("session history lineage", () => {
  it("links branch summaries to the latest history entry when parentId is omitted", () => {
    const store = createAppDatabase(":memory:");
    const session = store.createSession("lineage-test");
    const mainBranch = store.listBranches(session.id)[0];

    store.addMessage({
      sessionId: session.id,
      role: "user",
      content: "hello",
      parentHistoryEntryId: null,
      branchId: mainBranch.id,
      originRunId: null,
    });

    const latestEntryBefore = store.listSessionHistoryEntries?.(session.id).at(-1);
    expect(latestEntryBefore).toBeTruthy();

    const summary = store.addSessionHistoryEntry?.({
      sessionId: session.id,
      parentId: null,
      kind: "branch_summary",
      messageId: null,
      summary: "compaction summary",
      details: { source: "test" },
      branchId: mainBranch.id,
      lineageDepth: 0,
      originRunId: null,
    });

    expect(summary).toBeTruthy();
    expect(summary?.parentId).toBe(latestEntryBefore?.id ?? null);
    expect(summary?.lineageDepth).toBe((latestEntryBefore?.lineageDepth ?? -1) + 1);
  });
});
