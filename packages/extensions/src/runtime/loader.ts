import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import type { ExtensionDefinition, ExtensionFactoryInput } from "./types";

export interface ExtensionLoadResult {
  extensions: ExtensionDefinition[];
  diagnostics: string[];
}

export interface ExtensionLoaderOptions {
  workspaceRoot: string;
  agentDir?: string;
}

export async function loadExtensions(options: ExtensionLoaderOptions): Promise<ExtensionLoadResult> {
  const diagnostics: string[] = [];
  const extensions: ExtensionDefinition[] = [];
  const roots = [
    join(options.agentDir ?? join(homedir(), ".omi"), "extensions"),
    join(options.workspaceRoot, ".omi", "extensions"),
  ];

  for (const root of roots) {
    const entries = await discoverExtensionEntryPoints(root);
    for (const entryPoint of entries) {
      try {
        const extension = await loadExtension(entryPoint, {
          workspaceRoot: options.workspaceRoot,
          extensionDir: dirname(entryPoint),
        });
        if (extension) {
          extensions.push(extension);
        }
      } catch (error) {
        diagnostics.push(formatError(entryPoint, error));
      }
    }
  }

  return { extensions, diagnostics };
}

export async function loadExtension(
  entryPoint: string,
  input: ExtensionFactoryInput,
): Promise<ExtensionDefinition | null> {
  const module = await import(pathToFileURL(entryPoint).href);
  const candidate = module.default ?? module.createExtension ?? module.extension;
  if (!candidate) {
    return null;
  }

  if (typeof candidate === "function") {
    return (await candidate(input)) as ExtensionDefinition;
  }

  return candidate as ExtensionDefinition;
}

async function discoverExtensionEntryPoints(root: string): Promise<string[]> {
  if (!existsSync(root)) {
    return [];
  }

  const entryPoints: string[] = [];

  for (const candidate of [join(root, "index.mjs"), join(root, "index.js")]) {
    if (existsSync(candidate)) {
      entryPoints.push(candidate);
    }
  }

  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const fullPath = join(root, entry.name);
    if (entry.isFile() && (entry.name.endsWith(".mjs") || entry.name.endsWith(".js"))) {
      entryPoints.push(fullPath);
      continue;
    }

    if (!entry.isDirectory()) {
      continue;
    }

    for (const candidate of [join(fullPath, "index.mjs"), join(fullPath, "index.js")]) {
      if (existsSync(candidate)) {
        entryPoints.push(candidate);
      }
    }
  }

  return [...new Set(entryPoints)].sort((left, right) => left.localeCompare(right));
}

function formatError(entryPoint: string, error: unknown): string {
  return `[extensions:${entryPoint}] load failed: ${error instanceof Error ? error.message : String(error)}`;
}
