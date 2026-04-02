import { describe, expect, it } from "vitest";
import {
  classifyError,
  CheckpointManager,
  decideRecoveryAction,
  isWriteTool,
  shouldSkipToolCall,
  filterAlreadyExecutedWrites,
  createRetryLineage,
  createResumeLineage,
  type ErrorClass,
  type RecoveryDecisionParams,
  type ToolCallMeta,
} from "../src/recovery";

// ============================================================================
// classifyError tests
// ============================================================================

describe("classifyError", () => {
  it("classifies 401 errors as auth", () => {
    expect(classifyError(new Error("401 Unauthorized"))).toBe("auth");
  });

  it("classifies 403 errors as auth", () => {
    expect(classifyError(new Error("403 Forbidden"))).toBe("auth");
  });

  it("classifies 'invalid api key' as auth", () => {
    expect(classifyError(new Error("invalid api key"))).toBe("auth");
  });

  it("classifies 'authentication' as auth", () => {
    expect(classifyError(new Error("authentication failed"))).toBe("auth");
  });

  it("classifies context overflow as prompt_too_long", () => {
    expect(classifyError(new Error("context length exceeded"))).toBe("prompt_too_long");
    expect(classifyError(new Error("too many tokens: 99999 > 8192"))).toBe("prompt_too_long");
  });

  it("classifies max_output errors (without triggering isOverflowError)", () => {
    expect(classifyError(new Error("max_output tokens exceeded"))).toBe("max_output");
    expect(classifyError(new Error("max output tokens reached"))).toBe("max_output");
    expect(classifyError(new Error("max_tokens output reached"))).toBe("max_output");
  });

  it("classifies 'output token limit exceeded' as max_output (not prompt_too_long)", () => {
    // max_output check runs BEFORE isOverflowError to avoid misclassification.
    expect(classifyError(new Error("output token limit exceeded"))).toBe("max_output");
  });

  it("classifies 429 as rate_limit", () => {
    expect(classifyError(new Error("429 Too Many Requests"))).toBe("rate_limit");
    expect(classifyError(new Error("rate limit exceeded"))).toBe("rate_limit");
    expect(classifyError(new Error("ratelimit hit"))).toBe("rate_limit");
  });

  it("classifies network errors", () => {
    expect(classifyError(new Error("ECONNRESET"))).toBe("network");
    expect(classifyError(new Error("ETIMEDOUT"))).toBe("network");
    expect(classifyError(new Error("ECONNREFUSED"))).toBe("network");
    expect(classifyError(new Error("socket hang up"))).toBe("network");
    expect(classifyError(new Error("fetch failed"))).toBe("network");
    expect(classifyError(new Error("network error"))).toBe("network");
  });

  it("classifies 5xx errors as network", () => {
    expect(classifyError(new Error("500 Internal Server Error"))).toBe("network");
    expect(classifyError(new Error("502 Bad Gateway"))).toBe("network");
    expect(classifyError(new Error("503 Service Unavailable"))).toBe("network");
    expect(classifyError(new Error("504 Gateway Timeout"))).toBe("network");
  });

  it("classifies overloaded as network", () => {
    expect(classifyError(new Error("server overloaded"))).toBe("network");
  });

  it("classifies tool errors", () => {
    expect(classifyError(new Error("tool error"))).toBe("tool_error");
    expect(classifyError(new Error("tool execution failed"))).toBe("tool_error");
    expect(classifyError(new Error("tool failed"))).toBe("tool_error");
    expect(classifyError(new Error("tool timeout"))).toBe("tool_error");
  });

  it("classifies cancelled errors", () => {
    expect(classifyError(new Error("cancelled"))).toBe("cancelled");
    expect(classifyError(new Error("abort signal"))).toBe("cancelled");
  });

  it("returns unknown for unrecognized errors", () => {
    expect(classifyError(new Error("something went wrong"))).toBe("unknown");
    expect(classifyError(new Error("generic error"))).toBe("unknown");
  });

  it("returns unknown for null/undefined", () => {
    expect(classifyError(null)).toBe("unknown");
    expect(classifyError(undefined)).toBe("unknown");
  });

  it("returns unknown for non-Error objects", () => {
    expect(classifyError("string error")).toBe("unknown");
    expect(classifyError(42)).toBe("unknown");
  });

  it("auth has higher priority than prompt_too_long", () => {
    // "forbidden" appears in auth check before overflow check
    expect(classifyError(new Error("forbidden access"))).toBe("auth");
  });
});

