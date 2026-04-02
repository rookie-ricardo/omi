/**
 * Print mode (single-shot): Send prompts, output result, exit.
 *
 * Used for:
 * - Single prompt execution with text output
 * - JSON event stream mode for debugging
 * - CI/CD automation
 */

import type { AgentSession } from "../agent-session";
import type { RunnerEventEnvelope } from "../agent-session";
import type { ImageContent } from "@mariozechner/pi-ai";
import { createEventBus } from "../event-bus";
import * as fs from "node:fs";
import * as path from "node:path";

export interface PrintModeOptions {
	/** Output mode: "text" for final response only, "json" for all events */
	mode: "text" | "json";
	/** Array of additional prompts to send after initial message */
	messages?: string[];
	/** First message to send */
	initialMessage?: string;
	/** Images to attach to the initial message */
	images?: ImageContent[];
	/** File paths to attach as images (auto-read and base64-encode) */
	imagePaths?: string[];
	/** Maximum turns before auto-exit (default: 10, 0 for unlimited) */
	maxTurns?: number;
	/** Timeout in milliseconds before auto-exit (default: 300000 = 5 minutes, 0 for unlimited) */
	timeoutMs?: number;
	/** Whether to output streaming deltas in real-time */
	stream?: boolean;
}

const IMAGE_MIME_TYPES: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".svg": "image/svg+xml",
};

/**
 * Read image files from disk and convert to ImageContent objects.
 */
function readImageFiles(imagePaths: string[]): ImageContent[] {
	const images: ImageContent[] = [];
	for (const filePath of imagePaths) {
		const resolved = path.resolve(filePath);
		if (!fs.existsSync(resolved)) {
			console.error(`[Warning: Image file not found: ${resolved}]`);
			continue;
		}
		const ext = path.extname(resolved).toLowerCase();
		const mimeType = IMAGE_MIME_TYPES[ext];
		if (!mimeType) {
			console.error(`[Warning: Unsupported image format: ${ext}]`);
			continue;
		}
		const data = fs.readFileSync(resolved);
		const base64 = data.toString("base64");
		images.push({
			type: "image",
			source: { type: "base64", media_type: mimeType, data: base64 },
		} as unknown as ImageContent);
	}
	return images;
}

/**
 * Run in print (single-shot) mode.
 * Sends prompts to the agent and outputs the result.
 */
export async function runPrintMode(session: AgentSession, options: PrintModeOptions): Promise<number> {
	const {
		mode,
		messages = [],
		initialMessage,
		images = [],
		imagePaths = [],
		maxTurns = 10,
		timeoutMs = 300000,
		stream = false,
	} = options;

	// Collect all images: directly provided + read from file paths
	const allImages: ImageContent[] = [...images, ...readImageFiles(imagePaths)];

	let exitCode = 0;
	let turnCount = 0;
	const outputBuffer: string[] = [];
	const eventBus = createEventBus();

	// Timeout cleanup pattern (following pi's approach)
	let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

	const cleanup = (): void => {
		if (timeoutTimer) {
			clearTimeout(timeoutTimer);
			timeoutTimer = undefined;
		}
	};

	// Set up timeout promise with proper cleanup
	const timeoutPromise: Promise<number> = timeoutMs > 0
		? new Promise<number>((resolve) => {
			timeoutTimer = setTimeout(() => {
				console.error(`[Timeout: ${timeoutMs}ms exceeded]`);
				cleanup();
				resolve(1);
			}, timeoutMs);
		})
		: new Promise<never>(() => {}); // Never resolves (pi pattern)

	// Set up event listeners for streaming output
	if (stream || mode === "json") {
		eventBus.on("run.delta", (data: unknown) => {
			const event = data as RunnerEventEnvelope;
			const delta = event.payload.delta as string;
			if (delta) {
				process.stdout.write(delta);
				outputBuffer.push(delta);
			}
		});
	}

	eventBus.on("run.started", (data: unknown) => {
		const event = data as RunnerEventEnvelope;
		if (mode === "json") {
			console.log(JSON.stringify({ type: "run_started", runId: event.payload.runId }));
		}
	});

	eventBus.on("run.completed", (data: unknown) => {
		const event = data as RunnerEventEnvelope;
		if (mode === "json") {
			console.log(JSON.stringify({ type: "run_completed", runId: event.payload.runId }));
		}
		turnCount++;
	});

	eventBus.on("run.failed", (data: unknown) => {
		const event = data as RunnerEventEnvelope;
		const error = event.payload.error as string | undefined;
		if (mode === "json") {
			console.log(JSON.stringify({ type: "run_failed", runId: event.payload.runId, error }));
		} else {
			console.error(`[Run failed${error ? `: ${error}` : ""}]`);
		}
		exitCode = 1;
	});

	eventBus.on("run.canceled", (data: unknown) => {
		const event = data as RunnerEventEnvelope;
		if (mode === "json") {
			console.log(JSON.stringify({ type: "run_canceled", runId: event.payload.runId }));
		}
		exitCode = 1;
	});

	// Wire up event emitter to session
	const eventEmitter = (event: RunnerEventEnvelope) => {
		eventBus.emit(event.type, event);
	};
	void eventEmitter;

	// Helper function to check if we should continue
	const shouldContinue = (): boolean => {
		if (exitCode !== 0) return false;
		if (maxTurns > 0 && turnCount >= maxTurns) {
			console.error(`[Max turns (${maxTurns}) exceeded]`);
			exitCode = 1;
			return false;
		}
		return true;
	};

	// Main execution
	const executionPromise = (async (): Promise<number> => {
		try {
			// In JSON mode, output session header
			if (mode === "json") {
				const stats = session.getSessionStats();
				console.log(JSON.stringify({ type: "session_start", sessionId: stats.sessionId }));
			}

			// Send initial message with images
			if (initialMessage && shouldContinue()) {
				const promptOptions = allImages.length > 0 ? { images: allImages } : undefined;
				const run = await session.prompt(initialMessage, promptOptions);
				if (mode === "json") {
					console.log(JSON.stringify({ type: "prompt_sent", runId: run.id, imageCount: allImages.length }));
				}
			}

			// Send remaining messages
			for (const message of messages) {
				if (!shouldContinue()) break;
				const run = await session.prompt(message);
				if (mode === "json") {
					console.log(JSON.stringify({ type: "prompt_sent", runId: run.id }));
				}
			}

			// In text mode without streaming, output final response
			if (mode === "text" && !stream) {
				const stats = session.getSessionStats();
				if (outputBuffer.length > 0) {
					console.log(outputBuffer.join(""));
				}
				console.log(`[Completed ${stats.runs} run(s), ${stats.totalMessages} messages]`);
			}

			return exitCode;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(`[Error: ${message}]`);
			return 1;
		} finally {
			cleanup(); // Always clean up timer on completion
		}
	})();

	// Race between execution and timeout
	const result = await Promise.race([executionPromise, timeoutPromise]);

	// Ensure stdout is fully flushed before returning
	await new Promise<void>((resolve) => {
		process.stdout.write("", () => resolve());
	});

	return result;
}

/**
 * Run print mode with a simple prompt (convenience function).
 */
export async function runPrintModeSimple(
	session: AgentSession,
	prompt: string,
	options: Partial<PrintModeOptions> = {},
): Promise<number> {
	return runPrintMode(session, {
		mode: options.mode ?? "text",
		...options,
		initialMessage: prompt,
	});
}
