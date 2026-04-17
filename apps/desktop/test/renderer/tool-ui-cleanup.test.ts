import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const projectRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");

describe("tool-ui migration cleanup", () => {
  it("removes legacy tool detail files", () => {
    const legacyFiles = [
      "src/renderer/components/chat/BashActivityDetails.tsx",
      "src/renderer/components/chat/EditActivityDetails.tsx",
      "src/renderer/components/chat/ExploreActivityDetails.tsx",
      "src/renderer/components/chat/ToolActivityGroup.tsx",
      "src/renderer/components/chat/tool-utils.tsx",
      "src/renderer/components/ToolCallCard.tsx",
    ];

    for (const relativePath of legacyFiles) {
      expect(existsSync(resolve(projectRoot, relativePath))).toBe(false);
    }
  });

  it("chat view no longer imports legacy chat detail modules", () => {
    const chatPath = resolve(projectRoot, "src/renderer/components/views/Chat.tsx");
    const source = readFileSync(chatPath, "utf-8");

    expect(source.includes("../chat/")).toBe(false);
    expect(source.includes("ToolActivityGroup")).toBe(false);
    expect(source.includes("splitToolCallsByActivity")).toBe(false);
  });
});