// ============================================================================
// decideRecoveryAction tests
// ============================================================================

function makeDefaultParams(overrides?: Partial<RecoveryDecisionParams>): RecoveryDecisionParams {
  return {
    error: new Error("test"),
    errorClass: "unknown",
    recoveryCount: 0,
    maxRetryAttempts: 3,
    compactTracking: {
      maxOutputRecoveryCount: 0,
      overflowRecovered: false,
    },
    maxOutputRecoveryLimit: 3,
    baseDelayMs: 2000,
    maxDelayMs: 60000,
    ...overrides,
  };
}

describe("decideRecoveryAction", () => {
  describe("prompt_too_long", () => {
    it("returns overflow_compact on first occurrence", () => {
      const action = decideRecoveryAction(makeDefaultParams({
        errorClass: "prompt_too_long",
        compactTracking: {
          maxOutputRecoveryCount: 0,
          overflowRecovered: false,
        },
      }));
      expect(action.kind).toBe("overflow_compact");
    });

    it("returns fail on second occurrence (overflowRecovered = true)", () => {
      const action = decideRecoveryAction(makeDefaultParams({
        errorClass: "prompt_too_long",
        compactTracking: {
          maxOutputRecoveryCount: 0,
          overflowRecovered: true,
        },
      }));
      expect(action.kind).toBe("fail");
      if (action.kind === "fail") {
        expect(action.terminalReason).toBe("budget_exceeded");
      }
    });
  });

  describe("max_output", () => {
    it("returns max_output_recovery when under limit", () => {
      const action = decideRecoveryAction(makeDefaultParams({
        errorClass: "max_output",
        compactTracking: {
          maxOutputRecoveryCount: 0,
          overflowRecovered: false,
        },
        maxOutputRecoveryLimit: 3,
      }));
      expect(action.kind).toBe("max_output_recovery");
    });

    it("returns fail when at limit", () => {
      const action = decideRecoveryAction(makeDefaultParams({
        errorClass: "max_output",
        compactTracking: {
          maxOutputRecoveryCount: 3,
          overflowRecovered: false,
        },
        maxOutputRecoveryLimit: 3,
      }));
      expect(action.kind).toBe("fail");
      if (action.kind === "fail") {
        expect(action.terminalReason).toBe("error");
      }
    });

    it("returns max_output_recovery at count 2 (still under limit)", () => {
      const action = decideRecoveryAction(makeDefaultParams({
        errorClass: "max_output",
        compactTracking: {
          maxOutputRecoveryCount: 2,
          overflowRecovered: false,
        },
        maxOutputRecoveryLimit: 3,
      }));
      expect(action.kind).toBe("max_output_recovery");
    });
  });

  describe("rate_limit and network", () => {
    it("returns retry with exponential delay for rate_limit", () => {
      const action = decideRecoveryAction(makeDefaultParams({
        error: new Error("rate limit"),
        errorClass: "rate_limit",
        recoveryCount: 0,
        baseDelayMs: 2000,
        maxDelayMs: 60000,
      }));
      expect(action.kind).toBe("retry");
      if (action.kind === "retry") {
        expect(action.delayMs).toBe(2000); // 2000 * 2^0 = 2000
      }
    });

    it("returns retry with exponential delay for network", () => {
      const action = decideRecoveryAction(makeDefaultParams({
        error: new Error("network error"),
        errorClass: "network",
        recoveryCount: 1,
        baseDelayMs: 2000,
        maxDelayMs: 60000,
      }));
      expect(action.kind).toBe("retry");
      if (action.kind === "retry") {
        expect(action.delayMs).toBe(4000); // 2000 * 2^1 = 4000
      }
    });

    it("caps delay at maxDelayMs", () => {
      const action = decideRecoveryAction(makeDefaultParams({
        error: new Error("network error"),
        errorClass: "network",
        recoveryCount: 2,
        maxRetryAttempts: 5,
        baseDelayMs: 2000,
        maxDelayMs: 3000,
      }));
      expect(action.kind).toBe("retry");
      if (action.kind === "retry") {
        // 2000 * 2^2 = 8000, capped at 3000
        expect(action.delayMs).toBe(3000);
      }
    });

    it("returns fail when retries exhausted", () => {
      const action = decideRecoveryAction(makeDefaultParams({
        errorClass: "rate_limit",
        recoveryCount: 3,
        maxRetryAttempts: 3,
      }));
      expect(action.kind).toBe("fail");
      if (action.kind === "fail") {
        expect(action.terminalReason).toBe("error");
        expect(action.reason).toBe("retries_exhausted");
      }
    });
  });

  describe("cancelled", () => {
    it("returns fail with canceled terminal reason", () => {
      const action = decideRecoveryAction(makeDefaultParams({
        errorClass: "cancelled",
      }));
      expect(action.kind).toBe("fail");
      if (action.kind === "fail") {
        expect(action.terminalReason).toBe("canceled");
      }
    });
  });

  describe("auth", () => {
    it("returns fail (non-retryable)", () => {
      const action = decideRecoveryAction(makeDefaultParams({
        errorClass: "auth",
      }));
      expect(action.kind).toBe("fail");
      if (action.kind === "fail") {
        expect(action.terminalReason).toBe("error");
      }
    });
  });

  describe("tool_error", () => {
    it("returns fail (non-retryable)", () => {
      const action = decideRecoveryAction(makeDefaultParams({
        errorClass: "tool_error",
      }));
      expect(action.kind).toBe("fail");
    });
  });

  describe("unknown", () => {
    it("returns fail for non-retryable unknown errors", () => {
      const action = decideRecoveryAction(makeDefaultParams({
        errorClass: "unknown",
        error: new Error("something weird"),
        recoveryCount: 0,
        maxRetryAttempts: 3,
      }));
      // "something weird" is not retryable by isRetryableError
      expect(action.kind).toBe("fail");
    });
  });
});

