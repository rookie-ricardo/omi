import type {
  EventRecord,
  MemoryRecord,
  ProviderConfig,
  ReviewRequest,
  Run,
  Session,
  SessionHistoryEntry,
  SessionMessage,
  Task,
  ToolCall,
} from "@omi/core";

export interface AppStore {
  listSessions(): Session[];
  createSession(title: string): Session;
  getSession(sessionId: string): Session | null;
  updateSession(sessionId: string, partial: Partial<Session>): Session;
  listTasks(): Task[];
  createTask(input: Omit<Task, "id" | "createdAt" | "updatedAt">): Task;
  getTask(taskId: string): Task | null;
  updateTask(taskId: string, partial: Partial<Task>): Task;
  createRun(input: Omit<Run, "id" | "createdAt" | "updatedAt">): Run;
  updateRun(runId: string, partial: Partial<Run>): Run;
  getRun(runId: string): Run | null;
  listRuns(sessionId?: string): Run[];
  addMessage(
    input: Omit<SessionMessage, "id" | "createdAt"> & { parentHistoryEntryId?: string | null },
  ): SessionMessage;
  listMessages(sessionId: string): SessionMessage[];
  addSessionHistoryEntry?(
    input: Omit<SessionHistoryEntry, "id" | "createdAt" | "updatedAt"> & { id?: string },
  ): SessionHistoryEntry;
  listSessionHistoryEntries?(sessionId: string): SessionHistoryEntry[];
  addEvent(input: Omit<EventRecord, "id" | "createdAt">): EventRecord;
  listEvents(runId: string): EventRecord[];
  createToolCall(input: Omit<ToolCall, "createdAt" | "updatedAt"> & { id?: string }): ToolCall;
  updateToolCall(toolCallId: string, partial: Partial<ToolCall>): ToolCall;
  getToolCall(toolCallId: string): ToolCall | null;
  listToolCalls(runId: string): ToolCall[];
  listToolCallsBySession(sessionId: string): ToolCall[];
  createReviewRequest(input: Omit<ReviewRequest, "id" | "createdAt" | "updatedAt">): ReviewRequest;
  updateReviewRequest(reviewId: string, partial: Partial<ReviewRequest>): ReviewRequest;
  listReviewRequests(taskId?: string): ReviewRequest[];
  writeMemory(input: Omit<MemoryRecord, "id" | "createdAt" | "updatedAt">): MemoryRecord;
  searchMemories(query: string, scope?: string, scopeId?: string): MemoryRecord[];
  listMemories(scope?: string, scopeId?: string): MemoryRecord[];
  listProviderConfigs(): ProviderConfig[];
  upsertProviderConfig(
    input: Omit<ProviderConfig, "id" | "createdAt" | "updatedAt"> & { id?: string },
  ): ProviderConfig;
  getProviderConfig(providerId?: string): ProviderConfig | null;
  loadSessionRuntimeSnapshot(sessionId: string): { sessionId: string; snapshot: string; updatedAt: string } | null;
  saveSessionRuntimeSnapshot(input: { sessionId: string; snapshot: string; updatedAt: string }): void;
}
