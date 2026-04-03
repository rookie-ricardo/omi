import { describe, it, expect, vi } from "vitest";
import {
  isProtectedMemory,
  filterCompactableMemories,
  getProtectedMemories,
  createContextPipelineState,
  ContextPipelineCoordinator,
  createMemoryScopeCoordinatorMap,
  PROTECTED_MEMORY_TAGS,
  KEY_MEMORY_TAG,
} from "../src/context-pipeline";
import type { MemoryRecord } from "@omi/core";

describe("Context Pipeline", () => {
  describe("isProtectedMemory", () => {
    it("应该识别带有 key 标签的记忆为保护状态", () => {
      const memory: MemoryRecord = {
        id: "mem-1",
        tags: ["key", "other"],
      } as unknown as MemoryRecord;

      expect(isProtectedMemory(memory)).toBe(true);
    });

    it("应该识别带有 protected 标签的记忆为保护状态", () => {
      const memory: MemoryRecord = {
        id: "mem-2",
        tags: ["protected"],
      } as unknown as MemoryRecord;

      expect(isProtectedMemory(memory)).toBe(true);
    });

    it("应该识别大小写不敏感的保护标签", () => {
      const memory: MemoryRecord = {
        id: "mem-3",
        tags: ["KEY", "Protected"],
      } as unknown as MemoryRecord;

      expect(isProtectedMemory(memory)).toBe(true);
    });

    it("不应该将普通记忆识别为保护状态", () => {
      const memory: MemoryRecord = {
        id: "mem-4",
        tags: ["normal", "conversation"],
      } as unknown as MemoryRecord;

      expect(isProtectedMemory(memory)).toBe(false);
    });

    it("应该处理空标签数组", () => {
      const memory: MemoryRecord = {
        id: "mem-5",
        tags: [],
      } as unknown as MemoryRecord;

      expect(isProtectedMemory(memory)).toBe(false);
    });
  });

  describe("filterCompactableMemories", () => {
    it("应该过滤掉受保护的记忆", () => {
      const memories: MemoryRecord[] = [
        { id: "mem-1", tags: ["key"] } as unknown as MemoryRecord,
        { id: "mem-2", tags: ["normal"] } as unknown as MemoryRecord,
        { id: "mem-3", tags: ["protected"] } as unknown as MemoryRecord,
        { id: "mem-4", tags: ["conversation"] } as unknown as MemoryRecord,
      ];

      const result = filterCompactableMemories(memories);

      expect(result).toHaveLength(2);
      expect(result.map((m) => m.id)).toContain("mem-2");
      expect(result.map((m) => m.id)).toContain("mem-4");
      expect(result.map((m) => m.id)).not.toContain("mem-1");
      expect(result.map((m) => m.id)).not.toContain("mem-3");
    });

    it("应该返回空数组当所有记忆都受保护", () => {
      const memories: MemoryRecord[] = [
        { id: "mem-1", tags: ["key"] } as unknown as MemoryRecord,
        { id: "mem-2", tags: ["protected"] } as unknown as MemoryRecord,
      ];

      const result = filterCompactableMemories(memories);

      expect(result).toHaveLength(0);
    });

    it("应该返回所有记忆当没有受保护的记忆", () => {
      const memories: MemoryRecord[] = [
        { id: "mem-1", tags: ["normal"] } as unknown as MemoryRecord,
        { id: "mem-2", tags: ["conversation"] } as unknown as MemoryRecord,
      ];

      const result = filterCompactableMemories(memories);

      expect(result).toHaveLength(2);
    });
  });

  describe("getProtectedMemories", () => {
    it("应该只返回受保护的记忆", () => {
      const memories: MemoryRecord[] = [
        { id: "mem-1", tags: ["key"] } as unknown as MemoryRecord,
        { id: "mem-2", tags: ["normal"] } as unknown as MemoryRecord,
        { id: "mem-3", tags: ["protected"] } as unknown as MemoryRecord,
      ];

      const result = getProtectedMemories(memories);

      expect(result).toHaveLength(2);
      expect(result.map((m) => m.id)).toContain("mem-1");
      expect(result.map((m) => m.id)).toContain("mem-3");
      expect(result.map((m) => m.id)).not.toContain("mem-2");
    });
  });

  describe("createContextPipelineState", () => {
    it("应该创建初始状态", () => {
      const state = createContextPipelineState();

      expect(state.protectedMemoryIds).toBeInstanceOf(Set);
      expect(state.protectedMemoryIds.size).toBe(0);
      expect(state.protectedHistoryEntryIds).toBeInstanceOf(Set);
      expect(state.protectedHistoryEntryIds.size).toBe(0);
      expect(state.pendingCompaction).toBe(false);
      expect(state.lastCompactedAt).toBeNull();
    });
  });

  describe("ContextPipelineCoordinator", () => {
    describe("基本操作", () => {
      it("应该保护记忆", () => {
        const coordinator = new ContextPipelineCoordinator();

        coordinator.protectMemory("mem-1");

        expect(coordinator.getProtectedMemoryIds()).toContain("mem-1");
      });

      it("应该取消保护记忆", () => {
        const coordinator = new ContextPipelineCoordinator();
        coordinator.protectMemory("mem-1");

        coordinator.unprotectMemory("mem-1");

        expect(coordinator.getProtectedMemoryIds()).not.toContain("mem-1");
      });

      it("应该保护历史条目", () => {
        const coordinator = new ContextPipelineCoordinator();

        coordinator.protectHistoryEntry("entry-1");

        expect(coordinator.isHistoryEntryProtected("entry-1")).toBe(true);
      });

      it("应该检查压缩是否挂起", () => {
        const coordinator = new ContextPipelineCoordinator();

        expect(coordinator.isCompactionPending()).toBe(false);

        coordinator.requestCompaction();

        expect(coordinator.isCompactionPending()).toBe(true);
      });

      it("应该标记压缩完成", () => {
        const coordinator = new ContextPipelineCoordinator();
        coordinator.requestCompaction();

        coordinator.completeCompaction("test summary");

        expect(coordinator.isCompactionPending()).toBe(false);
      });

      it("应该标记压缩失败", () => {
        const coordinator = new ContextPipelineCoordinator();
        coordinator.requestCompaction();

        coordinator.failCompaction();

        expect(coordinator.isCompactionPending()).toBe(false);
      });
    });

    describe("回调函数", () => {
      it("应该在保护记忆时调用回调", () => {
        const onMemoryProtected = vi.fn();
        const coordinator = new ContextPipelineCoordinator({
          onMemoryProtected,
        });

        coordinator.protectMemory("mem-1");

        expect(onMemoryProtected).toHaveBeenCalledWith("mem-1");
      });

      it("应该在取消保护记忆时调用回调", () => {
        const onMemoryUnprotected = vi.fn();
        const coordinator = new ContextPipelineCoordinator({
          onMemoryUnprotected,
        });
        coordinator.protectMemory("mem-1");

        coordinator.unprotectMemory("mem-1");

        expect(onMemoryUnprotected).toHaveBeenCalledWith("mem-1");
      });

      it("不应该在未保护时调用取消保护回调", () => {
        const onMemoryUnprotected = vi.fn();
        const coordinator = new ContextPipelineCoordinator({
          onMemoryUnprotected,
        });

        coordinator.unprotectMemory("mem-1");

        expect(onMemoryUnprotected).not.toHaveBeenCalled();
      });

      it("应该在请求压缩时调用回调", () => {
        const onBeforeCompaction = vi.fn();
        const coordinator = new ContextPipelineCoordinator({
          onBeforeCompaction,
        });
        coordinator.protectMemory("mem-1");

        coordinator.requestCompaction();

        expect(onBeforeCompaction).toHaveBeenCalled();
        const protectedIds = onBeforeCompaction.mock.calls[0][0] as Set<string>;
        expect(protectedIds).toContain("mem-1");
      });

      it("应该在完成压缩时调用回调", () => {
        const onAfterCompaction = vi.fn();
        const coordinator = new ContextPipelineCoordinator({
          onAfterCompaction,
        });
        coordinator.protectMemory("mem-1");

        coordinator.completeCompaction("test summary");

        expect(onAfterCompaction).toHaveBeenCalledWith("test summary", 1);
      });
    });

    describe("同步受保护记忆", () => {
      it("应该从记忆记录同步受保护的记忆", () => {
        const coordinator = new ContextPipelineCoordinator();
        const memories: MemoryRecord[] = [
          { id: "mem-1", tags: ["key"] } as unknown as MemoryRecord,
          { id: "mem-2", tags: ["normal"] } as unknown as MemoryRecord,
          { id: "mem-3", tags: ["protected"] } as unknown as MemoryRecord,
        ];

        coordinator.syncProtectedMemories(memories);

        expect(coordinator.getProtectedMemoryIds()).toContain("mem-1");
        expect(coordinator.getProtectedMemoryIds()).toContain("mem-3");
        expect(coordinator.getProtectedMemoryIds()).not.toContain("mem-2");
      });

      it("应该在同步时调用新保护记忆的回调", () => {
        const onMemoryProtected = vi.fn();
        const coordinator = new ContextPipelineCoordinator({
          onMemoryProtected,
        });

        coordinator.syncProtectedMemories([
          { id: "mem-1", tags: ["key"] } as unknown as MemoryRecord,
        ]);

        expect(onMemoryProtected).toHaveBeenCalledWith("mem-1");
      });

      it("应该在同步时调用取消保护记忆的回调", () => {
        const onMemoryUnprotected = vi.fn();
        const coordinator = new ContextPipelineCoordinator({
          onMemoryUnprotected,
        });
        coordinator.protectMemory("mem-1");

        coordinator.syncProtectedMemories([
          { id: "mem-1", tags: ["normal"] } as unknown as MemoryRecord,
        ]);

        expect(onMemoryUnprotected).toHaveBeenCalledWith("mem-1");
      });
    });

    describe("过滤压缩候选", () => {
      it("应该过滤掉受保护的历史条目", () => {
        const coordinator = new ContextPipelineCoordinator();
        coordinator.protectHistoryEntry("entry-1");

        const entries = [
          { id: "entry-1", data: "protected" },
          { id: "entry-2", data: "normal" },
          { id: "entry-3", data: "normal" },
        ];

        const result = coordinator.filterCompactionCandidates(
          entries,
          (e) => e.id,
        );

        expect(result).toHaveLength(2);
        expect(result.map((e) => e.id)).not.toContain("entry-1");
      });
    });

    describe("快照功能", () => {
      it("应该生成正确的快照", () => {
        const coordinator = new ContextPipelineCoordinator();
        coordinator.protectMemory("mem-1");
        coordinator.protectMemory("mem-2");
        coordinator.protectHistoryEntry("entry-1");

        const snapshot = coordinator.getSnapshot();

        expect(snapshot.protectedMemoryIds).toContain("mem-1");
        expect(snapshot.protectedMemoryIds).toContain("mem-2");
        expect(snapshot.protectedHistoryEntryIds).toContain("entry-1");
      });

      it("应该从快照恢复状态", () => {
        const coordinator = new ContextPipelineCoordinator();

        coordinator.restoreSnapshot({
          protectedMemoryIds: ["mem-1", "mem-2"],
          protectedHistoryEntryIds: ["entry-1"],
        });

        expect(coordinator.getProtectedMemoryIds()).toContain("mem-1");
        expect(coordinator.getProtectedMemoryIds()).toContain("mem-2");
        expect(coordinator.getProtectedHistoryEntryIds()).toContain("entry-1");
      });

      it("应该处理部分快照", () => {
        const coordinator = new ContextPipelineCoordinator();

        coordinator.restoreSnapshot({
          protectedMemoryIds: ["mem-1"],
        });

        expect(coordinator.getProtectedMemoryIds()).toContain("mem-1");
        expect(coordinator.getProtectedHistoryEntryIds().size).toBe(0);
      });
    });
  });

  describe("createMemoryScopeCoordinatorMap", () => {
    it("应该创建新的协调器", () => {
      const map = createMemoryScopeCoordinatorMap();

      const coordinator = map.getOrCreate("session", "session-1");

      expect(coordinator).toBeInstanceOf(ContextPipelineCoordinator);
    });

    it("应该为相同的 scope 和 id 返回相同的协调器", () => {
      const map = createMemoryScopeCoordinatorMap();

      const coordinator1 = map.getOrCreate("session", "session-1");
      const coordinator2 = map.getOrCreate("session", "session-1");

      expect(coordinator1).toBe(coordinator2);
    });

    it("应该为不同的 scope 返回不同的协调器", () => {
      const map = createMemoryScopeCoordinatorMap();

      const coordinator1 = map.getOrCreate("session", "session-1");
      const coordinator2 = map.getOrCreate("session", "session-2");

      expect(coordinator1).not.toBe(coordinator2);
    });

    it("应该获取现有的协调器", () => {
      const map = createMemoryScopeCoordinatorMap();
      const coordinator = map.getOrCreate("session", "session-1");

      const retrieved = map.get("session", "session-1");

      expect(retrieved).toBe(coordinator);
    });

    it("应该对不存在的协调器返回 undefined", () => {
      const map = createMemoryScopeCoordinatorMap();

      const retrieved = map.get("session", "non-existent");

      expect(retrieved).toBeUndefined();
    });

    it("应该删除协调器", () => {
      const map = createMemoryScopeCoordinatorMap();
      map.getOrCreate("session", "session-1");

      map.delete("session", "session-1");

      expect(map.get("session", "session-1")).toBeUndefined();
    });

    it("应该清空所有协调器", () => {
      const map = createMemoryScopeCoordinatorMap();
      map.getOrCreate("session", "session-1");
      map.getOrCreate("session", "session-2");

      map.clear();

      expect(map.get("session", "session-1")).toBeUndefined();
      expect(map.get("session", "session-2")).toBeUndefined();
    });
  });

  describe("常量", () => {
    it("应该定义 KEY_MEMORY_TAG", () => {
      expect(KEY_MEMORY_TAG).toBe("key");
    });

    it("应该定义 PROTECTED_MEMORY_TAGS", () => {
      expect(PROTECTED_MEMORY_TAGS).toContain("key");
      expect(PROTECTED_MEMORY_TAGS).toContain("protected");
    });
  });
});