// ============================================================================
// isWriteTool tests
// ============================================================================

describe("isWriteTool", () => {
  it("identifies write tools", () => {
    expect(isWriteTool("bash")).toBe(true);
    expect(isWriteTool("edit")).toBe(true);
    expect(isWriteTool("write")).toBe(true);
    expect(isWriteTool("notebook_edit")).toBe(true);
  });

  it("does not identify read tools as write", () => {
    expect(isWriteTool("read")).toBe(false);
    expect(isWriteTool("glob")).toBe(false);
    expect(isWriteTool("grep")).toBe(false);
    expect(isWriteTool("ls")).toBe(false);
  });

  it("does not identify unknown tools as write", () => {
    expect(isWriteTool("unknown_tool")).toBe(false);
    expect(isWriteTool("")).toBe(false);
  });
});

// ============================================================================
// Replay protection tests
// ============================================================================

describe("shouldSkipToolCall", () => {
  const executedIds = new Set(["tc-write-1", "tc-write-2"]);

  it("skips write tools that were already executed", () => {
    const tc: ToolCallMeta = { toolCallId: "tc-write-1", toolName: "bash", isWrite: true };
    expect(shouldSkipToolCall(tc, executedIds)).toBe(true);
  });

  it("does not skip write tools that were not executed", () => {
    const tc: ToolCallMeta = { toolCallId: "tc-write-3", toolName: "bash", isWrite: true };
    expect(shouldSkipToolCall(tc, executedIds)).toBe(false);
  });

  it("does not skip read tools even if in executed set", () => {
    const tc: ToolCallMeta = { toolCallId: "tc-write-1", toolName: "read", isWrite: false };
    expect(shouldSkipToolCall(tc, executedIds)).toBe(false);
  });

  it("does not skip read tools not in executed set", () => {
    const tc: ToolCallMeta = { toolCallId: "tc-read-1", toolName: "glob", isWrite: false };
    expect(shouldSkipToolCall(tc, executedIds)).toBe(false);
  });
});

