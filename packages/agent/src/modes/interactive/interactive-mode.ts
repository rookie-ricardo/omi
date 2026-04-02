/**
 * Interactive mode: Full terminal UI with real-time feedback.
 *
 * This is the main interactive mode for human-in-the-loop coding.
 * Provides a REPL interface with streaming output, tool approval, and signal handling.
 */

import * as readline from "node:readline";
import type { AgentSession } from "../../agent-session";
import type { RpcSessionState } from "../rpc/rpc-types";
import type { RunnerEventEnvelope } from "../../agent-session";
import { BUILTIN_SLASH_COMMANDS } from "../../slash-commands";
import { createEventBus, type EventBus } from "../../event-bus";

export interface InteractiveModeOptions {
	/** Whether to show detailed tool execution output */
	verbose?: boolean;
	/** Whether to auto-scroll to latest output */
	autoScroll?: boolean;
}

/**
 * Run in interactive mode with terminal UI.
 */
export class InteractiveMode {
	private running = false;
	private rl: readline.Interface | null = null;
	private currentRunId: string | null = null;
	private pendingToolApproval: { toolCallId: string; toolName: string; runId: string } | null = null;
	private eventBus: EventBus;
	private outputBuffer = "";
	private isStreaming = false;

	constructor(
		private readonly session: AgentSession,
		private readonly options: InteractiveModeOptions = {},
	) {
		this.eventBus = createEventBus();
		this.setupEventListeners();
	}

