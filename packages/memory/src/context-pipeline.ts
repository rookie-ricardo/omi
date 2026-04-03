/**
 * Context Pipeline - Coordinates memory and compaction to ensure key memories are preserved.
 *
 * This module provides:
 * 1. Key memory protection: Memories tagged with "key" or "protected" are excluded from compaction
 * 2. Memory-compaction coordination: Ensures compaction respects protected memories
 * 3. Compaction hooks: Callbacks for memory operations during compaction lifecycle
 */

import type { MemoryRecord } from "@omi/core";
import { PROTECTED_MEMORY_TAGS } from "./memory-types";

/** Tag used to mark memories as key/protected from compaction */
export const KEY_MEMORY_TAG = "key";
export const PROTECTED_MEMORY_TAG = "protected";

export { PROTECTED_MEMORY_TAGS };

/**
 * Check if a memory record is protected from compaction.
 * Memories with "key" or "protected" tags are excluded from compaction.
 */
export function isProtectedMemory(memory: MemoryRecord): boolean {
  return memory.tags.some((tag) => PROTECTED_MEMORY_TAGS.includes(tag.toLowerCase()));
}

/**
 * Filter memories to only include those that should be compacted.
 * Removes protected memories from the list.
 */
export function filterCompactableMemories(memories: MemoryRecord[]): MemoryRecord[] {
  return memories.filter((memory) => !isProtectedMemory(memory));
}

/**
 * Get only the protected memories from a list.
 */
export function getProtectedMemories(memories: MemoryRecord[]): MemoryRecord[] {
  return memories.filter(isProtectedMemory);
}

// ============================================================================
// Context Pipeline State
// ============================================================================

/**
 * State tracked by the context pipeline for compaction coordination.
 */
export interface ContextPipelineState {
  /** Memories that have been marked as protected */
  protectedMemoryIds: Set<string>;
  /** History entry IDs that correspond to protected memories */
  protectedHistoryEntryIds: Set<string>;
  /** Whether compaction has been requested */
  pendingCompaction: boolean;
  /** Last compaction timestamp */
  lastCompactedAt: string | null;
}

/**
 * Create a new context pipeline state.
 */
export function createContextPipelineState(): ContextPipelineState {
  return {
    protectedMemoryIds: new Set(),
    protectedHistoryEntryIds: new Set(),
    pendingCompaction: false,
    lastCompactedAt: null,
  };
}

// ============================================================================
// Context Pipeline Coordinator
// ============================================================================

/**
 * Callbacks for memory-compaction coordination.
 */
export interface ContextPipelineCallbacks {
  /** Called when a memory is marked as protected */
  onMemoryProtected?: (memoryId: string) => void;
  /** Called when a memory is unprotected */
  onMemoryUnprotected?: (memoryId: string) => void;
  /** Called before compaction starts */
  onBeforeCompaction?: (protectedIds: Set<string>) => void;
  /** Called after compaction completes */
  onAfterCompaction?: (summary: string, protectedCount: number) => void;
}

/**
 * Context Pipeline Coordinator - Manages coordination between memory writes
 * and compaction operations.
 *
 * Ensures that:
 * 1. Key memories are never included in compaction candidates
 * 2. Protected memory IDs are tracked across compaction boundaries
 * 3. Compaction respects the protected memory set
 */
export class ContextPipelineCoordinator {
  private state: ContextPipelineState;
  private callbacks: ContextPipelineCallbacks;

  constructor(callbacks: ContextPipelineCallbacks = {}) {
    this.state = createContextPipelineState();
    this.callbacks = callbacks;
  }

  /**
   * Get the current protected memory IDs.
   */
  getProtectedMemoryIds(): Set<string> {
    return new Set(this.state.protectedMemoryIds);
  }

  /**
   * Get the current protected history entry IDs.
   */
  getProtectedHistoryEntryIds(): Set<string> {
    return new Set(this.state.protectedHistoryEntryIds);
  }

  /**
   * Check if compaction is pending.
   */
  isCompactionPending(): boolean {
    return this.state.pendingCompaction;
  }

  /**
   * Register a memory as protected from compaction.
   */
  protectMemory(memoryId: string): void {
    if (!this.state.protectedMemoryIds.has(memoryId)) {
      this.state.protectedMemoryIds.add(memoryId);
      this.callbacks.onMemoryProtected?.(memoryId);
    }
  }

  /**
   * Unregister a memory from protected status.
   */
  unprotectMemory(memoryId: string): void {
    if (this.state.protectedMemoryIds.delete(memoryId)) {
      this.callbacks.onMemoryUnprotected?.(memoryId);
    }
  }

