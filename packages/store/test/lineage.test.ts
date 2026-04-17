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

  it("resolves omitted parentId against the target branch lineage when branchId is provided", () => {
    const store = createAppDatabase(":memory:");
    const session = store.createSession("lineage-branch-test");
    const mainBranch = store.listBranches(session.id)[0];

    store.addMessage({
      sessionId: session.id,
      role: "user",
      content: "main-root",
      parentHistoryEntryId: null,
      branchId: mainBranch.id,
      originRunId: null,
    });
    const mainRootEntry = store.listSessionHistoryEntries?.(session.id).at(-1);
    expect(mainRootEntry).toBeTruthy();

    const featureBranch = store.createBranch({
      id: "branch_feature",
      sessionId: session.id,
      title: "feature",
    });

    const featureCheckpoint = store.addSessionHistoryEntry?.({
      sessionId: session.id,
      parentId: mainRootEntry?.id ?? null,
      kind: "branch_summary",
      messageId: null,
      summary: "feature-start",
      details: { source: "test" },
      branchId: featureBranch.id,
      lineageDepth: (mainRootEntry?.lineageDepth ?? 0) + 1,
      originRunId: null,
    });
    expect(featureCheckpoint).toBeTruthy();

    const waitUntil = Date.now() + 5;
    while (Date.now() < waitUntil) {
      // Ensure the next history entry has a strictly newer timestamp.
    }

    store.addMessage({
      sessionId: session.id,
      role: "user",
      content: "main-latest",
      parentHistoryEntryId: mainRootEntry?.id ?? null,
      branchId: mainBranch.id,
      originRunId: null,
    });
    const globalLatest = store.listSessionHistoryEntries?.(session.id).at(-1);
    expect(globalLatest?.branchId).toBe(mainBranch.id);

    const featureSummary = store.addSessionHistoryEntry?.({
      sessionId: session.id,
      parentId: null,
      kind: "branch_summary",
      messageId: null,
      summary: "feature-compaction",
      details: { source: "test" },
      branchId: featureBranch.id,
      lineageDepth: 0,
      originRunId: null,
    });

    expect(featureSummary).toBeTruthy();
    expect(featureSummary?.parentId).toBe(featureCheckpoint?.id ?? null);
    expect(featureSummary?.lineageDepth).toBe((featureCheckpoint?.lineageDepth ?? -1) + 1);
  });
});