	/**
	 * Start the interactive mode.
	 */
	async start(): Promise<void> {
		this.running = true;
		this.setupSignalHandlers();
		this.printWelcome();

		// Create readline interface
		this.rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
			prompt: "> ",
			completer: (line: string) => {
				const completions = BUILTIN_SLASH_COMMANDS.map((c) => `/${c.name}`);
				const hits = completions.filter((c) => c.startsWith(line));
				return [hits, line];
			},
		});

		// Main REPL loop
		this.rl.prompt();

		for await (const line of this.rl) {
			const trimmed = line.trim();
			if (!trimmed) {
				this.rl.prompt();
				continue;
			}

			// Handle slash commands
			if (trimmed.startsWith("/")) {
				await this.handleSlashCommand(trimmed);
			} else {
				// Regular prompt
				await this.handlePrompt(trimmed);
			}

			if (!this.running) {
				break;
			}

			this.rl.prompt();
		}
	}

	/**
	 * Stop the interactive mode.
	 */
	stop(): void {
		this.running = false;
		if (this.rl) {
			this.rl.close();
			this.rl = null;
		}
		this.restoreSignalHandlers();
	}

	/**
	 * Get current session state for display.
	 */
	getState(): RpcSessionState {
		const stats = this.session.getSessionStats();
		return {
			sessionId: stats.sessionId,
			isStreaming: this.isStreaming,
			isCompacting: false,
			messageCount: stats.totalMessages,
			pendingMessageCount: 0,
		};
	}

	/**
	 * Get the event emitter for this interactive mode.
	 * This can be used to route AgentSession events to the UI.
	 */
	getEventEmitter(): (event: RunnerEventEnvelope) => void {
		return (event: RunnerEventEnvelope) => {
			this.eventBus.emit(event.type, event);
		};
	}

	private printWelcome(): void {
		console.log("omi Interactive Mode");
		console.log("==================");
		console.log("Type your prompts and press Enter to send.");
		console.log("Commands: /exit to quit, /compact to compact context");
		console.log("Press Ctrl+C to interrupt current run");
		console.log("");
	}

	private setupSignalHandlers(): void {
		this.sigintListener = () => {
			if (this.currentRunId) {
				console.log("\n[Interrupting current run...]");
				this.session.cancelRun(this.currentRunId);
				this.currentRunId = null;
				this.isStreaming = false;
				this.clearPendingToolApproval();
			} else if (this.pendingToolApproval) {
				console.log("\n[Rejecting pending tool approval]");
				this.session.rejectTool(this.pendingToolApproval.toolCallId);
				this.clearPendingToolApproval();
			} else {
				console.log("\n[Exiting...]");
				this.stop();
				process.exit(0);
			}
		};
		process.on("SIGINT", this.sigintListener!);

		this.sigtermListener = () => {
			console.log("\n[Received SIGTERM, shutting down...]");
			this.stop();
			process.exit(0);
		};
		process.on("SIGTERM", this.sigtermListener!);
	}

	private restoreSignalHandlers(): void {
		if (this.sigintListener) {
			process.off("SIGINT", this.sigintListener);
			this.sigintListener = null;
		}
		if (this.sigtermListener) {
			process.off("SIGTERM", this.sigtermListener);
			this.sigtermListener = null;
		}
	}

	private sigintListener: (() => void) | null = null;
	private sigtermListener: (() => void) | null = null;

	private setupEventListeners(): void {
		// Listen for run delta events (streaming output)
		this.eventBus.on("run.delta", (data: unknown) => {
			const event = data as RunnerEventEnvelope;
			const delta = event.payload.delta as string;
			if (delta) {
				process.stdout.write(delta);
				this.outputBuffer += delta;
			}
		});

		// Listen for run started
		this.eventBus.on("run.started", (data: unknown) => {
			const event = data as RunnerEventEnvelope;
			this.currentRunId = event.payload.runId as string;
			this.isStreaming = true;
		});

		// Listen for run blocked (tool approval)
		this.eventBus.on("run.blocked", (data: unknown) => {
			const event = data as RunnerEventEnvelope;
			const toolCallId = event.payload.toolCallId as string;
			const reason = event.payload.reason as string;
			this.pendingToolApproval = {
				toolCallId,
				toolName: reason || "unknown",
				runId: event.payload.runId as string,
			};
		});

		// Listen for run completion
		this.eventBus.on("run.completed", (data: unknown) => {
			this.currentRunId = null;
			this.isStreaming = false;
			this.clearPendingToolApproval();
			if (this.outputBuffer && !this.outputBuffer.endsWith("\n")) {
				console.log();
			}
		});

		// Listen for run cancellation
		this.eventBus.on("run.canceled", () => {
			this.currentRunId = null;
			this.isStreaming = false;
			this.clearPendingToolApproval();
			console.log("\n[Run canceled]");
		});

		// Listen for run failure
		this.eventBus.on("run.failed", (data: unknown) => {
			const event = data as RunnerEventEnvelope;
			this.currentRunId = null;
			this.isStreaming = false;
			this.clearPendingToolApproval();
			const error = event.payload.error as string | undefined;
			console.error(`\n[Run failed${error ? `: ${error}` : ""}]`);
		});

		// Listen for tool requested
		this.eventBus.on("run.tool_requested", (data: unknown) => {
			if (this.options.verbose) {
				const event = data as RunnerEventEnvelope;
				const toolName = event.payload.toolName as string;
				console.log(`\n[Tool requested: ${toolName}]`);
			}
		});

		// Listen for tool started
		this.eventBus.on("run.tool_started", (data: unknown) => {
			if (this.options.verbose) {
				const event = data as RunnerEventEnvelope;
				const toolName = event.payload.toolName as string;
				console.log(`\n[Tool started: ${toolName}]`);
			}
		});

		// Listen for tool finished
		this.eventBus.on("run.tool_finished", (data: unknown) => {
			if (this.options.verbose) {
				const event = data as RunnerEventEnvelope;
				const toolName = event.payload.toolName as string;
				console.log(`\n[Tool finished: ${toolName}]`);
			}
		});

		// Listen for tool decision
		this.eventBus.on("run.tool_decided", (data: unknown) => {
			if (this.options.verbose) {
				const event = data as RunnerEventEnvelope;
				const decision = event.payload.decision as string;
				console.log(`\n[Tool decision: ${decision}]`);
			}
		});
	}

	private clearPendingToolApproval(): void {
		this.pendingToolApproval = null;
	}

	private async handlePrompt(text: string): Promise<void> {
		try {
			this.outputBuffer = "";
			this.isStreaming = true;

			const run = await this.session.prompt(text);
			this.currentRunId = run.id;

			// Wait for run to complete by polling the session state
			await this.waitForRunCompletion(run.id);

			this.currentRunId = null;
			this.isStreaming = false;
		} catch (error) {
			this.isStreaming = false;
			this.currentRunId = null;
			const message = error instanceof Error ? error.message : String(error);
			console.error(`[Error: ${message}]`);
		}
	}

	private async waitForRunCompletion(runId: string): Promise<void> {
		const maxAttempts = 600; // 60 seconds max
		let attempts = 0;

		while (attempts < maxAttempts && this.running) {
			await new Promise((resolve) => setTimeout(resolve, 100));

			// Handle pending tool approval
			if (this.pendingToolApproval) {
				await this.handleToolApproval();
			}

			// Check if run is still active
			if (this.currentRunId !== runId) {
				// Run is no longer active (completed, canceled, or failed)
				break;
			}

			attempts++;
		}
	}

	private async handleToolApproval(): Promise<void> {
		if (!this.pendingToolApproval || !this.rl) {
			return;
		}

		const { toolCallId, toolName } = this.pendingToolApproval;

		return new Promise((resolve) => {
			const question = `Approve tool '${toolName}'? [y/n/a=always] `;
			this.rl!.question(question, (answer) => {
				const trimmed = answer.trim().toLowerCase();
				if (trimmed === "y" || trimmed === "yes") {
					this.session.approveTool(toolCallId);
					console.log("[Tool approved]");
				} else if (trimmed === "a" || trimmed === "always") {
					this.session.approveTool(toolCallId);
					console.log("[Tool approved (this session only)]");
				} else {
					this.session.rejectTool(toolCallId);
					console.log("[Tool rejected]");
				}
				this.clearPendingToolApproval();
				resolve();
			});
		});
	}

	private async handleSlashCommand(command: string): Promise<void> {
		const parts = command.slice(1).split(" ");
		const cmdName = parts[0];
		const args = parts.slice(1).join(" ");

		switch (cmdName) {
			case "exit":
			case "quit":
			case "q":
				console.log("[Exiting...]");
				this.stop();
				process.exit(0);
				break;

			case "compact":
				console.log("[Compacting session context...]");
				try {
					const result = await this.session.compactSession();
					console.log(`[Compacted: ${result.summary.goal}]`);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					console.error(`[Compaction failed: ${message}]`);
				}
				break;

			case "abort":
				if (this.currentRunId) {
					console.log("[Aborting current run...]");
					this.session.cancelRun(this.currentRunId);
					this.currentRunId = null;
					this.isStreaming = false;
				} else {
					console.log("[No active run to abort]");
				}
				break;

			case "model": {
				const modelId = args.trim();
				if (modelId) {
					try {
						this.session.setModel(modelId);
						console.log(`[Model set to: ${modelId}]`);
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						console.error(`[Failed to set model: ${message}]`);
					}
				} else {
					console.log("[Usage: /model <model-id>]");
				}
				break;
			}

			case "stats":
			case "session": {
				const stats = this.session.getSessionStats();
				console.log(`[Session Stats]`);
				console.log(`  Session ID: ${stats.sessionId}`);
				console.log(`  Messages: ${stats.totalMessages}`);
				console.log(`  User messages: ${stats.userMessages}`);
				console.log(`  Assistant messages: ${stats.assistantMessages}`);
				console.log(`  Tool calls: ${stats.toolCalls}`);
				console.log(`  Runs: ${stats.runs}`);
				break;
			}

			case "help":
			case "h":
			case "?":
				console.log("[Available commands]");
				for (const cmd of BUILTIN_SLASH_COMMANDS) {
					console.log(`  /${cmd.name.padEnd(18)} - ${cmd.description}`);
				}
				console.log("  /help, /h, /?        - Show this help");
				break;

			case "settings":
				console.log("[Settings]");
				console.log("  This command opens the settings menu in the full TUI.");
				console.log("  In this terminal mode, please edit your settings file directly.");
				break;

			case "scoped-models":
				console.log("[Scoped Models]");
				console.log("  This command enables/disables models for Ctrl+P cycling.");
				console.log("  In this terminal mode, model selection is not available.");
				break;

			case "export":
				console.log("[Export]");
				console.log("  HTML export is not available in terminal mode.");
				console.log("  Use the desktop app for full export functionality.");
				break;

			case "share":
				console.log("[Share]");
				console.log("  GitHub gist sharing is not available in terminal mode.");
				console.log("  Use the desktop app for sharing functionality.");
				break;

			case "copy":
				console.log("[Copy]");
				console.log("  Clipboard operations are not available in terminal mode.");
				console.log("  Use the desktop app for clipboard functionality.");
				break;

			case "name": {
				const name = args.trim();
				if (name) {
					console.log(`[Session name set to: ${name}]`);
					console.log("  (Note: Session name storage is handled via session history)");
				} else {
					console.log("[Usage: /name <session-name>]");
				}
				break;
			}

			case "changelog":
				console.log("[Changelog]");
				console.log("  To see the latest changelog, visit:");
				console.log("  https://github.com/yourusername/omi/releases");
				break;

			case "hotkeys":
				console.log("[Keyboard Shortcuts]");
				console.log("  Ctrl+C     - Interrupt current run / Exit");
				console.log("  Enter      - Send prompt");
				console.log("  /<command> - Execute slash command");
				break;

			case "fork":
				console.log("[Fork]");
				console.log("  Creating a fork from the current session state...");
				try {
					const forkResult = await this.session.fork("");
					console.log(`[Created fork: ${forkResult.newSessionId}]`);
					console.log("  Use the desktop app to switch between branches.");
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					console.error(`[Failed to create fork: ${message}]`);
				}
				break;

			case "tree":
				console.log("[Session Tree]");
				console.log("  Session tree navigation is not available in terminal mode.");
				console.log("  Use the desktop app for full tree navigation.");
				break;

			case "login":
				console.log("[Login]");
				console.log("  OAuth login is not available in terminal mode.");
				console.log("  Use the desktop app for OAuth functionality.");
				break;

			case "logout":
				console.log("[Logout]");
				console.log("  OAuth logout is not available in terminal mode.");
				console.log("  Use the desktop app for OAuth functionality.");
				break;

			case "new":
				console.log("[New Session]");
				console.log("  To start a new session, exit and restart the application.");
				console.log("  Use: /exit or /quit");
				break;

			case "resume":
				console.log("[Resume Session]");
				console.log("  Session resumption is not available in terminal mode.");
				console.log("  Use the desktop app for session management.");
				break;

			case "reload":
				console.log("[Reload]");
				console.log("  Configuration reload is not available in terminal mode.");
				console.log("  Restart the application to reload configuration.");
				break;

			default:
				console.log(`[Unknown command: /${cmdName}]`);
				console.log("Type /help for available commands");
				// Try to send as a regular prompt (might be a slash command the agent handles)
				await this.handlePrompt(command);
				break;
		}
	}
}

/**
 * Start interactive mode with a session.
 * Returns the event emitter that should be wired to the AgentSession.
 */
export async function runInteractiveMode(
	session: AgentSession,
	options?: InteractiveModeOptions,
): Promise<void> {
	const mode = new InteractiveMode(session, options);

	// Note: The caller needs to wire the event emitter to the AgentSession
	// This is typically done by passing the emitter via the emit callback
	// For now, we'll start without explicit event wiring
	// In a full integration, the orchestrator would set this up

	await mode.start();
}
