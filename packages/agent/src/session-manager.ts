import { randomUUID } from "node:crypto";
import type { AppStore } from "@omi/store";

import type { Session, SessionHistoryEntry } from "@omi/core";
import { nowIso } from "@omi/core";

import type { CompactionSummaryDocument } from "@omi/memory";

// ============================================================================
// Tree Navigation Types
// ============================================================================

/**
 * Base interface for all session entries.
 */
export interface SessionEntryBase {
  type: string;
  id: string;
  sessionId: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Read-only interface for session tree access.
 * Used by tree navigation and branch summarization.
 */
export interface ReadonlySessionStore {
  listSessionHistoryEntries(sessionId: string): SessionHistoryEntry[];
  getSessionHistoryEntry(entryId: string): SessionHistoryEntry | null;
}

/**
 * Read-only interface for session manager access.
 * Used by tree navigation and branch summarization.
 */
export interface ReadonlySessionManager {
  getSessionId(sessionId: string): string;
  getBranch(sessionId: string, fromId?: string | null): SessionHistoryEntry[];
  getEntry(sessionId: string, entryId: string): SessionHistoryEntry | undefined;
}

/**
 * Label entry for user-defined bookmarks/markers on entries.
 */
export interface LabelEntry extends SessionEntryBase {
  type: "label";
  targetId: string;
  label: string | undefined;
}

/**
 * Compaction entry type for tracking compaction summaries.
 */
export interface CompactionEntry<T = unknown> extends SessionEntryBase {
  type: "compaction";
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  details?: T;
  fromHook?: boolean;
}

/**
 * Branch summary entry type for branch summarization.
 */
export interface BranchSummaryEntry<T = unknown> extends SessionEntryBase {
  type: "branch_summary";
  fromId: string;
  summary: string;
  details?: T;
  fromHook?: boolean;
}

/**
 * Session tree node for getTree().
 */
export interface SessionTreeNode {
  entry: SessionHistoryEntry;
  label?: string;
  children: SessionTreeNode[];
}

export type CompactionStatus = "idle" | "requested" | "running" | "completed" | "failed";

export interface CompactionRuntimeState {
  status: CompactionStatus;
  reason: string | null;
  requestedAt: string | null;
  updatedAt: string;
  lastSummary: CompactionSummaryDocument | null;
  lastCompactedAt: string | null;
  error: string | null;
}

export interface SessionRunQueueEntry {
  runId: string;
  prompt: string;
  taskId: string | null;
  providerConfigId: string | null;
  sourceRunId: string | null;
  mode: "start" | "retry" | "resume";
  historyEntryId?: string | null;
  checkpointSummary?: string | null;
  checkpointDetails?: unknown | null;
}

export interface SessionRuntimeState {
  sessionId: string;
  activeRunId: string | null;
  pendingRunIds: string[];
  queuedRuns: SessionRunQueueEntry[];
  blockedRunId: string | null;
  blockedToolCallId: string | null;
  pendingApprovalToolCallIds: string[];
  interruptedRunIds: string[];
  selectedProviderConfigId: string | null;
  lastUserPrompt: string | null;
  lastAssistantResponse: string | null;
  lastActivityAt: string;
  compaction: CompactionRuntimeState;
}

export interface SessionRuntimeCompactionResult {
  summary: CompactionSummaryDocument;
  compactedAt?: string;
}

export interface SessionRuntimeStore {
  load(sessionId: string): SessionRuntimeState | null;
  save(state: SessionRuntimeState): void;
}

export class SessionRuntime {
  private state: SessionRuntimeState;
  private readonly onChange?: (state: SessionRuntimeState) => void;

  constructor(
    readonly sessionId: string,
    initialState?: Partial<SessionRuntimeState> | null,
    onChange?: (state: SessionRuntimeState) => void,
  ) {
    this.onChange = onChange;
    this.state = hydrateState(sessionId, initialState);
    if (initialState) {
      this.state = normalizeRestoredState(this.state);
    }
  }

