/**
 * Bash command execution with streaming support and cancellation.
 *
 * This module provides a unified bash execution implementation used by:
 * - AgentSession.executeBash() for interactive and RPC modes
 * - Direct calls from modes that need bash execution
 */

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync, type WriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import stripAnsi from "strip-ansi";
import { DEFAULT_MAX_BYTES, truncateTail } from "@omi/tools";
import { getLogger } from "./logger";

const logger = getLogger("bash-executor");

// ============================================================================
// Shell Utilities (from Pi-Mono shell.ts)
// ============================================================================

let cachedShellConfig: { shell: string; args: string[] } | null = null;

/**
 * Find bash executable on PATH (cross-platform)
 */
function findBashOnPath(): string | null {
	if (process.platform === "win32") {
		// Windows: Use 'where' and verify file exists
		try {
			const result = spawnSync("where", ["bash.exe"], { encoding: "utf-8", timeout: 5000 });
			if (result.status === 0 && result.stdout) {
				const firstMatch = result.stdout.trim().split(/\r?\n/)[0];
				if (firstMatch && existsSync(firstMatch)) {
					return firstMatch;
				}
			}
		} catch {
			// Ignore errors
		}
		return null;
	}

	// Unix: Use 'which' and trust its output
	try {
		const result = spawnSync("which", ["bash"], { encoding: "utf-8", timeout: 5000 });
		if (result.status === 0 && result.stdout) {
			const firstMatch = result.stdout.trim().split(/\r?\n/)[0];
			if (firstMatch) {
				return firstMatch;
			}
		}
	} catch {
		// Ignore errors
	}
	return null;
}

/**
 * Get shell configuration based on platform.
 * Resolution order:
 * 1. User-specified shellPath (NOT IMPLEMENTED for Omi - uses defaults)
 * 2. On Windows: Git Bash in known locations, then bash on PATH
 * 3. On Unix: /bin/bash, then bash on PATH, then fallback to sh
 */
function getShellConfig(): { shell: string; args: string[] } {
	if (cachedShellConfig) {
		return cachedShellConfig;
	}

	if (process.platform === "win32") {
		// Try Git Bash in known locations
		const paths: string[] = [];
		const programFiles = process.env.ProgramFiles;
		if (programFiles) {
			paths.push(`${programFiles}\\Git\\bin\\bash.exe`);
		}
		const programFilesX86 = process.env["ProgramFiles(x86)"];
		if (programFilesX86) {
			paths.push(`${programFilesX86}\\Git\\bin\\bash.exe`);
		}

		for (const path of paths) {
			if (existsSync(path)) {
				cachedShellConfig = { shell: path, args: ["-c"] };
				return cachedShellConfig;
			}
		}

		// Fallback: search bash.exe on PATH
		const bashOnPath = findBashOnPath();
		if (bashOnPath) {
			cachedShellConfig = { shell: bashOnPath, args: ["-c"] };
			return cachedShellConfig;
		}

		throw new Error(
			`No bash shell found. Install Git for Windows: https://git-scm.com/download/win`,
		);
	}

	// Unix: try /bin/bash, then bash on PATH, then fallback to sh
	if (existsSync("/bin/bash")) {
		cachedShellConfig = { shell: "/bin/bash", args: ["-c"] };
		return cachedShellConfig;
	}

	const bashOnPath = findBashOnPath();
	if (bashOnPath) {
		cachedShellConfig = { shell: bashOnPath, args: ["-c"] };
		return cachedShellConfig;
	}

	cachedShellConfig = { shell: "sh", args: ["-c"] };
	return cachedShellConfig;
}

/**
 * Sanitize binary output for display/storage.
 * Removes characters that crash string-width or cause display issues:
 * - Control characters (except tab, newline, carriage return)
 * - Lone surrogates
 * - Unicode Format characters
 * - Characters with undefined code points
 */
function sanitizeBinaryOutput(str: string): string {
	return Array.from(str)
		.filter((char) => {
			const code = char.codePointAt(0);
			if (code === undefined) return false;
			// Allow tab, newline, carriage return
			if (code === 0x09 || code === 0x0a || code === 0x0d) return true;
			// Filter out control characters
			if (code <= 0x1f) return false;
			// Filter out Unicode format characters
			if (code >= 0xfff9 && code <= 0xfffb) return false;
			return true;
		})
		.join("");
}

/**
 * Kill a process and all its children (cross-platform)
 */
