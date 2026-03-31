import { describe, expect, it } from "vitest";

import { collectPendingApprovalEvents } from "../../src/renderer/routes";

describe("collectPendingApprovalEvents", () => {
  it("drops approvals once a decision event arrives", () => {
    const pending = collectPendingApprovalEvents({
      run_1: [
        {
          type: "run.tool_requested",
          payload: {
            toolCallId: "tool_1",
            requiresApproval: true,
          },
        },
        {
          type: "run.tool_decided",
          payload: {
            toolCallId: "tool_1",
            decision: "approved",
          },
        },
      ],
    });

    expect(pending).toEqual([]);
  });

  it("keeps unresolved approval requests visible", () => {
    const pending = collectPendingApprovalEvents({
      run_1: [
        {
          type: "run.tool_requested",
          payload: {
            toolCallId: "tool_1",
            requiresApproval: true,
          },
        },
      ],
    });

    expect(pending).toHaveLength(1);
    expect(String(pending[0]?.payload.toolCallId)).toBe("tool_1");
  });
});