  snapshot(): SessionRuntimeState {
    return {
      ...this.state,
      pendingRunIds: [...this.state.pendingRunIds],
      queuedRuns: this.state.queuedRuns.map((entry) => ({ ...entry })),
      interruptedRunIds: [...this.state.interruptedRunIds],
      pendingApprovalToolCallIds: [...this.state.pendingApprovalToolCallIds],
      compaction: cloneCompactionState(this.state.compaction),
    };
  }

  enqueueRun(entry: SessionRunQueueEntry): void {
    if (!this.state.pendingRunIds.includes(entry.runId)) {
      this.state.pendingRunIds.push(entry.runId);
    }

    if (!this.state.queuedRuns.some((candidate) => candidate.runId === entry.runId)) {
      this.state.queuedRuns.push({ ...entry });
    }

    this.touch({});
  }

  peekQueuedRun(): SessionRunQueueEntry | null {
    return this.state.queuedRuns[0] ? { ...this.state.queuedRuns[0] } : null;
  }

  dequeueRun(runId: string): SessionRunQueueEntry | null {
    const index = this.state.queuedRuns.findIndex((candidate) => candidate.runId === runId);
    if (index === -1) {
      this.state.pendingRunIds = this.state.pendingRunIds.filter((candidate) => candidate !== runId);
      return null;
    }

    const [removed] = this.state.queuedRuns.splice(index, 1);
    this.state.pendingRunIds = this.state.pendingRunIds.filter((candidate) => candidate !== runId);
    this.persist();
    return removed ? { ...removed } : null;
  }

  beginRun(runId: string, prompt: string): void {
    this.dequeueRun(runId);
    this.touch({
      activeRunId: runId,
      blockedToolCallId: null,
      blockedRunId: null,
      lastUserPrompt: prompt,
    });
  }

  blockOnTool(runId: string, toolCallId: string): void {
    this.touch({
      blockedRunId: runId,
      blockedToolCallId: toolCallId,
      pendingApprovalToolCallIds: uniqueIds([
        ...this.state.pendingApprovalToolCallIds,
        toolCallId,
      ]),
      interruptedRunIds: this.state.interruptedRunIds,
    });
  }

  approveTool(runId: string, toolCallId: string): void {
    this.touch({
      blockedRunId: this.state.blockedToolCallId === toolCallId ? null : this.state.blockedRunId,
      blockedToolCallId: this.state.blockedToolCallId === toolCallId ? null : this.state.blockedToolCallId,
      pendingApprovalToolCallIds: this.state.pendingApprovalToolCallIds.filter((id) => id !== toolCallId),
      activeRunId: runId,
      interruptedRunIds: this.state.interruptedRunIds.filter((candidate) => candidate !== runId),
    });
  }

  rejectTool(runId: string, toolCallId: string): void {
    this.touch({
      blockedRunId: this.state.blockedToolCallId === toolCallId ? null : this.state.blockedRunId,
      blockedToolCallId: this.state.blockedToolCallId === toolCallId ? null : this.state.blockedToolCallId,
      pendingApprovalToolCallIds: this.state.pendingApprovalToolCallIds.filter((id) => id !== toolCallId),
      activeRunId: this.state.activeRunId === runId ? null : this.state.activeRunId,
      interruptedRunIds: this.state.interruptedRunIds,
    });
  }

  resumeRun(runId: string): void {
    if (this.state.blockedRunId !== runId) {
      return;
    }

    this.touch({
      blockedRunId: null,
      blockedToolCallId: null,
      activeRunId: runId,
      interruptedRunIds: this.state.interruptedRunIds.filter((candidate) => candidate !== runId),
    });
  }

  resumeFromToolDecision(toolCallId: string): void {
    if (this.state.blockedToolCallId !== toolCallId) {
      return;
    }

    this.touch({
      blockedToolCallId: null,
      blockedRunId: null,
      pendingApprovalToolCallIds: this.state.pendingApprovalToolCallIds.filter((id) => id !== toolCallId),
      interruptedRunIds: this.state.interruptedRunIds,
    });
  }

