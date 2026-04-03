import { describe, it, expect } from "vitest";
import {
  MEMORY_FRONTMATTER_EXAMPLE,
  MEMORY_TYPES,
  memoryFrontmatterSchema,
  parseMemoryType,
} from "../src/memory-types";

describe("memory-types", () => {
  it("parses the required frontmatter fields for a memory file", () => {
    const result = memoryFrontmatterSchema.safeParse({
      title: "User preference",
      description: "Keep answers concise",
      type: "user",
      tags: ["key", "preference"],
      updatedAt: "2026-04-03T00:00:00.000Z",
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.title).toBe("User preference");
    expect(result.success && result.data.tags).toEqual(["key", "preference"]);
  });

  it("rejects incomplete frontmatter that is missing the new fields", () => {
    const result = memoryFrontmatterSchema.safeParse({
      title: "User preference",
      description: "Keep answers concise",
      type: "user",
      tags: [],
    });

    expect(result.success).toBe(false);
  });

  it("documents the required fields in the frontmatter example", () => {
    const example = MEMORY_FRONTMATTER_EXAMPLE.join("\n");

    expect(example).toContain("title:");
    expect(example).toContain("description:");
    expect(example).toContain("type:");
    expect(example).toContain("tags:");
    expect(example).toContain("updatedAt:");
  });

  it("keeps the memory type taxonomy closed", () => {
    expect(MEMORY_TYPES).toEqual(["user", "feedback", "project", "reference"]);
    expect(parseMemoryType("user")).toBe("user");
    expect(parseMemoryType("unknown")).toBeUndefined();
  });
});
