import { beforeEach, describe, expect, it } from "vitest";

import { setSubagentExecutorRuntime } from "../src/runtime";
import { createSubagentTool } from "../src/pi-subagent";

describe("subagent tool", () => {
  beforeEach(() => {
    setSubagentExecutorRuntime(null);
  });

  it("fails closed when runtime is missing", async () => {
    const tool = createSubagentTool();
    await expect(
      tool.execute("tool-call", { agent: "planner", task: "Write a plan" }),
    ).rejects.toThrow("Subagent executor runtime is not configured");
  });

  it("delegates parsed input to runtime executor", async () => {
    const tool = createSubagentTool();
    setSubagentExecutorRuntime(async (input) => ({
      content: "subagent output",
      details: { echoed: input },
    }));

    const result = await tool.execute("tool-call", {
      agent: "planner",
      task: "Write a plan",
      agentScope: "both",
    });

    expect(result.content).toEqual([{ type: "text", text: "subagent output" }]);
    expect(result.details).toMatchObject({
      input: {
        agent: "planner",
        task: "Write a plan",
        agentScope: "both",
      },
      content: "subagent output",
    });
  });
});