function killProcessTree(pid: number): void {
	if (process.platform === "win32") {
		try {
			spawn("taskkill", ["/F", "/T", "/PID", String(pid)], {
				stdio: "ignore",
				detached: true,
			});
		} catch {
			// Ignore errors
		}
	} else {
		try {
			process.kill(-pid, "SIGKILL");
		} catch {
			try {
				process.kill(pid, "SIGKILL");
			} catch {
				// Process already dead
			}
		}
	}
}

// ============================================================================
// Bash Operations
// ============================================================================

/**
 * Pluggable operations for the bash tool.
 * Override these to delegate command execution to remote systems (e.g., SSH).
 */
export interface BashOperations {
	/**
	 * Execute a command and stream output.
	 * @param command - The command to execute
	 * @param cwd - Working directory
	 * @param options - Execution options
	 * @returns Promise resolving to exit code (null if killed)
	 */
	exec: (
		command: string,
		cwd: string,
		options: {
			onData: (data: Buffer) => void;
			signal?: AbortSignal;
			timeout?: number;
			env?: NodeJS.ProcessEnv;
		},
	) => Promise<{ exitCode: number | null }>;
}

/**
 * Create bash operations using local shell execution backend.
 */
export function createLocalBashOperations(): BashOperations {
	return {
		exec: (command, cwd, { onData, signal, timeout, env }) => {
			return new Promise((resolve, reject) => {
				const { shell, args } = getShellConfig();
				const truncatedCommand = command.length > 50 ? `${command.slice(0, 50)}...` : command;

				logger.debug("Shell spawn", { shell, cwd, command: truncatedCommand, hasTimeout: !!timeout });

				if (!existsSync(cwd)) {
					logger.error("Working directory does not exist", { cwd });
					reject(new Error(`Working directory does not exist: ${cwd}\nCannot execute bash commands.`));
					return;
				}

				const child = spawn(shell, [...args, command], {
					cwd,
					detached: true,
					env: env ?? process.env,
					stdio: ["ignore", "pipe", "pipe"],
				});

				let timedOut = false;
				const spawnTime = Date.now();

				// Set timeout if provided
				let timeoutHandle: NodeJS.Timeout | undefined;
				if (timeout !== undefined && timeout > 0) {
					timeoutHandle = setTimeout(() => {
						timedOut = true;
						logger.warn("Bash command timed out", { command: truncatedCommand, timeout });
						if (child.pid) {
							killProcessTree(child.pid);
						}
					}, timeout * 1000);
				}

				// Stream stdout and stderr
				if (child.stdout) {
					child.stdout.on("data", onData);
				}
				if (child.stderr) {
					child.stderr.on("data", onData);
				}

				// Handle shell spawn errors
				child.on("error", (err) => {
					if (timeoutHandle) clearTimeout(timeoutHandle);
					if (signal) signal.removeEventListener("abort", onAbort);
					logger.errorWithError("Shell spawn error", err, { command: truncatedCommand, shell });
					reject(err);
				});

				// Handle abort signal - kill entire process tree
				const onAbort = () => {
					logger.debug("Bash abort signal received", { command: truncatedCommand, pid: child.pid });
					if (child.pid) {
						killProcessTree(child.pid);
					}
				};

				if (signal) {
					if (signal.aborted) {
						onAbort();
					} else {
						signal.addEventListener("abort", onAbort, { once: true });
					}
				}

				// Handle process exit
				child.on("close", (code) => {
					if (timeoutHandle) clearTimeout(timeoutHandle);
					if (signal) signal.removeEventListener("abort", onAbort);

					if (signal?.aborted) {
						logger.debug("Bash process closed after abort", { command: truncatedCommand });
						reject(new Error("aborted"));
						return;
					}

					if (timedOut) {
						reject(new Error(`timeout:${timeout}`));
						return;
					}

					logger.debug("Bash process exited", {
						command: truncatedCommand,
						exitCode: code,
						durationMs: Date.now() - spawnTime,
					});

					resolve({ exitCode: code });
				});
			});
		},
	};
}

// ============================================================================
// Types
// ============================================================================

export interface BashExecutorOptions {
	/** Callback for streaming output chunks (already sanitized) */
	onChunk?: (chunk: string) => void;
	/** AbortSignal for cancellation */
	signal?: AbortSignal;
}

