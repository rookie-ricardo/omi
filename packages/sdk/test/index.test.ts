import { describe, expect, it } from "vitest";

import { Agent, createAgent, query } from "../src/index";

describe("@omi/sdk", () => {
  it("exposes the high-level agent API", () => {
    expect(typeof Agent).toBe("function");
    expect(typeof createAgent).toBe("function");
    expect(typeof query).toBe("function");
  });
});
