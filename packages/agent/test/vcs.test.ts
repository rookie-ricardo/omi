import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { getGitDiffPreview, getGitRepoState } from "../src/index";

describe("vcs", () => {
  it("returns no repository for non-git directories", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "omi-vcs-non-git-"));
    const state = await getGitRepoState(workspaceRoot);
    expect(state.hasRepository).toBe(false);
  });

  it("detects changed files and builds previews for untracked files", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "omi-vcs-repo-"));
    initGitRepo(workspaceRoot);

    writeFileSync(join(workspaceRoot, "tracked.txt"), "hello\n");
    runGit(["add", "tracked.txt"], workspaceRoot);
    runGit(["commit", "-m", "init"], workspaceRoot);

    writeFileSync(join(workspaceRoot, "tracked.txt"), "hello world\n");
    writeFileSync(join(workspaceRoot, "new.txt"), "new file\n");

    const state = await getGitRepoState(workspaceRoot);
    expect(state.hasRepository).toBe(true);
    expect(state.files.some((file) => file.path === "tracked.txt" && file.status === "modified")).toBe(
      true,
    );
    expect(state.files.some((file) => file.path === "new.txt" && file.status === "untracked")).toBe(
      true,
    );

    const preview = await getGitDiffPreview(workspaceRoot, "new.txt");
    expect(preview.rows.some((row) => row.rightText.includes("new file"))).toBe(true);
  });
});

function initGitRepo(root: string) {
  runGit(["init"], root);
  runGit(["config", "user.email", "omi@example.com"], root);
  runGit(["config", "user.name", "OMI"], root);
}

function runGit(args: string[], cwd: string) {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}
