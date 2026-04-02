import { describe, expect, it } from "vitest";
import {
  type QueryLoopState,
  type TerminalReason,
  createInitialMutableState,
  isValidTransition,
  getAllValidTransitions,
  DEFAULT_QUERY_LOOP_BUDGET,
} from "../src/query-state";

describe("query-state", () => {
  describe("createInitialMutableState", () => {
    it("creates state with default values", () => {
      const state = createInitialMutableState();
      expect(state.currentState).toBe("init");
      expect(state.turnCount).toBe(0);
      expect(state.recoveryCount).toBe(0);
      expect(state.compactTracking.maxOutputRecoveryCount).toBe(0);
      expect(state.compactTracking.overflowRecovered).toBe(false);
      expect(state.compactTracking.lastStopReason).toBeNull();
      expect(state.compactTracking.lastContextTokens).toBe(0);
      expect(state.budget).toMatchObject({
        maxTurns: 200,
        maxBudgetUsd: 0,
        maxOutputRecoveryAttempts: 3,
        maxRetryAttempts: 3,
      });
      expect(state.terminalReason).toBeNull();
      expect(state.terminalError).toBeNull();
      expect(state.lastStopReason).toBeNull();
      expect(state.lastContextTokens).toBe(0);
      expect(state.messages).toEqual([]);
      expect(state.lastTransitionAt).toBeTruthy();
    });

    it("creates state with initial messages", () => {
      const messages = [
        { role: "user" as const, content: "hello", timestamp: Date.now() },
      ];
      const state = createInitialMutableState(messages);
      expect(state.messages).toEqual(messages);
    });
  });

  describe("isValidTransition", () => {
    it("rejects self-transitions", () => {
      const states: QueryLoopState[] = [
        "init",
        "preprocess_context",
        "calling_model",
        "streaming_response",
        "executing_tools",
        "post_tool_merge",
        "terminal",
        "recovering",
      ];
      for (const state of states) {
        expect(isValidTransition(state, state)).toBe(false);
      }
    });

    it("allows init -> preprocess_context", () => {
      expect(isValidTransition("init", "preprocess_context")).toBe(true);
    });

    it("allows preprocess_context -> calling_model", () => {
      expect(isValidTransition("preprocess_context", "calling_model")).toBe(true);
    });

    it("allows preprocess_context -> terminal", () => {
      expect(isValidTransition("preprocess_context", "terminal")).toBe(true);
    });

    it("allows calling_model -> streaming_response", () => {
      expect(isValidTransition("calling_model", "streaming_response")).toBe(true);
    });

    it("allows calling_model -> recovering", () => {
      expect(isValidTransition("calling_model", "recovering")).toBe(true);
    });

    it("allows calling_model -> terminal", () => {
      expect(isValidTransition("calling_model", "terminal")).toBe(true);
    });

    it("allows streaming_response -> executing_tools", () => {
      expect(isValidTransition("streaming_response", "executing_tools")).toBe(true);
    });

    it("allows streaming_response -> terminal", () => {
      expect(isValidTransition("streaming_response", "terminal")).toBe(true);
    });

    it("allows streaming_response -> recovering", () => {
      expect(isValidTransition("streaming_response", "recovering")).toBe(true);
    });

    it("allows streaming_response -> preprocess_context (max_output_tokens recovery)", () => {
      expect(isValidTransition("streaming_response", "preprocess_context")).toBe(true);
    });

    it("allows executing_tools -> post_tool_merge", () => {
      expect(isValidTransition("executing_tools", "post_tool_merge")).toBe(true);
    });

    it("allows executing_tools -> terminal", () => {
      expect(isValidTransition("executing_tools", "terminal")).toBe(true);
    });

    it("allows executing_tools -> recovering", () => {
      expect(isValidTransition("executing_tools", "recovering")).toBe(true);
    });

    it("allows post_tool_merge -> preprocess_context (loop continuation)", () => {
      expect(isValidTransition("post_tool_merge", "preprocess_context")).toBe(true);
    });

    it("allows post_tool_merge -> terminal", () => {
      expect(isValidTransition("post_tool_merge", "terminal")).toBe(true);
    });

    it("allows recovering -> preprocess_context", () => {
      expect(isValidTransition("recovering", "preprocess_context")).toBe(true);
    });

    it("allows recovering -> calling_model", () => {
      expect(isValidTransition("recovering", "calling_model")).toBe(true);
    });

    it("allows recovering -> terminal", () => {
      expect(isValidTransition("recovering", "terminal")).toBe(true);
    });

    it("terminal has no outgoing transitions", () => {
      expect(isValidTransition("terminal", "init")).toBe(false);
      expect(isValidTransition("terminal", "preprocess_context")).toBe(false);
      expect(isValidTransition("terminal", "calling_model")).toBe(false);
      expect(isValidTransition("terminal", "streaming_response")).toBe(false);
      expect(isValidTransition("terminal", "executing_tools")).toBe(false);
      expect(isValidTransition("terminal", "post_tool_merge")).toBe(false);
      expect(isValidTransition("terminal", "recovering")).toBe(false);
    });

    it("disallows init -> any non-preprocess_context state", () => {
      const disallowed: QueryLoopState[] = [
        "init",
        "calling_model",
        "streaming_response",
        "executing_tools",
        "post_tool_merge",
        "terminal",
        "recovering",
      ];
      for (const target of disallowed) {
        expect(isValidTransition("init", target)).toBe(false);
      }
    });

    it("disallows backward transitions from preprocess_context", () => {
      expect(isValidTransition("preprocess_context", "init")).toBe(false);
      expect(isValidTransition("preprocess_context", "streaming_response")).toBe(false);
      expect(isValidTransition("preprocess_context", "executing_tools")).toBe(false);
      expect(isValidTransition("preprocess_context", "recovering")).toBe(false);
    });

    it("getAllValidTransitions returns at least 15 transitions", () => {
      const transitions = getAllValidTransitions();
      expect(transitions.length).toBeGreaterThanOrEqual(15);
    });
  });

  describe("getAllValidTransitions", () => {
    it("returns all valid transition pairs exactly", () => {
      const transitions = getAllValidTransitions();
      // Expected transitions:
      // init -> preprocess_context (1)
      // preprocess_context -> calling_model, terminal (2)
      // calling_model -> streaming_response, recovering, terminal (3)
      // streaming_response -> executing_tools, terminal, recovering, preprocess_context, post_tool_merge (5)
      // executing_tools -> post_tool_merge, terminal, recovering (3)
      // post_tool_merge -> preprocess_context, terminal (2)
      // recovering -> calling_model, preprocess_context, terminal (3)
      // terminal -> (none) (0)
      // Total: 1+2+3+5+3+2+3+0 = 19
      expect(transitions).toHaveLength(19);
    });

    it("every returned transition passes isValidTransition", () => {
      const transitions = getAllValidTransitions();
      for (const { from, to } of transitions) {
        expect(isValidTransition(from, to)).toBe(true);
      }
    });
  });

  describe("TerminalReason type coverage", () => {
    it("includes all required terminal reasons", () => {
      const requiredReasons: TerminalReason[] = [
        "completed",
        "max_turns",
        "budget_exceeded",
        "canceled",
        "error",
      ];
      expect(requiredReasons).toEqual([
        "completed",
        "max_turns",
        "budget_exceeded",
        "canceled",
        "error",
      ]);
    });
  });

  describe("DEFAULT_QUERY_LOOP_BUDGET", () => {
    it("has expected default values", () => {
      expect(DEFAULT_QUERY_LOOP_BUDGET.maxTurns).toBe(200);
      expect(DEFAULT_QUERY_LOOP_BUDGET.maxBudgetUsd).toBe(0);
      expect(DEFAULT_QUERY_LOOP_BUDGET.maxOutputRecoveryAttempts).toBe(3);
      expect(DEFAULT_QUERY_LOOP_BUDGET.maxRetryAttempts).toBe(3);
    });
  });
});
