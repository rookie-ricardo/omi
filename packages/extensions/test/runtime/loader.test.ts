import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { loadExtensions } from "../../src/runtime/loader";

const originalHome = process.env.HOME;

afterEach(() => {
  process.env.HOME = originalHome;
});

describe("extension loader", () => {
  it("discovers home and workspace extensions and passes factory input", async () => {
    const homeRoot = mkdtempSync(join(tmpdir(), "omi-ext-home-"));
    const workspaceRoot = mkdtempSync(join(tmpdir(), "omi-ext-workspace-"));
    const homeExtensionsRoot = join(homeRoot, ".omi", "extensions");
    const workspaceExtensionsRoot = join(workspaceRoot, ".omi", "extensions");
    process.env.HOME = homeRoot;

    mkdirSync(homeExtensionsRoot, { recursive: true });
    mkdirSync(workspaceExtensionsRoot, { recursive: true });

    writeFileSync(
      join(homeExtensionsRoot, "index.mjs"),
      `import { basename } from "node:path";

export default async ({ workspaceRoot, extensionDir }) => ({
  name: \`home:\${basename(workspaceRoot)}:\${basename(extensionDir)}\`,
  setup(context) {
    context.appendSystemPrompt("home setup");
  },
});
`,
    );

    writeFileSync(
      join(workspaceExtensionsRoot, "workspace.mjs"),
      `import { basename } from "node:path";

export default ({ workspaceRoot, extensionDir }) => ({
  name: \`workspace:\${basename(workspaceRoot)}:\${basename(extensionDir)}\`,
});
`,
    );

    const result = await loadExtensions({
      workspaceRoot,
      agentDir: join(homeRoot, ".omi"),
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.extensions).toHaveLength(2);
    expect(result.extensions.map((extension) => extension.name)).toEqual([
      `home:${basename(workspaceRoot)}:extensions`,
      `workspace:${basename(workspaceRoot)}:extensions`,
    ]);
  });
});
