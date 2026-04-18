import { z } from "zod";

// ============================================================================
// Runner Event Type Enum
// ============================================================================

/**
 * All event types emitted by the agent runtime.
 *
 * Naming convention: `<domain>.<action>`
 * - `run.*` — run lifecycle and streaming events
 * - `sdk.*` — raw SDK messages (Claude Agent SDK passthrough)
 * - `log.*` — structured log entries
 */
export const runnerEventTypeSchema = z.enum([
  // Run lifecycle
  "run.started",
  "run.completed",
  "run.failed",
  "run.canceled",

  // Streaming
  "run.delta",

  // Skill resolution
  "run.skills_resolved",
  "run.skill_selected",
  "run.skill_nudged",

  // Tool lifecycle
  "run.tool_requested",
  "run.tool_started",
  "run.tool_progress",
  "run.tool_finished",
  "run.tool_failed",

  // Tool approval flow
  "run.blocked",
  "run.tool_decided",

  // Logging
  "log.entry",
]);

export type RunnerEventType = z.infer<typeof runnerEventTypeSchema>;

// ============================================================================
// Event Payload Types
// ============================================================================

/** Base fields present in every run-scoped event payload. */
export interface RunEventBase {
  runId: string;
  sessionId: string;
  [key: string]: unknown;
}

export interface RunStartedPayload extends RunEventBase {
  prompt: string;
}

export interface RunCompletedPayload extends RunEventBase {
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheCreationTokens?: number };
  stopReason?: string;
}

export interface RunFailedPayload extends RunEventBase {
  error: string;
}

export interface RunCanceledPayload extends RunEventBase {}

export interface RunDeltaPayload extends RunEventBase {
  delta: string;
}

export interface RunSkillsResolvedPayload extends RunEventBase {
  skillName: string;
  enabledToolNames: string[];
}

export interface RunSkillSelectedPayload extends RunEventBase {
  skillName: string;
  score: number;
  source: string;
  enabledToolNames: string[];
  diagnostics?: string[];
}

export interface RunSkillNudgedPayload extends RunEventBase {
  skillName: string;
  reason: string;
  toolCounts: Record<string, number>;
}

export interface RunToolRequestedPayload extends RunEventBase {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  requiresApproval: boolean;
}

export interface RunToolStartedPayload extends RunEventBase {
  toolCallId: string;
  toolName: string;
}

export interface RunToolProgressPayload extends RunEventBase {
  toolCallId: string;
  toolName: string;
}

export interface RunToolFinishedPayload extends RunEventBase {
  toolCallId: string;
  toolName: string;
  output: unknown;
}

export interface RunToolFailedPayload extends RunEventBase {
  toolCallId: string;
  toolName: string;
  error: string;
}

export interface RunBlockedPayload extends RunEventBase {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface RunToolDecidedPayload extends RunEventBase {
  toolCallId: string;
  toolName: string;
  decision: string;
}

export interface LogEntryPayload {
  timestamp: string;
  level: string;
  component: string;
  message: string;
  context?: Record<string, unknown>;
}

// ============================================================================
// SDK Passthrough Event
// ============================================================================

/**
 * Raw SDK messages are forwarded with dynamic type `sdk.<sdkType>`.
 * These bypass the typed enum — they are handled via prefix matching.
 */
export interface SdkEventPayload extends RunEventBase {
  message: Record<string, unknown>;
}

// ============================================================================
// Discriminated Union: RunnerEvent
// ============================================================================

export type RunnerEvent =
  | { type: "run.started"; payload: RunStartedPayload }
  | { type: "run.completed"; payload: RunCompletedPayload }
  | { type: "run.failed"; payload: RunFailedPayload }
  | { type: "run.canceled"; payload: RunCanceledPayload }
  | { type: "run.delta"; payload: RunDeltaPayload }
  | { type: "run.skills_resolved"; payload: RunSkillsResolvedPayload }
  | { type: "run.skill_selected"; payload: RunSkillSelectedPayload }
  | { type: "run.skill_nudged"; payload: RunSkillNudgedPayload }
  | { type: "run.tool_requested"; payload: RunToolRequestedPayload }
  | { type: "run.tool_started"; payload: RunToolStartedPayload }
  | { type: "run.tool_progress"; payload: RunToolProgressPayload }
  | { type: "run.tool_finished"; payload: RunToolFinishedPayload }
  | { type: "run.tool_failed"; payload: RunToolFailedPayload }
  | { type: "run.blocked"; payload: RunBlockedPayload }
  | { type: "run.tool_decided"; payload: RunToolDecidedPayload }
  | { type: "log.entry"; payload: LogEntryPayload };

/**
 * Envelope type that includes both typed events and SDK passthrough.
 * The `type` field is either a known `RunnerEventType` or an `sdk.*` string.
 */
export type RunnerEventEnvelope = RunnerEvent | { type: `sdk.${string}`; payload: SdkEventPayload };

// ============================================================================
// Type Guards
// ============================================================================

/** Check if event type is a known typed event (not SDK passthrough). */
export function isTypedEvent(event: RunnerEventEnvelope): event is RunnerEvent {
  return !event.type.startsWith("sdk.");
}

/** Check if event is an SDK passthrough event. */
export function isSdkEvent(
  event: RunnerEventEnvelope,
): event is { type: `sdk.${string}`; payload: SdkEventPayload } {
  return event.type.startsWith("sdk.");
}

/** Check if event is a run lifecycle terminal event. */
export function isTerminalEvent(
  event: RunnerEventEnvelope,
): event is
  | { type: "run.completed"; payload: RunCompletedPayload }
  | { type: "run.failed"; payload: RunFailedPayload }
  | { type: "run.canceled"; payload: RunCanceledPayload } {
  return event.type === "run.completed" || event.type === "run.failed" || event.type === "run.canceled";
}

/** Extract session ID from any run-scoped event. */
export function getEventSessionId(event: RunnerEventEnvelope): string | null {
  if ("sessionId" in event.payload) {
    return (event.payload as RunEventBase).sessionId;
  }
  return null;
}
