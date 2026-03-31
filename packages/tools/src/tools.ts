import { execFile } from "node:child_process";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@mariozechner/pi-ai";
import { z } from "zod";

import { AppError } from "@omi/core";

const execFileAsync = promisify(execFile);

export type ApprovalPolicy = "always" | "safe";
export type ToolName = string;

export interface ToolContext {
  workspaceRoot: string;
}

export interface ToolDefinition<TInput extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  inputSchema: TInput;
  parameters: AgentTool["parameters"];
  approvalPolicy: ApprovalPolicy;
  execute: (input: z.infer<TInput>, context: ToolContext) => Promise<Record<string, unknown>>;
}

export interface ExecutionResult {
  ok: boolean;
  output?: Record<string, unknown>;
  error?: { code: string; message: string };
}

export class ToolRegistry {
  private readonly definitions = new Map<string, ToolDefinition<z.ZodTypeAny>>();

  register<TInput extends z.ZodTypeAny>(definition: ToolDefinition<TInput>): void {
    this.definitions.set(definition.name, definition as unknown as ToolDefinition<z.ZodTypeAny>);
  }

  get(toolName: string): ToolDefinition<z.ZodTypeAny> | undefined {
    return this.definitions.get(toolName);
  }

  has(toolName: string): boolean {
    return this.definitions.has(toolName);
  }

  list(): Array<ToolDefinition<z.ZodTypeAny>> {
    return [...this.definitions.values()];
  }

  listNames(): string[] {
    return [...this.definitions.keys()];
  }
}

function resolveWorkspacePath(workspaceRoot: string, targetPath: string): string {
  const resolvedWorkspaceRoot = resolve(workspaceRoot);
  const fullPath = resolve(resolvedWorkspaceRoot, targetPath);
  const relativePath = relative(resolvedWorkspaceRoot, fullPath);

  if (relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
    throw new AppError("Path escapes workspace root", "PATH_OUTSIDE_WORKSPACE");
  }
  return fullPath;
}

const readFileSchema = z.object({ path: z.string().min(1) });
const writeFileSchema = z.object({ path: z.string().min(1), content: z.string() });
const patchFileSchema = z.object({
  path: z.string().min(1),
  find: z.string(),
  replace: z.string(),
});
const listDirSchema = z.object({ path: z.string().default(".") });
const runShellSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
});
const searchWorkspaceSchema = z.object({ query: z.string().min(1), path: z.string().default(".") });

export const toolRegistry = createBuiltInToolRegistry();

export function requiresApproval(toolName: ToolName): boolean {
  return toolRegistry.get(toolName)?.approvalPolicy === "always";
}

export async function executeTool(
  toolName: ToolName,
  rawInput: unknown,
  context: ToolContext,
): Promise<ExecutionResult> {
  const definition = toolRegistry.get(toolName);
  if (!definition) {
    return { ok: false, error: { code: "UNKNOWN_TOOL", message: `Unknown tool ${toolName}` } };
  }

  try {
    const input = definition.inputSchema.parse(rawInput);
    const output = await definition.execute(input, context);
    return { ok: true, output };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: error instanceof AppError ? error.code : "TOOL_EXECUTION_FAILED",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

async function searchWorkspaceWithRipgrep(
  workspaceRoot: string,
  searchRoot: string,
  query: string,
): Promise<string[] | null> {
  const relativeRoot = relative(workspaceRoot, searchRoot) || ".";

  try {
    const result = await execFileAsync(
      "rg",
      [
        "--line-number",
        "--color",
        "never",
        "--max-count",
        "1",
        "--smart-case",
        "--hidden",
        "--glob",
        "!.git",
        "--glob",
        "!node_modules",
        query,
        relativeRoot,
      ],
      {
        cwd: workspaceRoot,
        maxBuffer: 2_000_000,
      },
    );
    return parseRipgrepMatches(result.stdout, workspaceRoot);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error)) {
      return null;
    }

    const exitCode = Number((error as NodeJS.ErrnoException & { code?: number }).code);
    if (exitCode === 1) {
      return [];
    }

    return null;
  }
}

function parseRipgrepMatches(stdout: string, workspaceRoot: string): string[] {
  const matches = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const firstSeparator = line.indexOf(":");
      const secondSeparator = line.indexOf(":", firstSeparator + 1);
      if (firstSeparator === -1 || secondSeparator === -1) {
        return null;
      }

      const path = line.slice(0, firstSeparator);
      const lineNumber = line.slice(firstSeparator + 1, secondSeparator);
      const relativePath = relative(workspaceRoot, resolve(workspaceRoot, path));
      return `file:${relativePath}:${lineNumber}`;
    })
    .filter((entry): entry is string => entry !== null);

  return [...new Set(matches)].sort((left, right) => left.localeCompare(right));
}

