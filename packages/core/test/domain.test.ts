import { describe, expect, it } from "vitest";

import { sessionSchema, taskSchema } from "../src/index";

describe("core schemas", () => {
  it("parses sessions", () => {
    const session = sessionSchema.parse({
      id: "session_1",
      title: "Fix release pipeline",
      status: "idle",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    expect(session.latestUserMessage).toBeNull();
  });

  it("rejects invalid task status", () => {
    expect(() =>
      taskSchema.parse({
        id: "task_1",
        title: "bad",
        status: "open",
        originSessionId: "session_1",
        candidateReason: "reason",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    ).toThrow();
  });
});