  setSelectedProviderConfig(providerConfigId: string | null): void {
    this.touch({
      selectedProviderConfigId: providerConfigId,
    });
  }

  completeRun(runId: string, assistantResponse: string): void {
    this.finishRun(runId, {
      lastAssistantResponse: assistantResponse,
      blockedToolCallId: null,
      blockedRunId: null,
      interruptedRunIds: this.state.interruptedRunIds.filter((candidate) => candidate !== runId),
    });
  }

  failRun(runId: string): void {
    this.finishRun(runId, {
      blockedToolCallId: null,
      blockedRunId: null,
    });
  }

  cancelRun(runId: string): void {
    if (this.state.activeRunId === runId) {
      this.finishRun(runId, {
        blockedToolCallId: null,
        blockedRunId: null,
        interruptedRunIds: this.state.interruptedRunIds.filter((candidate) => candidate !== runId),
      });
      return;
    }

    const nextPending = this.state.pendingRunIds.filter((candidate) => candidate !== runId);
    const nextQueuedRuns = this.state.queuedRuns.filter((candidate) => candidate.runId !== runId);
    if (nextPending.length !== this.state.pendingRunIds.length || nextQueuedRuns.length !== this.state.queuedRuns.length) {
      this.touch({
        pendingRunIds: nextPending,
        queuedRuns: nextQueuedRuns,
        interruptedRunIds: this.state.interruptedRunIds.filter((candidate) => candidate !== runId),
      });
    }
  }

  requestCompaction(reason: string): void {
    const timestamp = nowIso();
    this.state.compaction = {
      ...this.state.compaction,
      status: "requested",
      reason,
      requestedAt: timestamp,
      updatedAt: timestamp,
      error: null,
    };
    this.state.lastActivityAt = timestamp;
    this.persist();
  }

  beginCompaction(): void {
    const timestamp = nowIso();
    this.state.compaction = {
      ...this.state.compaction,
      status: "running",
      updatedAt: timestamp,
      error: null,
    };
    this.state.lastActivityAt = timestamp;
    this.persist();
  }

  completeCompaction(result: SessionRuntimeCompactionResult): void {
    const timestamp = result.compactedAt ?? nowIso();
    this.state.compaction = {
      ...this.state.compaction,
      status: "completed",
      reason: null,
      requestedAt: null,
      updatedAt: timestamp,
      lastSummary: result.summary,
      lastCompactedAt: timestamp,
      error: null,
    };
    this.state.lastActivityAt = timestamp;
    this.persist();
  }

  failCompaction(error: string): void {
    const timestamp = nowIso();
    this.state.compaction = {
      ...this.state.compaction,
      status: "failed",
      updatedAt: timestamp,
      error,
    };
    this.state.lastActivityAt = timestamp;
    this.persist();
  }

  private finishRun(
    runId: string,
    partial: Partial<
      Pick<
        SessionRuntimeState,
        "blockedToolCallId" | "blockedRunId" | "lastAssistantResponse" | "pendingApprovalToolCallIds"
        | "interruptedRunIds"
      >
    >,
  ): void {
    const pendingRunIds = this.state.pendingRunIds.filter((candidate) => candidate !== runId);
    const queuedRuns = this.state.queuedRuns.filter((candidate) => candidate.runId !== runId);
    this.touch({
      ...partial,
      activeRunId: this.state.activeRunId === runId ? null : this.state.activeRunId,
      pendingRunIds,
      queuedRuns,
    });
  }

  private touch(partial: Partial<SessionRuntimeState>): void {
    this.state = {
      ...this.state,
      ...partial,
      pendingRunIds: partial.pendingRunIds ?? this.state.pendingRunIds,
      queuedRuns: partial.queuedRuns ?? this.state.queuedRuns,
      compaction: this.state.compaction,
      lastActivityAt: nowIso(),
    };
    this.persist();
  }