async function searchWorkspaceWithNode(
  workspaceRoot: string,
  searchRoot: string,
  query: string,
): Promise<string[]> {
  const matches = new Set<string>();
  const normalizedQuery = query.toLowerCase();
  const caseSensitive = query !== normalizedQuery;

  async function walk(currentPath: string): Promise<void> {
    const entries = await readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules") {
        continue;
      }

      const fullPath = resolve(currentPath, entry.name);
      const relativePath = relative(workspaceRoot, fullPath);
      const candidateName = caseSensitive ? entry.name : entry.name.toLowerCase();
      const needle = caseSensitive ? query : normalizedQuery;

      if (entry.isDirectory()) {
        if (candidateName.includes(needle)) {
          matches.add(`dir:${relativePath}`);
        }
        await walk(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (candidateName.includes(needle)) {
        matches.add(`file:${relativePath}`);
      }

      const fileStat = await stat(fullPath);
      if (fileStat.size > 1_000_000) {
        continue;
      }

      let content: string;
      try {
        content = await readFile(fullPath, "utf8");
      } catch {
        continue;
      }

      const lines = content.split("\n");
      for (let index = 0; index < lines.length; index += 1) {
        const candidateLine = caseSensitive ? lines[index] : lines[index]?.toLowerCase();
        if (candidateLine?.includes(needle)) {
          matches.add(`file:${relativePath}:${index + 1}`);
          break;
        }
      }
    }
  }

  await walk(searchRoot);
  return [...matches].sort((left, right) => left.localeCompare(right));
}

function createBuiltInToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  registry.register({
    name: "read_file",
    description: "Read a UTF-8 file from the workspace.",
    inputSchema: readFileSchema,
    parameters: Type.Object({ path: Type.String() }),
    approvalPolicy: "safe",
    async execute(input, context) {
      const fullPath = resolveWorkspacePath(context.workspaceRoot, input.path);
      const content = await readFile(fullPath, "utf8");
      return { path: input.path, content };
    },
  });

  registry.register({
    name: "write_file",
    description: "Write a UTF-8 file in the workspace.",
    inputSchema: writeFileSchema,
    parameters: Type.Object({ path: Type.String(), content: Type.String() }),
    approvalPolicy: "always",
    async execute(input, context) {
      const fullPath = resolveWorkspacePath(context.workspaceRoot, input.path);
      await writeFile(fullPath, input.content, "utf8");
      return { path: input.path, bytes: Buffer.byteLength(input.content, "utf8") };
    },
  });

  registry.register({
    name: "patch_file",
    description: "Apply a simple string replacement patch in the workspace.",
    inputSchema: patchFileSchema,
    parameters: Type.Object({
      path: Type.String(),
      find: Type.String(),
      replace: Type.String(),
    }),
    approvalPolicy: "always",
    async execute(input, context) {
      const fullPath = resolveWorkspacePath(context.workspaceRoot, input.path);
      const current = await readFile(fullPath, "utf8");
      if (!current.includes(input.find)) {
        throw new AppError("Patch target not found", "PATCH_TARGET_NOT_FOUND");
      }
      const next = current.replace(input.find, input.replace);
      await writeFile(fullPath, next, "utf8");
      return { path: input.path, replaced: true };
    },
  });

  registry.register({
    name: "list_dir",
    description: "List files in a workspace directory.",
    inputSchema: listDirSchema,
    parameters: Type.Object({ path: Type.Optional(Type.String()) }),
    approvalPolicy: "safe",
    async execute(input, context) {
      const fullPath = resolveWorkspacePath(context.workspaceRoot, input.path);
      const entries = await readdir(fullPath);
      return { path: input.path, entries };
    },
  });

  registry.register({
    name: "run_shell",
    description: "Run a shell command in the workspace.",
    inputSchema: runShellSchema,
    parameters: Type.Object({
      command: Type.String(),
      args: Type.Optional(Type.Array(Type.String())),
    }),
    approvalPolicy: "always",
    async execute(input, context) {
      const result = await execFileAsync(input.command, input.args, {
        cwd: context.workspaceRoot,
        maxBuffer: 2_000_000,
      });
      return {
        command: input.command,
        args: input.args,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    },
  });

  registry.register({
    name: "search_workspace",
    description: "Search workspace files recursively with ripgrep-style full-text matching.",
    inputSchema: searchWorkspaceSchema,
    parameters: Type.Object({
      query: Type.String(),
      path: Type.Optional(Type.String()),
    }),
    approvalPolicy: "safe",
    async execute(input, context) {
      const root = resolveWorkspacePath(context.workspaceRoot, input.path);
      const matches =
        (await searchWorkspaceWithRipgrep(context.workspaceRoot, root, input.query)) ??
        (await searchWorkspaceWithNode(context.workspaceRoot, root, input.query));

      return { path: input.path, query: input.query, matches };
    },
  });

  return registry;
}
