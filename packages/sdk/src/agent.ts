/**
 * @omi/sdk — Agent
 *
 * High-level Agent class and createAgent() factory.
 * Wraps the full OMI stack (AppOrchestrator, AgentSession, QueryEngine)
 * behind a simple streaming API.
 *
 * Usage:
 *   import { createAgent } from '@omi/sdk'
 *
 *   const agent = createAgent({
 *     model: 'claude-sonnet-4-6',
 *     apiKey: process.env.API_KEY,
 *   })
 *
 *   // Streaming
 *   for await (const event of agent.query('Analyze this codebase')) {
 *     if (event.type === 'assistant') console.log(event)
 *   }
 *
 *   // Simple
 *   const result = await agent.prompt('What does this code do?')
 *   console.log(result.text)
 */

import { createId, nowIso } from "@omi/core";
import type { ProviderConfig, Run, Session, Task } from "@omi/core";
import { createAppDatabase, type AppStore } from "@omi/store";
import {
	AppOrchestrator,
	type RunnerEventEnvelope,
} from "@omi/agent";

import type {
	AgentOptions,
	CanUseToolFn,
	ContentBlock,
	AssistantMessage,
	Message,
	QueryResult,
	SDKAssistantMessage,
	SDKMessage,
	SDKResultMessage,
	SDKToolResultMessage,
	TokenUsage,
	UserMessage,
} from "./types.js";

// ============================================================================
// Agent class
// ============================================================================

export class Agent {
	private readonly options: AgentOptions;
	private readonly database: AppStore;
	private readonly orchestrator: AppOrchestrator;
	private readonly workspaceRoot: string;
	private sessionId: string | null = null;
	private eventBuffer: SDKMessage[] = [];
	private eventResolvers: Array<(value: IteratorResult<SDKMessage>) => void> = [];
	private runDone = false;
	private messageLog: Message[] = [];
	private startTime = 0;
	private turnCount = 0;

	constructor(options: AgentOptions = {}) {
		this.options = { ...options };
		this.workspaceRoot = options.cwd || process.cwd();

		// Resolve credentials from options.env or process.env
		this.resolveEnvOptions();

		// Initialize in-memory SQLite store for lightweight SDK usage
		this.database = createAppDatabase(":memory:");

		// Seed the provider configuration
		const providerConfig = this.seedProviderConfig();

		// Create orchestrator wired to our event bridge
		this.orchestrator = new AppOrchestrator(
			this.database,
			this.workspaceRoot,
			(event) => this.handleOrchestratorEvent(event),
		);
	}

	// ==========================================================================
	// Public API
	// ==========================================================================