export interface BashResult {
	/** Combined stdout + stderr output (sanitized, possibly truncated) */
	output: string;
	/** Process exit code (undefined if killed/cancelled) */
	exitCode: number | undefined;
	/** Whether the command was cancelled via signal */
	cancelled: boolean;
	/** Whether the output was truncated */
	truncated: boolean;
	/** Path to temp file containing full output (if output exceeded truncation threshold) */
	fullOutputPath?: string;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Execute a bash command with optional streaming and cancellation support.
 *
 * Uses the same local BashOperations backend so interactive user bash and
 * tool-invoked bash share the same process spawning behavior.
 *
 * @param command - The bash command to execute
 * @param options - Optional streaming callback and abort signal
 * @returns Promise resolving to execution result
 */
export function executeBash(command: string, options?: BashExecutorOptions): Promise<BashResult> {
	return executeBashWithOperations(command, process.cwd(), createLocalBashOperations(), options);
}

/**
 * Execute a bash command using custom BashOperations.
 * Used for remote execution (SSH, containers, etc.).
 */
export async function executeBashWithOperations(
	command: string,
	cwd: string,
	operations: BashOperations,
	options?: BashExecutorOptions,
): Promise<BashResult> {
	const startTime = Date.now();
	const truncatedCommand = command.length > 100 ? `${command.slice(0, 100)}...` : command;

	logger.debug("Bash execution started", { command: truncatedCommand, cwd });

	// Check for cancellation before starting
	if (options?.signal?.aborted) {
		logger.info("Bash execution cancelled before start", { command: truncatedCommand });
		return {
			output: "",
			exitCode: undefined,
			cancelled: true,
			truncated: false,
		};
	}

	const outputChunks: string[] = [];
	let outputBytes = 0;
	const maxOutputBytes = DEFAULT_MAX_BYTES * 2;

	let tempFilePath: string | undefined;
	let tempFileStream: WriteStream | undefined;
	let totalBytes = 0;

	const decoder = new TextDecoder();

	const onData = (data: Buffer) => {
		totalBytes += data.length;

		// Sanitize: strip ANSI, replace binary garbage, normalize newlines
		const text = sanitizeBinaryOutput(stripAnsi(decoder.decode(data, { stream: true }))).replace(/\r/g, "");

		// Start writing to temp file if exceeds threshold
		if (totalBytes > DEFAULT_MAX_BYTES && !tempFilePath) {
			const id = randomBytes(8).toString("hex");
			tempFilePath = join(tmpdir(), `omi-bash-${id}.log`);
			tempFileStream = createWriteStream(tempFilePath);
			for (const chunk of outputChunks) {
				tempFileStream.write(chunk);
			}
			logger.debug("Bash output written to temp file", { tempFilePath, threshold: DEFAULT_MAX_BYTES });
		}

		if (tempFileStream) {
			tempFileStream.write(text);
		}

		// Keep rolling buffer
		outputChunks.push(text);
		outputBytes += text.length;
		while (outputBytes > maxOutputBytes && outputChunks.length > 1) {
			const removed = outputChunks.shift()!;
			outputBytes -= removed.length;
		}

		// Stream to callback
		if (options?.onChunk) {
			options.onChunk(text);
		}
	};

	try {
		const result = await operations.exec(command, cwd, {
			onData,
			signal: options?.signal,
		});

		if (tempFileStream) {
			tempFileStream.end();
		}

		const fullOutput = outputChunks.join("");
		const truncationResult = truncateTail(fullOutput);
		const cancelled = options?.signal?.aborted ?? false;
		const durationMs = Date.now() - startTime;

		if (cancelled) {
			logger.info("Bash execution cancelled", { command: truncatedCommand, durationMs });
		} else if (result.exitCode !== 0) {
			logger.warn("Bash execution completed with non-zero exit code", {
				command: truncatedCommand,
				exitCode: result.exitCode,
				durationMs,
				outputBytes: totalBytes,
			});
		} else {
			logger.debug("Bash execution completed successfully", {
				command: truncatedCommand,
				exitCode: result.exitCode,
				durationMs,
				outputBytes: totalBytes,
			});
		}

		return {
			output: truncationResult.truncated ? truncationResult.content : fullOutput,
			exitCode: cancelled ? undefined : (result.exitCode ?? undefined),
			cancelled,
			truncated: truncationResult.truncated,
			fullOutputPath: tempFilePath,
		};
	} catch (err) {
		if (tempFileStream) {
			tempFileStream.end();
		}

		const durationMs = Date.now() - startTime;

		// Check if it was an abort
		if (options?.signal?.aborted) {
			logger.info("Bash execution aborted", { command: truncatedCommand, durationMs });
			const fullOutput = outputChunks.join("");
			const truncationResult = truncateTail(fullOutput);
			return {
				output: truncationResult.truncated ? truncationResult.content : fullOutput,
				exitCode: undefined,
				cancelled: true,
				truncated: truncationResult.truncated,
				fullOutputPath: tempFilePath,
			};
		}

		logger.errorWithError("Bash execution failed", err, {
			command: truncatedCommand,
			durationMs,
			outputBytes: totalBytes,
		});

		throw err;
	}
}
