import type {
  MemoryRecord,
  ProviderConfig,
  Run,
  Session,
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

  addMessage(input: Omit<SessionMessage, "id" | "createdAt" | "updatedAt"> & { id?: string }): SessionMessage;
  getMessage(messageId: string): SessionMessage | null;
  updateMessage(messageId: string, partial: Partial<SessionMessage>): SessionMessage;
  listMessages(sessionId: string): SessionMessage[];
  listChildMessages(parentMessageId: string): SessionMessage[];

  createToolCall(input: Omit<ToolCall, "createdAt" | "updatedAt"> & { id?: string }): ToolCall;
  updateToolCall(toolCallId: string, partial: Partial<ToolCall>): ToolCall;
  getToolCall(toolCallId: string): ToolCall | null;
  listToolCallsBySession(sessionId: string): ToolCall[];
  listToolCallsByMessage(messageId: string): ToolCall[];

  writeMemory(input: Omit<MemoryRecord, "id" | "createdAt" | "updatedAt">): MemoryRecord;
  searchMemories(query: string, scope?: string, scopeId?: string): MemoryRecord[];
  listMemories(scope?: string, scopeId?: string): MemoryRecord[];

  listProviderConfigs(): ProviderConfig[];
  upsertProviderConfig(
    input: Omit<ProviderConfig, "id" | "createdAt" | "updatedAt"> & { id?: string },
  ): ProviderConfig;
  getProviderConfig(providerId?: string): ProviderConfig | null;
  deleteProviderConfig(id: string): void;
}