describe("filterAlreadyExecutedWrites", () => {
  const executedIds = new Set(["tc-1"]);

  it("filters out executed write tools", () => {
    const toolCalls: ToolCallMeta[] = [
      { toolCallId: "tc-1", toolName: "bash", isWrite: true },
      { toolCallId: "tc-2", toolName: "read", isWrite: false },
      { toolCallId: "tc-3", toolName: "edit", isWrite: true },
    ];
    const result = filterAlreadyExecutedWrites(toolCalls, executedIds);
    expect(result.filtered).toHaveLength(2);
    expect(result.skippedCount).toBe(1);
    expect(result.filtered[0]?.toolCallId).toBe("tc-2");
    expect(result.filtered[1]?.toolCallId).toBe("tc-3");
  });

  it("returns all tools when none are executed writes", () => {
    const toolCalls: ToolCallMeta[] = [
      { toolCallId: "tc-1", toolName: "read", isWrite: false },
      { toolCallId: "tc-2", toolName: "bash", isWrite: true },
    ];
    const emptySet = new Set<string>();
    const result = filterAlreadyExecutedWrites(toolCalls, emptySet);
    expect(result.filtered).toHaveLength(2);
    expect(result.skippedCount).toBe(0);
  });

  it("handles empty tool call list", () => {
    const result = filterAlreadyExecutedWrites([], executedIds);
    expect(result.filtered).toHaveLength(0);
    expect(result.skippedCount).toBe(0);
  });
});

// ============================================================================
// Run lineage tests
// ============================================================================

describe("createRetryLineage", () => {
  it("creates lineage with originRunId set to the original run id", () => {
    const run = { id: "run-1", originRunId: null } as any;
    const lineage = createRetryLineage(run, "checkpoint-1");
    expect(lineage.runId).toBe("run-1");
    expect(lineage.originRunId).toBe("run-1");
    expect(lineage.recoveryMode).toBe("retry");
    expect(lineage.resumeFromCheckpoint).toBe("checkpoint-1");
  });

  it("accepts null checkpointId", () => {
    const run = { id: "run-1", originRunId: null } as any;
    const lineage = createRetryLineage(run, null);
    expect(lineage.resumeFromCheckpoint).toBeNull();
  });

  it("preserves the root originRunId across chained retries", () => {
    const run = { id: "run-2", originRunId: "run-1" } as any;
    const lineage = createRetryLineage(run, "checkpoint-2");
    expect(lineage.originRunId).toBe("run-1");
  });
});

describe("createResumeLineage", () => {
  it("creates lineage with originRunId from original run", () => {
    const run = { id: "run-2", originRunId: "run-1" } as any;
    const lineage = createResumeLineage(run, "checkpoint-2");
    expect(lineage.runId).toBe("run-2");
    expect(lineage.originRunId).toBe("run-1");
    expect(lineage.recoveryMode).toBe("resume");
    expect(lineage.resumeFromCheckpoint).toBe("checkpoint-2");
  });

  it("falls back to own id when originRunId is null", () => {
    const run = { id: "run-1", originRunId: null } as any;
    const lineage = createResumeLineage(run, null);
    expect(lineage.originRunId).toBe("run-1");
  });
});

describe("CheckpointManager", () => {
  it("chooses the latest checkpoint in the highest-priority phase", () => {
    const checkpoints = [
      {
        id: "cp-1",
        runId: "run-1",
        sessionId: "session-1",
        phase: "before_model_call",
        payload: {},
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "cp-2",
        runId: "run-1",
        sessionId: "session-1",
        phase: "after_model_stream",
        payload: {},
        createdAt: "2026-01-01T00:00:01.000Z",
      },
      {
        id: "cp-3",
        runId: "run-1",
        sessionId: "session-1",
        phase: "after_model_stream",
        payload: {},
        createdAt: "2026-01-01T00:00:02.000Z",
      },
    ] as any[];

    const store = {
      createCheckpoint: (input: any) => input,
      getLatestCheckpoint: () => checkpoints.at(-1) ?? null,
      listCheckpoints: () => checkpoints,
    } as any;

    const manager = new (class extends CheckpointManager {
      constructor() {
        super(store, "run-1", "session-1");
      }
    })();

    expect(manager.findResumeCheckpoint()?.id).toBe("cp-3");
  });
});
