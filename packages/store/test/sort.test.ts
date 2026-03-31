import { describe, expect, it } from "vitest";

import { sortChronologicalRows } from "../src/sort";

describe("sortChronologicalRows", () => {
  it("keeps chronological rows stable by timestamp and id", () => {
    const rows = sortChronologicalRows([
      {
        id: "msg_b",
        createdAt: "2026-03-30T00:00:00.000Z",
        content: "second by id",
      },
      {
        id: "msg_a",
        createdAt: "2026-03-30T00:00:00.000Z",
        content: "first by id",
      },
    ]);

    expect(rows.map((row) => row.content)).toEqual(["first by id", "second by id"]);
  });
});