	/**
	 * Run a query with streaming events.
	 *
	 * @example
	 * ```typescript
	 * for await (const event of agent.query('Fix the auth bug')) {
	 *   if (event.type === 'assistant') {
	 *     for (const block of event.message.content) {
	 *       if (block.type === 'text') process.stdout.write(block.text ?? '')
	 *     }
	 *   }
	 * }
	 * ```
	 */
	async *query(
		prompt: string,
		overrides?: Partial<AgentOptions>,
	): AsyncGenerator<SDKMessage, void> {
		this.startTime = Date.now();
		this.runDone = false;
		this.eventBuffer = [];
		this.eventResolvers = [];
		this.turnCount = 0;

		const opts = { ...this.options, ...overrides };

		// Ensure session exists
		const session = this.ensureSession();
		this.sessionId = session.id;

		// Emit init
		yield {
			type: "system",
			subtype: "init",
			sessionId: session.id,
			tools: [], // Will be populated from the orchestrator
			model: opts.model ?? "claude-sonnet-4-6",
			cwd: this.workspaceRoot,
			permissionMode: opts.permissionMode ?? "bypassPermissions",
		} satisfies SDKMessage;

		// Track user message
		const userUuid = createId("msg");
		this.messageLog.push({
			type: "user",
			message: { role: "user", content: prompt },
			uuid: userUuid,
			timestamp: nowIso(),
		});

		// Start the run via orchestrator
		try {
			const run = this.orchestrator.startRun({
				sessionId: session.id,
				taskId: null,
				prompt,
			});

			// Yield events as they come from the orchestrator
			while (!this.runDone) {
				const event = await this.nextEvent();
				if (event === null) break;
				yield event;
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			yield {
				type: "result",
				subtype: "error_during_execution",
				isError: true,
				numTurns: this.turnCount,
				durationMs: Date.now() - this.startTime,
				errors: [errorMessage],
			} satisfies SDKResultMessage;
		}
	}

	/**
	 * Run a query and wait for the final text result.
	 * Convenience wrapper over query().
	 *
	 * @example
	 * ```typescript
	 * const result = await agent.prompt('What does this code do?')
	 * console.log(result.text)
	 * ```
	 */
	async prompt(
		text: string,
		overrides?: Partial<AgentOptions>,
	): Promise<QueryResult> {
		const t0 = Date.now();
		let resultText = "";
		let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
		let numTurns = 0;
		let totalCostUsd = 0;

		for await (const event of this.query(text, overrides)) {
			switch (event.type) {
				case "assistant": {
					const fragments = event.message.content
						.filter((c) => c.type === "text")
						.map((c) => c.text ?? "");
					if (fragments.length) {
						resultText = fragments.join("");
					}
					break;
				}
				case "result": {
					const result = event as SDKResultMessage;
					numTurns = result.numTurns ?? 0;
					totalCostUsd = result.totalCostUsd ?? 0;
					if (result.usage) {
						usage = result.usage;
					}
					break;
				}
			}
		}

		return {
			text: resultText,
			usage,
			numTurns,
			durationMs: Date.now() - t0,
			sessionId: this.sessionId ?? "",
			messages: [...this.messageLog],
			totalCostUsd,
		};
	}

	/**
	 * Get conversation messages.
	 */
	getMessages(): Message[] {
		return [...this.messageLog];
	}

	/**
	 * Get the session ID (for resumption).
	 */
	getSessionId(): string | null {
		return this.sessionId;
	}

	/**
	 * Reset conversation history (new session).
	 */
	clear(): void {
		this.messageLog = [];
		this.sessionId = null;
	}

	/**
	 * Interrupt the current query.
	 */
	abort(): void {
		if (this.sessionId) {
			const sessions = this.database.listSessions();
			for (const session of sessions) {
				if (session.id === this.sessionId) {
					// Cancel any active runs
					const runs = this.database.listRuns(session.id);
					for (const run of runs) {
						if (run.status === "running" || run.status === "queued") {
							this.orchestrator.cancelRun(run.id);
						}
					}
				}
			}
		}
		this.runDone = true;
		this.resolveAllPending();
	}

	/**
	 * Dispose the agent and clean up resources (close DB, etc.).
	 */
	dispose(): void {
		this.abort();
	}

	// ==========================================================================
	// Internal: Event Bridge
	// ==========================================================================

	private handleOrchestratorEvent(event: RunnerEventEnvelope): void {
		const sdkMessage = this.mapToSDKMessage(event);
		if (!sdkMessage) return;

		if (this.eventResolvers.length > 0) {
			const resolver = this.eventResolvers.shift()!;
			resolver({ value: sdkMessage, done: false });
		} else {
			this.eventBuffer.push(sdkMessage);
		}
	}

	private nextEvent(): Promise<SDKMessage | null> {
		// Return buffered event if available
		if (this.eventBuffer.length > 0) {
			return Promise.resolve(this.eventBuffer.shift()!);
		}

		if (this.runDone) {
			return Promise.resolve(null);
		}

		// Wait for next event
		return new Promise<SDKMessage | null>((resolve) => {
			// Set a timeout to detect when the run is done
			const checkInterval = setInterval(() => {
				if (this.runDone) {
					clearInterval(checkInterval);
					resolve(null);
				}
			}, 100);

			this.eventResolvers.push((result) => {
				clearInterval(checkInterval);
				resolve(result.value as SDKMessage);
			});
		});
	}

	private resolveAllPending(): void {
		for (const resolver of this.eventResolvers) {
			resolver({ value: undefined as unknown as SDKMessage, done: true });
		}
		this.eventResolvers = [];
	}

	private mapToSDKMessage(event: RunnerEventEnvelope): SDKMessage | null {
		const payload = event.payload;

		switch (event.type) {
			case "run.delta": {
				if (this.options.includePartialMessages) {
					return {
						type: "partial_message",
						partial: {
							type: "text",
							text: (payload.delta as string) ?? "",
						},
					};
				}
				return null;
			}

			case "run.tool_finished": {
				this.turnCount++;
				return {
					type: "tool_result",
					result: {
						toolUseId: (payload.toolCallId as string) ?? "",
						toolName: (payload.toolName as string) ?? "",
						output: typeof payload.output === "string"
							? payload.output
							: JSON.stringify(payload.output),
						isError: false,
					},
				};
			}

			case "run.tool_denied": {
				return {
					type: "tool_result",
					result: {
						toolUseId: "",
						toolName: (payload.toolName as string) ?? "",
						output: (payload.reason as string) ?? "Denied",
						isError: true,
					},
				};
			}

			case "query_loop.terminal": {
				this.runDone = true;

				const terminalReason = (payload.reason as string) ?? "completed";
				const isError = terminalReason !== "completed";

				const resultMessage: SDKResultMessage = {
					type: "result",
					subtype: isError ? `error_${terminalReason}` : "success",
					sessionId: this.sessionId ?? undefined,
					isError,
					numTurns: (payload.turnCount as number) ?? this.turnCount,
					durationMs: Date.now() - this.startTime,
					errors: payload.error ? [payload.error as string] : undefined,
				};

				// Resolve any pending event waiters
				setTimeout(() => this.resolveAllPending(), 0);

				return resultMessage;
			}

			case "run.canceled": {
				this.runDone = true;
				setTimeout(() => this.resolveAllPending(), 0);
				return {
					type: "result",
					subtype: "error_during_execution",
					isError: true,
					numTurns: this.turnCount,
					durationMs: Date.now() - this.startTime,
					errors: ["Run was canceled"],
				};
			}

			case "run.failed": {
				this.runDone = true;
				setTimeout(() => this.resolveAllPending(), 0);
				return {
					type: "result",
					subtype: "error_during_execution",
					isError: true,
					numTurns: this.turnCount,
					durationMs: Date.now() - this.startTime,
					errors: [(payload.error as string) ?? "Unknown error"],
				};
			}

			default:
				return null;
		}
	}

	// ==========================================================================
	// Internal: Setup
	// ==========================================================================

	private resolveEnvOptions(): void {
		const env = this.options.env;

		if (!this.options.apiKey) {
			this.options.apiKey =
				env?.OMI_API_KEY ??
				env?.ANTHROPIC_API_KEY ??
				process.env.OMI_API_KEY ??
				process.env.ANTHROPIC_API_KEY;
		}
		if (!this.options.baseURL) {
			this.options.baseURL =
				env?.OMI_BASE_URL ??
				env?.ANTHROPIC_BASE_URL ??
				process.env.OMI_BASE_URL ??
				process.env.ANTHROPIC_BASE_URL;
		}
		if (!this.options.model) {
			this.options.model =
				env?.OMI_MODEL ??
				env?.ANTHROPIC_MODEL ??
				process.env.OMI_MODEL ??
				process.env.ANTHROPIC_MODEL;
		}
	}

	private seedProviderConfig(): ProviderConfig {
		return this.database.upsertProviderConfig({
			name: "default",
			type: "anthropic",
			baseUrl: this.options.baseURL ?? "https://api.anthropic.com",
			model: this.options.model ?? "claude-sonnet-4-6",
			apiKey: this.options.apiKey ?? "",
		});
	}

	private ensureSession(): Session {
		if (this.sessionId) {
			const existing = this.database.getSession(this.sessionId);
			if (existing) return existing;
		}

		return this.orchestrator.createSession("sdk-session");
	}
}

// ============================================================================
// Factory function
// ============================================================================

/**
 * Create a new Agent instance.
 *
 * @example
 * ```typescript
 * const agent = createAgent({
 *   model: 'claude-sonnet-4-6',
 *   apiKey: process.env.API_KEY,
 *   cwd: '/path/to/project',
 * })
 *
 * const result = await agent.prompt('Explain the codebase')
 * console.log(result.text)
 * ```
 */
export function createAgent(options: AgentOptions = {}): Agent {
	return new Agent(options);
}

// ============================================================================
// Top-level query() — one-shot convenience wrapper
// ============================================================================

/**
 * Execute a single agentic query without managing an Agent instance.
 * The agent is created, used, and disposed automatically.
 *
 * @example
 * ```typescript
 * import { query } from '@omi/sdk'
 *
 * for await (const event of query({
 *   prompt: 'Find and fix the bug in auth.py',
 *   options: { allowedTools: ['Read', 'Edit', 'Bash'] }
 * })) {
 *   if (event.type === 'assistant') {
 *     for (const block of event.message.content) {
 *       if (block.type === 'text') console.log(block.text)
 *     }
 *   }
 * }
 * ```
 */
export async function* query(params: {
	prompt: string;
	options?: AgentOptions;
}): AsyncGenerator<SDKMessage, void> {
	const agent = new Agent(params.options);
	try {
		yield* agent.query(params.prompt);
	} finally {
		agent.dispose();
	}
}