  private persist(): void {
    this.onChange?.(this.snapshot());
  }
}

export class SessionManager {
  private readonly runtimes = new Map<string, SessionRuntime>();
  private readonly leafIds = new Map<string, string | null>();
  private readonly labels = new Map<string, string>();

  constructor(private readonly store?: SessionRuntimeStore) {}

  getOrCreate(sessionId: string): SessionRuntime {
    const current = this.runtimes.get(sessionId);
    if (current) {
      return current;
    }

    const runtime = new SessionRuntime(sessionId, this.store?.load(sessionId), (state) => {
      this.store?.save(state);
    });
    this.runtimes.set(sessionId, runtime);
    return runtime;
  }

  restore(sessionId: string): SessionRuntime {
    return this.getOrCreate(sessionId);
  }

  get(sessionId: string): SessionRuntime | null {
    return this.runtimes.get(sessionId) ?? null;
  }

  getState(sessionId: string): SessionRuntimeState | null {
    return this.get(sessionId)?.snapshot() ?? null;
  }

  // ============================================================================
  // Tree Navigation Methods
  // ============================================================================

  getSessionId(sessionId: string): string {
    return sessionId;
  }

  getSessionDir(sessionId: string): string {
    // For SQLite-based storage, return empty string as there's no session directory
    return "";
  }

  getSessionFile(sessionId: string): string | undefined {
    // For SQLite-based storage, there's no session file
    return undefined;
  }

  getLeafId(sessionId: string): string | null {
    return this.leafIds.get(sessionId) ?? null;
  }

  getLeafEntry(sessionId: string): SessionHistoryEntry | null {
    const leafId = this.getLeafId(sessionId);
    if (!leafId) return null;
    return this.getEntry(sessionId, leafId) ?? null;
  }

  getEntry(sessionId: string, entryId: string): SessionHistoryEntry | null {
    const store = this.getReadonlyStore();
    if (!store) return null;
    return store.getSessionHistoryEntry(entryId);
  }

  getLabel(sessionId: string, entryId: string): string | undefined {
    return this.labels.get(`${sessionId}:${entryId}`);
  }

  setLabel(sessionId: string, targetId: string, label: string | undefined): string {
    const key = `${sessionId}:${targetId}`;
    if (label) {
      this.labels.set(key, label);
    } else {
      this.labels.delete(key);
    }
    return targetId;
  }

  getBranch(sessionId: string, fromId?: string | null): SessionHistoryEntry[] {
    const store = this.getReadonlyStore();
    if (!store) return [];

    const entries = store.listSessionHistoryEntries(sessionId);
    const leafId = fromId ?? this.getLeafId(sessionId) ?? undefined;

    if (!leafId) {
      // Return empty branch if no leaf is set
      return [];
    }

    return getBranchPath(entries, leafId);
  }

  getTree(sessionId: string): SessionTreeNode[] {
    const store = this.getReadonlyStore();
    if (!store) return [];

    const entries = store.listSessionHistoryEntries(sessionId);
    return buildTree(entries, this.labels, sessionId);
  }

  branch(sessionId: string, branchFromId: string, store?: ReadonlySessionStore): void {
    const readonlyStore = store ?? this.getReadonlyStore();
    if (!readonlyStore) {
      throw new Error(`Cannot branch: session store not available for session ${sessionId}`);
    }

    const entry = readonlyStore.getSessionHistoryEntry(branchFromId);
    if (!entry) {
      throw new Error(`Entry ${branchFromId} not found`);
    }
    this.leafIds.set(sessionId, branchFromId);
  }

  fork(sessionId: string, parentSessionId?: string): string {
    // Create a new session with optional parent reference
    const newSessionId = randomUUID();

    // Note: The actual fork implementation copies session data from the source session
    // to the new session. This requires the store to support:
    // - listSessionHistoryEntries() to read source entries
    // - addSessionHistoryEntry() to write to new session
    // For SQLite-based storage, this would copy all entries from source to new session.

    return newSessionId;
  }

