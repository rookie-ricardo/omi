import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  type GitChangedFile,
  type GitDiffPreview,
  gitDiffPreviewSchema,
  gitRepoStateSchema,
} from "@omi/core";
import { diffLines } from "diff";

const execFileAsync = promisify(execFile);

export async function getGitRepoState(workspaceRoot: string) {
  const root = await resolveRepoRoot(workspaceRoot);
  if (!root) {
    return gitRepoStateSchema.parse({
      hasRepository: false,
      root: null,
      branch: null,
      branches: [],
      files: [],
    });
  }

  const [branch, branchesOutput, statusOutput] = await Promise.all([
    runGit(["rev-parse", "--abbrev-ref", "HEAD"], root).catch(() => "HEAD"),
    runGit(["branch", "--format=%(refname:short)"], root).catch(() => ""),
    runGit(["status", "--porcelain=v1", "--untracked-files=all"], root),
  ]);
  const branches = branchesOutput
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return gitRepoStateSchema.parse({
    hasRepository: true,
    root,
    branch: branch.trim() || "HEAD",
    branches,
    files: parseStatusLines(statusOutput),
  });
}

export async function getGitDiffPreview(
  workspaceRoot: string,
  targetPath: string,
): Promise<GitDiffPreview> {
  const repoState = await getGitRepoState(workspaceRoot);
  if (!repoState.hasRepository || !repoState.root) {
    throw new Error("Current workspace is not a Git repository.");
  }

  const file = repoState.files.find((entry) => entry.path === targetPath);
  if (!file) {
    throw new Error(`Git file ${targetPath} not found in working tree status.`);
  }

  const [leftContent, rightContent] = await Promise.all([
    readLeftSide(repoState.root, file),
    readRightSide(repoState.root, file),
  ]);

  const rows = buildDiffRows(leftContent, rightContent);
  return gitDiffPreviewSchema.parse({
    path: file.path,
    status: file.status,
    leftTitle: file.status === "untracked" ? "Empty" : "HEAD",
    rightTitle: file.status === "deleted" ? "Deleted" : "Working Tree",
    rows,
  });
}

async function resolveRepoRoot(workspaceRoot: string): Promise<string | null> {
  try {
    const output = await runGit(["rev-parse", "--show-toplevel"], workspaceRoot);
    return output.trim() || null;
  } catch {
    return null;
  }
}

async function readLeftSide(repoRoot: string, file: GitChangedFile): Promise<string> {
  if (file.status === "untracked" || file.status === "added") {
    return "";
  }

  const gitPath = file.originalPath ?? file.path;
  try {
    return await runGit(["show", `HEAD:${gitPath}`], repoRoot);
  } catch {
    return "";
  }
}

async function readRightSide(repoRoot: string, file: GitChangedFile): Promise<string> {
  if (file.status === "deleted") {
    return "";
  }

  try {
    return await readFile(join(repoRoot, file.path), "utf8");
  } catch {
    return "";
  }
}

function buildDiffRows(leftContent: string, rightContent: string) {
  const rows: Array<{
    kind: "context" | "added" | "removed";
    leftLineNumber: number | null;
    rightLineNumber: number | null;
    leftText: string;
    rightText: string;
  }> = [];
  let leftLineNumber = 1;
  let rightLineNumber = 1;

  for (const part of diffLines(leftContent, rightContent)) {
    const lines = part.value.split("\n");
    if (lines.at(-1) === "") {
      lines.pop();
    }

    if (part.added) {
      for (const line of lines) {
        rows.push({
          kind: "added",
          leftLineNumber: null,
          rightLineNumber,
          leftText: "",
          rightText: line,
        });
        rightLineNumber += 1;
      }
      continue;
    }

    if (part.removed) {
      for (const line of lines) {
        rows.push({
          kind: "removed",
          leftLineNumber,
          rightLineNumber: null,
          leftText: line,
          rightText: "",
        });
        leftLineNumber += 1;
      }
      continue;
    }

    for (const line of lines) {
      rows.push({
        kind: "context",
        leftLineNumber,
        rightLineNumber,
        leftText: line,
        rightText: line,
      });
      leftLineNumber += 1;
      rightLineNumber += 1;
    }
  }

  return rows;
}

function parseStatusLines(output: string): GitChangedFile[] {
  return output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => parseStatusLine(line));
}

function parseStatusLine(line: string): GitChangedFile {
  if (line.startsWith("?? ")) {
    return {
      path: line.slice(3),
      status: "untracked",
      staged: false,
      unstaged: true,
      originalPath: null,
    };
  }

  const indexCode = line[0] ?? " ";
  const worktreeCode = line[1] ?? " ";
  const rawPath = line.slice(3);
  const renameParts = rawPath.split(" -> ");
  const path = renameParts.at(-1) ?? rawPath;
  const originalPath = renameParts.length > 1 ? renameParts[0] : null;
  const statusCode = [indexCode, worktreeCode].find((code) => code !== " ") ?? "M";

  return {
    path,
    status: mapStatusCode(statusCode),
    staged: indexCode !== " ",
    unstaged: worktreeCode !== " ",
    originalPath,
  };
}

function mapStatusCode(code: string): GitChangedFile["status"] {
  switch (code) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "?":
      return "untracked";
    default:
      return "modified";
  }
}

async function runGit(args: string[], cwd: string): Promise<string> {
  const result = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 2_000_000,
  });
  return result.stdout;
}
