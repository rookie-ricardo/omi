import { describe, expect, it } from "vitest";

import { parseSessionHistoryEntry, serializeSessionHistoryEntry } from "../src/history";
import { sortChronologicalRows } from "../src/sort";

describe("session history storage helpers", () => {
  it("round-trips branch summaries and lineage through the storage shape", () => {
    const entry = {
      id: "hist_1",
      sessionId: "session_1",
      parentId: "hist_0",
      kind: "branch_summary" as const,
      messageId: null,
      summary: "Branch checkpoint",
      details: { source: "test", depth: 1 },
      branchId: null,
      lineageDepth: 0,
      originRunId: null,
      createdAt: "2026-03-30T00:00:00.000Z",
      updatedAt: "2026-03-30T00:00:00.000Z",
    };

    const row = serializeSessionHistoryEntry(entry);
    const restored = parseSessionHistoryEntry(row);

    expect(row).toMatchObject({
      id: "hist_1",
      sessionId: "session_1",
      parentId: "hist_0",
      kind: "branch_summary",
      messageId: null,
      summary: "Branch checkpoint",
    });
    expect(restored).toEqual(entry);
  });

  it("keeps history rows stable by timestamp and id", () => {
    const rows = sortChronologicalRows([
      {
        id: "hist_b",
        createdAt: "2026-03-30T00:00:00.000Z",
        label: "second",
      },
      {
        id: "hist_a",
        createdAt: "2026-03-30T00:00:00.000Z",
        label: "first",
      },
    ]);

    expect(rows.map((row) => row.label)).toEqual(["first", "second"]);
  });
});