  private getReadonlyStore(): ReadonlySessionStore | null {
    // This is a placeholder - in real usage, the store would be injected
    return null;
  }

  /**
   * Create a read-only session store from a database.
   * Used for tree navigation and branch summarization.
   */
  createReadonlySessionStore(database: AppStore): ReadonlySessionStore {
    const entryCache = new Map<string, SessionHistoryEntry>();

    return {
      listSessionHistoryEntries(sessionId: string): SessionHistoryEntry[] {
        const entries = database.listSessionHistoryEntries?.(sessionId) ?? [];
        for (const entry of entries) {
          entryCache.set(entry.id, entry);
        }
        return entries;
      },
      getSessionHistoryEntry(entryId: string): SessionHistoryEntry | null {
        return entryCache.get(entryId) ?? null;
      },
    };
  }

  /**
   * Create a read-only session manager from a database.
   * Used for tree navigation and branch summarization.
   */
  createReadonlySessionManager(database: AppStore, sessionId: string): ReadonlySessionManager {
    const store = this.createReadonlySessionStore(database);
    return {
      getSessionId(): string {
        return sessionId;
      },
      getBranch(targetId: string): SessionHistoryEntry[] {
        const entries = store.listSessionHistoryEntries(sessionId);
        return getBranchPath(entries, targetId);
      },
      getEntry(entryId: string): SessionHistoryEntry | undefined {
        return store.getSessionHistoryEntry(entryId) ?? undefined;
      },
    };
  }
}

/**
 * Build a tree structure from flat entries.
 */
function buildTree(
  entries: SessionHistoryEntry[],
  labels: Map<string, string>,
  sessionId: string,
): SessionTreeNode[] {
  const rootNodes: SessionTreeNode[] = [];
  const nodesById = new Map<string, SessionTreeNode>();

  // Create nodes for all entries
  for (const entry of entries) {
    const node: SessionTreeNode = {
      entry,
      label: labels.get(`${sessionId}:${entry.id}`),
      children: [],
    };
    nodesById.set(entry.id, node);
  }

  // Build tree structure
  for (const entry of entries) {
    const node = nodesById.get(entry.id)!;
    if (entry.parentId && nodesById.has(entry.parentId)) {
      nodesById.get(entry.parentId)!.children.push(node);
    } else if (!entry.parentId) {
      rootNodes.push(node);
    }
  }

  return rootNodes;
}

/**
 * Get the branch path from root to target entry.
 * @param entries - All session history entries
 * @param targetId - Target entry ID
 * @returns Entries from root to target (inclusive)
 */
export function getBranchPath(
  entries: SessionHistoryEntry[],
  targetId: string,
): SessionHistoryEntry[] {
  const entryMap = new Map<string, SessionHistoryEntry>();
  for (const entry of entries) {
    entryMap.set(entry.id, entry);
  }

  const path: SessionHistoryEntry[] = [];
  let current = entryMap.get(targetId);

  while (current) {
    path.unshift(current);
    current = current.parentId ? entryMap.get(current.parentId) : undefined;
  }

  return path;
}

/**
 * Find the common ancestor between two branches.
 * @param entries - All session history entries
 * @param fromId - Starting entry ID
 * @param toId - Target entry ID
 * @returns Common ancestor entry ID, or null if no common ancestor
 */
export function findCommonAncestor(
  entries: SessionHistoryEntry[],
  fromId: string,
  toId: string,
): string | null {
  const fromPath = getBranchPath(entries, fromId);
  const toPath = getBranchPath(entries, toId);

  const fromIds = new Set(fromPath.map((e) => e.id));

  // Find deepest common ancestor (iterate toPath from end to start)
  for (let i = toPath.length - 1; i >= 0; i--) {
    if (fromIds.has(toPath[i].id)) {
      return toPath[i].id;
    }
  }

  return null;
}

export function createDatabaseSessionRuntimeStore(database: AppStore): SessionRuntimeStore {
  return {
    load(sessionId: string): SessionRuntimeState | null {
      const snapshot = database.loadSessionRuntimeSnapshot(sessionId);
      if (snapshot) {
        try {
          return JSON.parse(snapshot.snapshot) as SessionRuntimeState;
        } catch {
          // Fall through to legacy recovery paths.
        }
      }

      const legacyState = loadLegacyRuntimeSnapshot(database, sessionId);
      if (legacyState) {
        const normalized = normalizeRestoredState(legacyState);
        persistSessionRuntimeSnapshot(database, normalized);
        return normalized;
      }

      const restoredState = restoreFromDatabaseRecords(database, sessionId);
      if (!restoredState) {
        return null;
      }

      persistSessionRuntimeSnapshot(database, restoredState);
      return restoredState;
    },
    save(state: SessionRuntimeState): void {
      persistSessionRuntimeSnapshot(database, state);
    },
  };
}

const SESSION_RUNTIME_MEMORY_TITLE = "Runtime Snapshot";

function hydrateState(
  sessionId: string,
  partial?: Partial<SessionRuntimeState> | null,
): SessionRuntimeState {
  const timestamp = nowIso();
  return {
    sessionId,
    activeRunId: partial?.activeRunId ?? null,
    pendingRunIds: partial?.pendingRunIds ? [...partial.pendingRunIds] : [],
    queuedRuns: partial?.queuedRuns ? partial.queuedRuns.map((entry) => ({ ...entry })) : [],
    blockedRunId: partial?.blockedRunId ?? null,
    blockedToolCallId: partial?.blockedToolCallId ?? null,
    pendingApprovalToolCallIds: partial?.pendingApprovalToolCallIds
      ? [...partial.pendingApprovalToolCallIds]
      : [],
    interruptedRunIds: partial?.interruptedRunIds ? [...partial.interruptedRunIds] : [],
    selectedProviderConfigId: partial?.selectedProviderConfigId ?? null,
    lastUserPrompt: partial?.lastUserPrompt ?? null,
    lastAssistantResponse: partial?.lastAssistantResponse ?? null,
    lastActivityAt: partial?.lastActivityAt ?? timestamp,
    compaction: partial?.compaction
      ? cloneCompactionState(partial.compaction)
      : {
          status: "idle",
          reason: null,
          requestedAt: null,
          updatedAt: timestamp,
          lastSummary: null,
          lastCompactedAt: null,
          error: null,
        },
  };
}

function normalizeRestoredState(state: SessionRuntimeState): SessionRuntimeState {
  const queuedRuns = uniqueQueueEntries(state.queuedRuns);
  const pendingRunIds = uniqueIds([
    ...state.pendingRunIds,
    ...queuedRuns.map((entry) => entry.runId),
  ]);

  if (state.activeRunId && !state.blockedRunId && !state.blockedToolCallId) {
    return {
      ...state,
      interruptedRunIds: uniqueIds([...state.interruptedRunIds, state.activeRunId]),
      activeRunId: null,
      queuedRuns,
      pendingRunIds,
    };
  }

  return {
    ...state,
    queuedRuns,
    pendingRunIds,
  };
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

function uniqueQueueEntries(entries: SessionRunQueueEntry[]): SessionRunQueueEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.runId)) {
      return false;
    }
    seen.add(entry.runId);
    return true;
  });
}

