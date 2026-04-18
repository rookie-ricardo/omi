import { nowIso, sessionRuntimeSnapshotSchema } from "@omi/core";

import type { CompactionSummaryDocument } from "@omi/memory";

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
  contextFiles?: string[];
  taskId: string | null;
  providerConfigId: string | null;
  sourceRunId: string | null;
  mode: "start" | "retry" | "resume";
  parentMessageId?: string | null;
}

export interface SessionRuntimeState {
  version: number;
  sessionId: string;
  activeRunId: string | null;
  pendingRunIds: string[];
  queuedRuns: SessionRunQueueEntry[];
  blockedRunId: string | null;
  blockedToolCallId: string | null;
  pendingApprovalToolCallIds: string[];
  interruptedRunIds: string[];
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

  constructor(
    readonly sessionId: string,
    initialState?: Partial<SessionRuntimeState> | null,
    private readonly onChange?: (state: SessionRuntimeState) => void,
  ) {
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
      pendingApprovalToolCallIds: [...this.state.pendingApprovalToolCallIds],
      interruptedRunIds: [...this.state.interruptedRunIds],
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
      blockedRunId: null,
      blockedToolCallId: null,
      lastUserPrompt: prompt,
    });
  }

  blockOnTool(runId: string, toolCallId: string): void {
    this.touch({
      blockedRunId: runId,
      blockedToolCallId: toolCallId,
      pendingApprovalToolCallIds: uniqueIds([...this.state.pendingApprovalToolCallIds, toolCallId]),
    });
  }

  approveTool(runId: string, toolCallId: string): void {
    this.touch({
      activeRunId: runId,
      blockedRunId: this.state.blockedToolCallId === toolCallId ? null : this.state.blockedRunId,
      blockedToolCallId: this.state.blockedToolCallId === toolCallId ? null : this.state.blockedToolCallId,
      pendingApprovalToolCallIds: this.state.pendingApprovalToolCallIds.filter((id) => id !== toolCallId),
      interruptedRunIds: this.state.interruptedRunIds.filter((candidate) => candidate !== runId),
    });
  }

  rejectTool(runId: string, toolCallId: string): void {
    this.touch({
      activeRunId: this.state.activeRunId === runId ? null : this.state.activeRunId,
      blockedRunId: this.state.blockedToolCallId === toolCallId ? null : this.state.blockedRunId,
      blockedToolCallId: this.state.blockedToolCallId === toolCallId ? null : this.state.blockedToolCallId,
      pendingApprovalToolCallIds: this.state.pendingApprovalToolCallIds.filter((id) => id !== toolCallId),
    });
  }

  resumeRun(runId: string): void {
    this.touch({
      activeRunId: runId,
      blockedRunId: null,
      blockedToolCallId: null,
      interruptedRunIds: this.state.interruptedRunIds.filter((candidate) => candidate !== runId),
    });
  }

  resumeFromToolDecision(toolCallId: string): void {
    if (this.state.blockedToolCallId !== toolCallId) {
      return;
    }
    this.touch({
      blockedRunId: null,
      blockedToolCallId: null,
      pendingApprovalToolCallIds: this.state.pendingApprovalToolCallIds.filter((id) => id !== toolCallId),
    });
  }

  completeRun(runId: string, assistantResponse: string): void {
    this.finishRun(runId, {
      lastAssistantResponse: assistantResponse,
      blockedRunId: null,
      blockedToolCallId: null,
    });
  }

  failRun(runId: string): void {
    this.finishRun(runId, {
      lastAssistantResponse: null,
      blockedRunId: null,
      blockedToolCallId: null,
    });
  }

  cancelRun(runId: string): void {
    if (this.state.activeRunId === runId) {
      this.finishRun(runId, {
        lastAssistantResponse: null,
        blockedRunId: null,
        blockedToolCallId: null,
      });
      return;
    }
    this.touch({
      pendingRunIds: this.state.pendingRunIds.filter((candidate) => candidate !== runId),
      queuedRuns: this.state.queuedRuns.filter((candidate) => candidate.runId !== runId),
      interruptedRunIds: this.state.interruptedRunIds.filter((candidate) => candidate !== runId),
    });
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

  resetCompaction(): void {
    const timestamp = nowIso();
    this.state.compaction = {
      status: "idle",
      reason: null,
      requestedAt: null,
      updatedAt: timestamp,
      lastSummary: null,
      lastCompactedAt: null,
      error: null,
    };
    this.state.lastActivityAt = timestamp;
    this.persist();
  }

  private finishRun(
    runId: string,
    partial: Pick<
      SessionRuntimeState,
      "blockedRunId" | "blockedToolCallId" | "lastAssistantResponse"
    >,
  ): void {
    this.touch({
      activeRunId: this.state.activeRunId === runId ? null : this.state.activeRunId,
      pendingRunIds: this.state.pendingRunIds.filter((candidate) => candidate !== runId),
      queuedRuns: this.state.queuedRuns.filter((candidate) => candidate.runId !== runId),
      blockedRunId: partial.blockedRunId,
      blockedToolCallId: partial.blockedToolCallId,
      lastAssistantResponse: partial.lastAssistantResponse ?? this.state.lastAssistantResponse,
      interruptedRunIds: this.state.interruptedRunIds.filter((candidate) => candidate !== runId),
      pendingApprovalToolCallIds: partial.blockedToolCallId
        ? this.state.pendingApprovalToolCallIds
        : this.state.pendingApprovalToolCallIds.filter((id) => id !== partial.blockedToolCallId),
    });
  }

  private touch(partial: Partial<SessionRuntimeState>): void {
    this.state = {
      ...this.state,
      ...partial,
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

  constructor(private readonly store?: SessionRuntimeStore, _database?: unknown) {}

  getOrCreate(sessionId: string): SessionRuntime {
    const current = this.runtimes.get(sessionId);
    if (current) {
      return current;
    }

    const savedState = this.store?.load(sessionId) ?? null;
    const runtime = new SessionRuntime(sessionId, savedState, (state) => {
      this.store?.save(state);
    });
    this.runtimes.set(sessionId, runtime);
    return runtime;
  }

  get(sessionId: string): SessionRuntime | null {
    return this.runtimes.get(sessionId) ?? null;
  }

  getState(sessionId: string): SessionRuntimeState | null {
    return this.get(sessionId)?.snapshot() ?? null;
  }
}

export function createDatabaseSessionRuntimeStore(..._args: unknown[]): SessionRuntimeStore {
  return {
    load() {
      return null;
    },
    save() {},
  };
}

function hydrateState(
  sessionId: string,
  partial?: Partial<SessionRuntimeState> | null,
): SessionRuntimeState {
  const timestamp = nowIso();
  return {
    version: 1,
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
  const parsed = sessionRuntimeSnapshotSchema.parse({
    ...state,
    queuedRuns: state.queuedRuns,
    compaction: state.compaction,
  });
  return {
    ...state,
    version: parsed.version,
    queuedRuns: uniqueQueueEntries(state.queuedRuns),
    pendingRunIds: uniqueIds([...state.pendingRunIds, ...state.queuedRuns.map((entry) => entry.runId)]),
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
