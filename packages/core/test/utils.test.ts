import { describe, expect, it } from "vitest";

import { createId, createUuidV6 } from "../src/utils";

describe("createUuidV6", () => {
  it("generates an RFC4122 variant uuid with version 6", () => {
    const uuid = createUuidV6();
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-6[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("uses the v6 uuid inside prefixed ids", () => {
    const id = createId("msg");
    expect(id).toMatch(
      /^msg_[0-9a-f]{8}-[0-9a-f]{4}-6[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