function cloneCompactionState(state: CompactionRuntimeState): CompactionRuntimeState {
  return {
    ...state,
    lastSummary: state.lastSummary
      ? JSON.parse(JSON.stringify(state.lastSummary)) as CompactionSummaryDocument
      : null,
  };
}

interface RunRow {
  id: string;
  sessionId: string;
  taskId: string | null;
  status: string;
  prompt: string | null;
  sourceRunId: string | null;
  recoveryMode: string | null;
  updatedAt: string;
}

interface ToolCallRow {
  id: string;
  runId: string;
  sessionId: string;
  approvalState: string;
  updatedAt: string;
}

function persistSessionRuntimeSnapshot(database: AppStore, state: SessionRuntimeState): void {
  const updatedAt = nowIso();
  database.saveSessionRuntimeSnapshot({
    sessionId: state.sessionId,
    snapshot: JSON.stringify(state),
    updatedAt,
  });
}

function loadLegacyRuntimeSnapshot(database: AppStore, sessionId: string): SessionRuntimeState | null {
  const candidates = database
    .listMemories("session", sessionId)
    .filter((memory) => memory.title === SESSION_RUNTIME_MEMORY_TITLE)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const latest = candidates[candidates.length - 1];
  if (!latest) {
    return null;
  }

  try {
    return normalizeRestoredState(JSON.parse(latest.content) as SessionRuntimeState);
  } catch {
    return null;
  }
}

