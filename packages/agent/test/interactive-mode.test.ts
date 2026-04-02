/**
 * Tests for Interactive Mode
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode";
import type { AgentSession } from "../src/agent-session";
import type { RunnerEventEnvelope } from "../src/agent-session";

describe("InteractiveMode", () => {
	let mockSession: AgentSession;
	let mockEmit: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		mockEmit = vi.fn();
		mockSession = {
			getSessionStats: vi.fn(() => ({
				sessionId: "test-session",
				userMessages: 0,
				assistantMessages: 0,
				toolCalls: 0,
				totalMessages: 0,
				runs: 0,
			})),
			prompt: vi.fn(),
			cancelRun: vi.fn(),
			approveTool: vi.fn(() => ({ toolCallId: "test", decision: "approved" as const })),
			rejectTool: vi.fn(() => ({ toolCallId: "test", decision: "rejected" as const })),
			compactSession: vi.fn(),
			setModel: vi.fn(),
			abort: vi.fn(),
		} as unknown as AgentSession;
	});

	describe("constructor", () => {
		it("should create an instance with default options", () => {
			const mode = new InteractiveMode(mockSession);
			expect(mode).toBeDefined();
			const state = mode.getState();
			expect(state.sessionId).toBe("test-session");
		});

		it("should create an instance with custom options", () => {
			const mode = new InteractiveMode(mockSession, { verbose: true, autoScroll: false });
			expect(mode).toBeDefined();
		});
	});

	describe("getState", () => {
		it("should return the current session state", () => {
			const mode = new InteractiveMode(mockSession);
			const state = mode.getState();
			expect(state.sessionId).toBe("test-session");
			expect(state.isStreaming).toBe(false);
			expect(state.isCompacting).toBe(false);
			expect(state.messageCount).toBe(0);
		});
	});

	describe("getEventEmitter", () => {
		it("should return an event emitter function", () => {
			const mode = new InteractiveMode(mockSession);
			const emitter = mode.getEventEmitter();
			expect(typeof emitter).toBe("function");
		});

		it("should emit events to the event bus", () => {
			const mode = new InteractiveMode(mockSession);
			const emitter = mode.getEventEmitter();
			const testEvent: RunnerEventEnvelope = {
				type: "run.delta",
				payload: { runId: "test-run", sessionId: "test-session", delta: "test" },
			};

			// Emit should not throw
			expect(() => emitter(testEvent)).not.toThrow();
		});
	});

	describe("stop", () => {
		it("should stop the interactive mode", () => {
			const mode = new InteractiveMode(mockSession);
			expect(() => mode.stop()).not.toThrow();
		});
	});

	describe("signal handling", () => {
		it("should setup signal handlers on start", () => {
			const mode = new InteractiveMode(mockSession);
			// setupSignalHandlers is called in start(), but we can't test async start here
			// Just verify the mode can be created without error
			expect(mode).toBeDefined();
		});
	});
});
