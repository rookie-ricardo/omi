/**
 * Permission Policy Engine - Denial Tracking
 *
 * Tracks consecutive denials per tool/session to prevent infinite retry loops.
 * When a tool is denied too many times, the evaluator escalates to a hard error
 * rather than repeatedly asking the user.
 */

import { nowIso } from "@omi/core";

import type { PermissionContext } from "./rules";

// ============================================================================
// Denial Record
// ============================================================================

export interface DenialRecord {
  /** Number of consecutive denials. */
  count: number;
  /** When the first denial occurred. */
  firstDenialAt: string;
  /** When the last denial occurred. */
  lastDenialAt: string;
  /** The denial reason from the last denial. */
  lastReason: string;
  /** Number of times the agent retried after denial. */
  retryCount: number;
}

// ============================================================================
// Denial Tracker
// ============================================================================

export interface DenialTracker {
  /**
   * Record a denial for the given context.
   */
  recordDenial(key: string, reason?: string): void;

  /**
   * Get the denial count for a specific key.
   */
  getDenialCount(key: string): number;

  /**
   * Get the full denial record for a key.
   */
  getDenialRecord(key: string): DenialRecord | null;

  /**
   * Record that the agent retried after a denial.
   * Increments the retry counter.
   */
  recordRetry(key: string): void;

  /**
   * Clear denial records for a key.
   * Called when the session ends or when the context changes significantly.
   */
  clear(key: string): void;

  /**
   * Clear all denial records.
   */
  clearAll(): void;

  /**
   * Get all denial records as an array.
   */
  getAllRecords(): Array<{ key: string; record: DenialRecord }>;

  /**
   * Check if a key has exceeded the retry threshold.
   */
  hasExceededThreshold(key: string, threshold: number): boolean;
}

interface InternalRecord {
  count: number;
  firstDenialAt: string;
  lastDenialAt: string;
  lastReason: string;
  retryCount: number;
}

/**
 * In-memory denial tracker.
 * Tracks consecutive denials per tool/session to prevent infinite loops.
 *
 * Default thresholds:
 * - maxDenials: 5 consecutive denials before escalation
 * - denialWindowMs: 60000ms (1 minute) - denials older than this are reset
 */
export class MemoryDenialTracker implements DenialTracker {
  private readonly records = new Map<string, InternalRecord>();
  private readonly maxDenials: number;
  private readonly denialWindowMs: number;

  constructor(maxDenials = 5, denialWindowMs = 60_000) {
    this.maxDenials = maxDenials;
    this.denialWindowMs = denialWindowMs;
  }

  recordDenial(key: string, reason = "unknown"): void {
    const now = nowIso();
    const existing = this.records.get(key);

    if (!existing) {
      this.records.set(key, {
        count: 1,
        firstDenialAt: now,
        lastDenialAt: now,
        lastReason: reason,
        retryCount: 0,
      });
      return;
    }

    // Reset if outside the denial window
    const timeSinceFirstDenial = Date.now() - new Date(existing.firstDenialAt).getTime();
    if (timeSinceFirstDenial > this.denialWindowMs) {
      this.records.set(key, {
        count: 1,
        firstDenialAt: now,
        lastDenialAt: now,
        lastReason: reason,
        retryCount: 0,
      });
      return;
    }

    existing.count += 1;
    existing.lastDenialAt = now;
    existing.lastReason = reason;
  }

  getDenialCount(key: string): number {
    const record = this.records.get(key);
    if (!record) return 0;

    // Check if we're outside the window
    const timeSinceFirstDenial = Date.now() - new Date(record.firstDenialAt).getTime();
    if (timeSinceFirstDenial > this.denialWindowMs) {
      return 0;
    }

    return record.count;
  }

  getDenialRecord(key: string): DenialRecord | null {
    const record = this.records.get(key);
    if (!record) return null;

    const timeSinceFirstDenial = Date.now() - new Date(record.firstDenialAt).getTime();
    if (timeSinceFirstDenial > this.denialWindowMs) {
      return null;
    }

    return { ...record };
  }

  recordRetry(key: string): void {
    const record = this.records.get(key);
    if (record) {
      record.retryCount += 1;
    }
  }

  clear(key: string): void {
    this.records.delete(key);
  }

  clearAll(): void {
    this.records.clear();
  }

  getAllRecords(): Array<{ key: string; record: DenialRecord }> {
    const now = Date.now();
    const result: Array<{ key: string; record: DenialRecord }> = [];

    for (const [key, record] of this.records.entries()) {
      const timeSinceFirstDenial = now - new Date(record.firstDenialAt).getTime();
      if (timeSinceFirstDenial <= this.denialWindowMs) {
        result.push({ key, record: { ...record } });
      } else {
        // Prune expired records
        this.records.delete(key);
      }
    }

    return result;
  }

  hasExceededThreshold(key: string, threshold: number): boolean {
    return this.getDenialCount(key) >= threshold;
  }
}

// ============================================================================
// Session-Aware Denial Tracker
// ============================================================================

/**
 * Creates denial keys that include session context.
 */
export function buildDenialKey(sessionId: string, toolName: string, suffix?: string): string {
  const base = `${sessionId}:${toolName}`;
  return suffix ? `${base}:${suffix}` : base;
}

/**
 * Extract session ID from a denial key.
 */
export function parseDenialKey(key: string): { sessionId: string; toolName: string; suffix?: string } {
  const parts = key.split(":");
  if (parts.length >= 2) {
    const suffix = parts.length > 2 ? parts.slice(2).join(":") : undefined;
    return { sessionId: parts[0], toolName: parts[1], suffix };
  }
  return { sessionId: "unknown", toolName: key };
}

/**
 * Creates denial keys from a PermissionContext.
 */
export function contextToDenialKey(context: PermissionContext): string {
  return buildDenialKey(context.sessionId, context.toolName);
}

// ============================================================================
// Default Instance
// ============================================================================

/**
 * Default global denial tracker instance.
 * Can be overridden per-session if needed.
 */
let defaultTracker: MemoryDenialTracker | null = null;

export function getDefaultDenialTracker(): MemoryDenialTracker {
  if (!defaultTracker) {
    defaultTracker = new MemoryDenialTracker();
  }
  return defaultTracker;
}

export function resetDefaultDenialTracker(): void {
  defaultTracker = null;
}