function restoreFromDatabaseRecords(database: AppStore, sessionId: string): SessionRuntimeState | null {
  const session = database.getSession(sessionId);
  if (!session) {
    return null;
  }

  const runs = database
    .listRuns(sessionId)
    .map((run) => ({
      id: run.id,
      sessionId: run.sessionId,
      taskId: run.taskId,
      status: run.status,
      prompt: run.prompt ?? null,
      sourceRunId: run.sourceRunId ?? null,
      recoveryMode: run.recoveryMode ?? null,
      updatedAt: run.updatedAt,
    }))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const toolCalls = database
    .listToolCallsBySession(sessionId)
    .map((toolCall) => ({
      id: toolCall.id,
      runId: toolCall.runId,
      sessionId: toolCall.sessionId,
      approvalState: toolCall.approvalState,
      updatedAt: toolCall.updatedAt,
    }))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  const pendingApprovals = toolCalls.filter((toolCall) => toolCall.approvalState === "pending");
  const latestPending = pendingApprovals[0] ?? null;
  const blockedRunId =
    session.status === "blocked" && latestPending ? latestPending.runId : null;
  const blockedToolCallId =
    session.status === "blocked" && latestPending ? latestPending.id : null;

  const interruptedRunIds =
    session.status === "running"
      ? uniqueIds(runs.filter((run) => run.status === "running").map((run) => run.id))
      : [];
  const pendingRunRows = runs.filter((run) => run.status === "queued");
  const pendingRunIds = uniqueIds(pendingRunRows.map((run) => run.id));
  const selectedProviderConfigId = database.getProviderConfig()?.id ?? null;
  const runsById = new Map(runs.map((run) => [run.id, run] as const));
  const latestPrompt = resolveRecoveredPrompt(runs, runsById, session);

  return hydrateState(sessionId, {
    activeRunId: null,
    pendingRunIds,
    queuedRuns: pendingRunRows.map((run) => ({
      runId: run.id,
      prompt: resolveRecoveredPrompt([run], runsById, session),
      taskId: run.taskId,
      providerConfigId: selectedProviderConfigId,
      sourceRunId: run.sourceRunId ?? null,
      mode: (run.recoveryMode as SessionRunQueueEntry["mode"] | null) ?? "start",
    })),
    blockedRunId,
    blockedToolCallId,
    pendingApprovalToolCallIds: pendingApprovals.map((toolCall) => toolCall.id),
    interruptedRunIds,
    selectedProviderConfigId,
    lastUserPrompt: latestPrompt,
    lastAssistantResponse: session.latestAssistantMessage,
  });
}

function resolveRecoveredPrompt(runs: RunRow[], runsById: Map<string, RunRow>, session: Session): string {
  for (const run of runs) {
    const explicitPrompt = normalizePrompt(run.prompt);
    if (explicitPrompt) {
      return explicitPrompt;
    }

    if (run.sourceRunId) {
      const sourcePrompt = normalizePrompt(runsById.get(run.sourceRunId)?.prompt);
      if (sourcePrompt) {
        return sourcePrompt;
      }
    }
  }

  return normalizePrompt(session.latestUserMessage) ?? "";
}

function normalizePrompt(prompt: string | null | undefined): string | null {
  const normalized = prompt?.trim();
  return normalized ? normalized : null;
}
