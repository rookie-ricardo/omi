import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as processModule from "node:process";
import { join } from "node:path";
import {
  WorktreeStateManager,
  type WorktreeChanges,
  type WorktreeEvent,
} from "../src/modes/worktree-mode";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  rmSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("node:process", () => ({
  chdir: vi.fn(),
}));

describe("WorktreeStateManager", () => {
  const repoRoot = "/repo/omi";
  const worktreeName = "ws12-plan";
  const worktreePath = join(repoRoot, ".claude", "worktrees", worktreeName);
  const worktreeBranch = `worktree/${worktreeName}`;

  let worktreeMode: WorktreeStateManager;
  let execSyncMock: ReturnType<typeof vi.mocked<typeof childProcess.execSync>>;
  let existsSyncMock: ReturnType<typeof vi.mocked<typeof fs.existsSync>>;
  let mkdirSyncMock: ReturnType<typeof vi.mocked<typeof fs.mkdirSync>>;
  let chdirMock: ReturnType<typeof vi.mocked<typeof processModule.chdir>>;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    worktreeMode = new WorktreeStateManager();
    execSyncMock = vi.mocked(childProcess.execSync);
    existsSyncMock = vi.mocked(fs.existsSync);
    mkdirSyncMock = vi.mocked(fs.mkdirSync);
    chdirMock = vi.mocked(processModule.chdir);
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(repoRoot);

    existsSyncMock.mockReturnValue(false);
    mkdirSyncMock.mockImplementation(() => undefined);
    chdirMock.mockImplementation(() => undefined);

    execSyncMock.mockImplementation((command: string) => {
      if (command === "git branch --show-current") {
        return "main\n" as unknown as ReturnType<typeof childProcess.execSync>;
      }

      if (command === "git rev-parse HEAD") {
        return "commit-a\n" as unknown as ReturnType<typeof childProcess.execSync>;
      }

      if (command === "git rev-parse --abbrev-ref origin/HEAD") {
        return "origin/main\n" as unknown as ReturnType<typeof childProcess.execSync>;
      }

      if (command.startsWith("git worktree add ")) {
        return "" as unknown as ReturnType<typeof childProcess.execSync>;
      }

      if (command.startsWith("git worktree remove ")) {
        return "" as unknown as ReturnType<typeof childProcess.execSync>;
      }

      if (command.startsWith("git branch -D ")) {
        return "" as unknown as ReturnType<typeof childProcess.execSync>;
      }

      if (command === "git status --porcelain") {
        return "" as unknown as ReturnType<typeof childProcess.execSync>;
      }

      if (command.startsWith("git rev-list --count ")) {
        return "0\n" as unknown as ReturnType<typeof childProcess.execSync>;
      }

      throw new Error(`Unexpected git command: ${command}`);
    });
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    vi.clearAllMocks();
  });

  it("enters worktree mode and records the created worktree", async () => {
    const events: WorktreeEvent[] = [];
    worktreeMode.onEvent((event) => {
      events.push(event);
    });

    const result = await worktreeMode.enterWorktree(repoRoot, {
      name: worktreeName,
      sessionId: "session-1",
    });

    expect(result).toEqual({
      worktreePath,
      worktreeBranch,
      originalBranch: "main",
      originalHeadCommit: "commit-a",
      creationDurationMs: expect.any(Number),
    });
    expect(existsSyncMock).toHaveBeenCalledWith(join(repoRoot, ".claude", "worktrees"));
    expect(mkdirSyncMock).toHaveBeenCalledWith(join(repoRoot, ".claude", "worktrees"), {
      recursive: true,
    });
    expect(chdirMock).toHaveBeenCalledWith(worktreePath);
    expect(worktreeMode.getState()).toMatchObject({
      isInWorktree: true,
      worktreePath,
      worktreeName,
      worktreeBranch,
      originalCwd: repoRoot,
      originalBranch: "main",
      originalHeadCommit: "commit-a",
      sessionId: "session-1",
      hookBased: undefined,
    });
    expect(events).toEqual([
      expect.objectContaining({
        type: "enter_worktree",
        sessionId: "session-1",
        worktreePath,
        worktreeName,
        success: true,
      }),
    ]);
  });

  it("keeps the worktree when exiting with keep", async () => {
    const events: WorktreeEvent[] = [];
    worktreeMode.onEvent((event) => {
      events.push(event);
    });

    await worktreeMode.enterWorktree(repoRoot, {
      name: worktreeName,
      sessionId: "session-keep",
    });

    await worktreeMode.exitWorktree({ action: "keep" });

    expect(chdirMock).toHaveBeenCalledWith(repoRoot);
    expect(worktreeMode.isInWorktree()).toBe(false);
    expect(worktreeMode.getState()).toEqual({
      isInWorktree: false,
    });
    expect(events.map((event) => event.type)).toEqual([
      "enter_worktree",
      "keep_worktree",
    ]);
    expect(execSyncMock.mock.calls.some(([command]) => {
      return typeof command === "string" && command.startsWith("git worktree remove ");
    })).toBe(false);
  });

  it("removes the worktree when changes are known and discard is allowed", async () => {
    await worktreeMode.enterWorktree(repoRoot, {
      name: worktreeName,
      sessionId: "session-remove",
    });

    const countSpy = vi.spyOn(worktreeMode, "countWorktreeChanges").mockReturnValue({
      hasUncommittedChanges: false,
      hasNewCommits: false,
      uncommittedFilesCount: 0,
      newCommitsCount: 0,
    } satisfies WorktreeChanges);

    await worktreeMode.exitWorktree({
      action: "remove",
      discardChanges: true,
    });

    expect(execSyncMock).toHaveBeenCalledWith(
      `git worktree remove "${worktreePath}" --force`,
      expect.objectContaining({ stdio: "pipe" }),
    );
    expect(execSyncMock).toHaveBeenCalledWith(
      `git branch -D "${worktreeBranch}"`,
      expect.objectContaining({ stdio: "pipe" }),
    );
    expect(worktreeMode.isInWorktree()).toBe(false);
    expect(worktreeMode.getState()).toEqual({
      isInWorktree: false,
    });

    countSpy.mockRestore();
  });

  it("fails closed when worktree change detection cannot determine safety", async () => {
    await worktreeMode.enterWorktree(repoRoot, {
      name: worktreeName,
      sessionId: "session-fail-closed",
    });

    const countSpy = vi.spyOn(worktreeMode, "countWorktreeChanges").mockReturnValue(null);

    await expect(
      worktreeMode.exitWorktree({
        action: "remove",
        discardChanges: true,
      }),
    ).rejects.toThrow("Cannot determine worktree changes");

    expect(worktreeMode.isInWorktree()).toBe(true);
    expect(worktreeMode.getState()).toMatchObject({
      isInWorktree: true,
      worktreePath,
      worktreeName,
    });
    expect(execSyncMock.mock.calls.some(([command]) => {
      return typeof command === "string" && command.startsWith("git worktree remove ");
    })).toBe(false);

    countSpy.mockRestore();
  });
});