  /**
   * Sync protected memories from a list of memory records.
   * Updates the internal state to match the provided records.
   */
  syncProtectedMemories(memories: MemoryRecord[]): void {
    const newProtectedIds = new Set<string>();

    for (const memory of memories) {
      if (isProtectedMemory(memory)) {
        newProtectedIds.add(memory.id);
      }
    }

    // Detect changes
    for (const id of newProtectedIds) {
      if (!this.state.protectedMemoryIds.has(id)) {
        this.state.protectedMemoryIds.add(id);
        this.callbacks.onMemoryProtected?.(id);
      }
    }

    for (const id of this.state.protectedMemoryIds) {
      if (!newProtectedIds.has(id)) {
        this.state.protectedMemoryIds.delete(id);
        this.callbacks.onMemoryUnprotected?.(id);
      }
    }
  }

  /**
   * Register a history entry ID as protected (maps to a protected memory).
   */
  protectHistoryEntry(historyEntryId: string): void {
    this.state.protectedHistoryEntryIds.add(historyEntryId);
  }

  /**
   * Check if a history entry ID is protected.
   */
  isHistoryEntryProtected(historyEntryId: string): boolean {
    return this.state.protectedHistoryEntryIds.has(historyEntryId);
  }

  /**
   * Request compaction to be performed.
   */
  requestCompaction(): void {
    this.state.pendingCompaction = true;
    this.callbacks.onBeforeCompaction?.(this.state.protectedMemoryIds);
  }

  /**
   * Mark compaction as completed.
   */
  completeCompaction(summary: string): void {
    this.state.pendingCompaction = false;
    this.state.lastCompactedAt = new Date().toISOString();
    this.callbacks.onAfterCompaction?.(summary, this.state.protectedMemoryIds.size);
  }

  /**
   * Mark compaction as failed.
   */
  failCompaction(): void {
    this.state.pendingCompaction = false;
  }

  /**
   * Filter history entry IDs to exclude protected ones.
   * Used during compaction to determine which entries to compact.
   */
  filterCompactionCandidates<T extends { id?: string | null; sourceHistoryEntryId?: string | null }>(
    entries: T[],
    getId: (entry: T) => string | null,
  ): T[] {
    return entries.filter((entry) => {
      const id = getId(entry);
      return id === null || !this.state.protectedHistoryEntryIds.has(id);
    });
  }

  /**
   * Get the snapshot of protected state for persistence.
   */
  getSnapshot(): { protectedMemoryIds: string[]; protectedHistoryEntryIds: string[] } {
    return {
      protectedMemoryIds: [...this.state.protectedMemoryIds],
      protectedHistoryEntryIds: [...this.state.protectedHistoryEntryIds],
    };
  }

  /**
   * Restore state from a snapshot.
   */
  restoreSnapshot(snapshot: { protectedMemoryIds?: string[]; protectedHistoryEntryIds?: string[] }): void {
    this.state.protectedMemoryIds = new Set(snapshot.protectedMemoryIds ?? []);
    this.state.protectedHistoryEntryIds = new Set(snapshot.protectedHistoryEntryIds ?? []);
  }
}

// ============================================================================
// Memory Scoped Coordinator
// ============================================================================

/**
 * Factory for creating scope-specific coordinators.
 * Useful when managing multiple session contexts.
 */
export interface MemoryScopeCoordinatorMap {
  getOrCreate(scope: string, scopeId: string): ContextPipelineCoordinator;
  get(scope: string, scopeId: string): ContextPipelineCoordinator | undefined;
  delete(scope: string, scopeId: string): void;
  clear(): void;
}

/**
 * Create a scoped coordinator map.
 */
export function createMemoryScopeCoordinatorMap(): MemoryScopeCoordinatorMap {
  const coordinators = new Map<string, ContextPipelineCoordinator>();

  function makeKey(scope: string, scopeId: string): string {
    return `${scope}:${scopeId}`;
  }

  return {
    getOrCreate(scope: string, scopeId: string): ContextPipelineCoordinator {
      const key = makeKey(scope, scopeId);
      let coordinator = coordinators.get(key);
      if (!coordinator) {
        coordinator = new ContextPipelineCoordinator();
        coordinators.set(key, coordinator);
      }
      return coordinator;
    },

    get(scope: string, scopeId: string): ContextPipelineCoordinator | undefined {
      return coordinators.get(makeKey(scope, scopeId));
    },

    delete(scope: string, scopeId: string): void {
      coordinators.delete(makeKey(scope, scopeId));
    },

    clear(): void {
      coordinators.clear();
    },
  };
}
