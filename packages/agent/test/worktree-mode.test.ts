/**
 * Worktree Mode Tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { WorktreeMode, type WorktreeInfo } from "../src/modes/worktree-mode";

// Mock execSync
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

describe("WorktreeMode", () => {
  let worktreeMode: WorktreeMode;
  const testBasePath = "/tmp/test-worktrees";

  beforeEach(() => {
    vi.clearAllMocks();
    worktreeMode = new WorktreeMode({
      basePath: testBasePath,
      failOnDirty: false,
    });
  });

  afterEach(() => {
    // Clean up any created worktrees
    vi.restoreAllMocks();
  });

  describe("createWorktree", () => {
    it("should create a worktree with default branch", () => {
      const worktree = worktreeMode.createWorktree();

      expect(worktree.name).toBeDefined();
      expect(worktree.branch).toContain("agent/");
      expect(worktree.path).toContain(testBasePath);
      expect(worktree.status).toBe("active");
      expect(worktree.isDirty).toBe(false);
    });

    it("should create a worktree with custom branch", () => {
      const worktree = worktreeMode.createWorktree({
        branch: "feature/test",
      });

      expect(worktree.branch).toBe("feature/test");
    });

    it("should set current worktree", () => {
      worktreeMode.createWorktree();
      const current = worktreeMode.getCurrentWorktree();

      expect(current).toBeDefined();
      expect(current!.status).toBe("active");
    });

    it("should track multiple worktrees", () => {
      worktreeMode.createWorktree();
      worktreeMode.createWorktree();
      worktreeMode.createWorktree();

      expect(worktreeMode.getActiveCount()).toBe(3);
      expect(worktreeMode.listWorktrees()).toHaveLength(3);
    });
  });

  describe("switchTo", () => {
    it("should switch to existing worktree", () => {
      const wt1 = worktreeMode.createWorktree({ branch: "feature/1" });
      worktreeMode.createWorktree({ branch: "feature/2" });

      const switched = worktreeMode.switchTo(wt1.name);

      expect(switched.name).toBe(wt1.name);
      expect(worktreeMode.getCurrentWorktree()!.name).toBe(wt1.name);
    });

    it("should throw for non-existent worktree", () => {
      expect(() => worktreeMode.switchTo("non-existent")).toThrow();
    });
  });

  describe("checkDirty", () => {
    it("should return false when no changes", () => {
      const worktree = worktreeMode.createWorktree();

      // Mock execSync to return empty string (no changes)
      const { execSync } = require("node:child_process");
      (execSync as ReturnType<typeof vi.fn>).mockReturnValue("");

      const isDirty = worktreeMode.checkDirty(worktree.name);

      expect(isDirty).toBe(false);
      expect(worktree.isDirty).toBe(false);
    });

    it("should return true when changes exist", () => {
      const worktree = worktreeMode.createWorktree();

      // Mock execSync to return diff output
      const { execSync } = require("node:child_process");
      (execSync as ReturnType<typeof vi.fn>).mockReturnValue(" M modified.txt\n?? untracked.txt");

      const isDirty = worktreeMode.checkDirty(worktree.name);

      expect(isDirty).toBe(true);
      expect(worktree.isDirty).toBe(true);
    });
  });

  describe("detectChanges", () => {
    it("should detect modified files", () => {
      const worktree = worktreeMode.createWorktree();

      const { execSync } = require("node:child_process");
      (execSync as ReturnType<typeof vi.fn>).mockReturnValue(" M file1.txt\n M file2.txt");

      const changes = worktreeMode.detectChanges(worktree.name);

      expect(changes.modified).toContain("file1.txt");
      expect(changes.modified).toContain("file2.txt");
      expect(changes.totalChanges).toBe(2);
      expect(changes.safeToDelete).toBe(false);
    });

    it("should detect added files", () => {
      const worktree = worktreeMode.createWorktree();

      const { execSync } = require("node:child_process");
      (execSync as ReturnType<typeof vi.fn>).mockReturnValue("A  newfile.txt");

      const changes = worktreeMode.detectChanges(worktree.name);

      expect(changes.added).toContain("newfile.txt");
      expect(changes.totalChanges).toBe(1);
    });

    it("should detect deleted files", () => {
      const worktree = worktreeMode.createWorktree();

      const { execSync } = require("node:child_process");
      (execSync as ReturnType<typeof vi.fn>).mockReturnValue("D  deleted.txt");

      const changes = worktreeMode.detectChanges(worktree.name);

      expect(changes.deleted).toContain("deleted.txt");
      expect(changes.totalChanges).toBe(1);
    });

    it("should return safe when no changes", () => {
      const worktree = worktreeMode.createWorktree();

      const { execSync } = require("node:child_process");
      (execSync as ReturnType<typeof vi.fn>).mockReturnValue("");

      const changes = worktreeMode.detectChanges(worktree.name);

      expect(changes.totalChanges).toBe(0);
      expect(changes.safeToDelete).toBe(true);
    });
  });

  describe("canDelete", () => {
    it("should return safe when no changes", () => {
      const worktree = worktreeMode.createWorktree();

      const { execSync } = require("node:child_process");
      (execSync as ReturnType<typeof vi.fn>).mockReturnValue("");

      const result = worktreeMode.canDelete(worktree.name);

      expect(result.safe).toBe(true);
    });

    it("should return unsafe with failOnDirty", () => {
      const strictMode = new WorktreeMode({
        basePath: testBasePath,
        failOnDirty: true,
      });
      const worktree = strictMode.createWorktree();

      const { execSync } = require("node:child_process");
      (execSync as ReturnType<typeof vi.fn>).mockReturnValue(" M dirty.txt");

      const result = strictMode.canDelete(worktree.name);

      expect(result.safe).toBe(false);
      expect(result.reason).toContain("uncommitted changes");
    });

    it("should return unsafe when already cleaning", () => {
      const worktree = worktreeMode.createWorktree();
      worktree.status = "cleaning";

      const result = worktreeMode.canDelete(worktree.name);

      expect(result.safe).toBe(false);
      expect(result.reason).toContain("being cleaned");
    });
  });

  describe("getWorktree", () => {
    it("should get worktree by id", () => {
      const created = worktreeMode.createWorktree();
      const retrieved = worktreeMode.getWorktree(created.name);

      expect(retrieved).toBeDefined();
      expect(retrieved!.name).toBe(created.name);
    });

    it("should return undefined for non-existent", () => {
      const retrieved = worktreeMode.getWorktree("non-existent");
      expect(retrieved).toBeUndefined();
    });
  });

  describe("getDirtyWorktrees", () => {
    it("should return dirty worktrees", () => {
      const wt1 = worktreeMode.createWorktree({ branch: "clean" });
      worktreeMode.createWorktree({ branch: "dirty" });

      const { execSync } = require("node:child_process");
      (execSync as ReturnType<typeof vi.fn>).mockReturnValue("");

      worktreeMode.checkDirty(wt1.name);

      // Manually set dirty for testing
      worktreeMode.getWorktree(wt1.name)!.isDirty = false;
      worktreeMode.getWorktree("dirty")!.isDirty = true;

      const dirty = worktreeMode.getDirtyWorktrees();

      expect(dirty).toHaveLength(1);
      expect(dirty[0].isDirty).toBe(true);
    });
  });

  describe("refresh", () => {
    it("should update all worktree statuses", () => {
      worktreeMode.createWorktree();
      worktreeMode.createWorktree();

      const { execSync } = require("node:child_process");
      (execSync as ReturnType<typeof vi.fn>).mockReturnValue("");

      worktreeMode.refresh();

      expect(worktreeMode.listWorktrees()).toHaveLength(2);
    });
  });

  describe("execGit", () => {
    it("should execute git command", () => {
      worktreeMode.execGit(["status"]);

      const { execSync } = require("node:child_process");
      expect(execSync).toHaveBeenCalled();
    });
  });
});
