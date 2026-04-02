import type { SessionHistoryEntry } from "@omi/core";

import { parseJson, sessionHistoryEntrySchema } from "@omi/core";

export interface SessionHistoryRow {
  id: string;
  sessionId: string;
  parentId: string | null;
  kind: string;
  messageId: string | null;
  summary: string | null;
  details: string | null;
  branchId: string | null;
  lineageDepth: number;
  originRunId: string | null;
  createdAt: string;
  updatedAt: string;
}

export function serializeSessionHistoryEntry(entry: SessionHistoryEntry): SessionHistoryRow {
  return {
    id: entry.id,
    sessionId: entry.sessionId,
    parentId: entry.parentId,
    kind: entry.kind,
    messageId: entry.messageId,
    summary: entry.summary,
    details: entry.details ? JSON.stringify(entry.details) : null,
    branchId: entry.branchId ?? null,
    lineageDepth: entry.lineageDepth ?? 0,
    originRunId: entry.originRunId ?? null,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

export function parseSessionHistoryEntry(row: SessionHistoryRow): SessionHistoryEntry {
  return sessionHistoryEntrySchema.parse({
    id: row.id,
    sessionId: row.sessionId,
    parentId: row.parentId,
    kind: row.kind,
    messageId: row.messageId,
    summary: row.summary,
    details: parseJson(row.details, null),
    branchId: row.branchId ?? null,
    lineageDepth: row.lineageDepth ?? 0,
    originRunId: row.originRunId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
