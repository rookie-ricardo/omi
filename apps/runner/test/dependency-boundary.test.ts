import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function collectTypeScriptFiles(root: string): string[] {
  const entries = readdirSync(root);
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(root, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...collectTypeScriptFiles(fullPath));
      continue;
    }
    if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      files.push(fullPath);
    }
  }

  return files;
}

describe("runner dependency boundaries", () => {
  it("does not import agent internal source paths", () => {
    const roots = [join(process.cwd(), "src"), join(process.cwd(), "test")];
    const files = roots.flatMap((root) => collectTypeScriptFiles(root));
    const forbiddenImportPattern = /@omi\/agent\/src|packages\/agent\/src\//;

    for (const filePath of files) {
      const content = readFileSync(filePath, "utf8");
      expect(
        forbiddenImportPattern.test(content),
        `Forbidden internal agent import found in ${filePath}`,
      ).toBe(false);
    }
  });
});
