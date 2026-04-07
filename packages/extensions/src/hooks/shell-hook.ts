/**
 * Hook System — Shell Hook Executor
 *
 * Executes shell commands as hook handlers.
 * Input is piped via stdin as JSON. Output (stdout) is parsed as JSON → HookOutput.
 * Non-JSON stdout is treated as a plain message string.
 */

import { spawn } from "node:child_process";
import type { HookInput, HookOutput } from "./types.js";

/**
 * Execute a shell command as a hook handler.
 *
 * Environment variables are injected for easy use in simple scripts:
 * - HOOK_EVENT: event name
 * - HOOK_TOOL_NAME: tool name (if applicable)
 * - HOOK_TOOL_USE_ID: tool use ID (if applicable)
 * - HOOK_SESSION_ID: session ID
 * - HOOK_CWD: working directory
 *
 * @param command - Shell command string
 * @param input - Hook input data (piped to stdin as JSON)
 * @param timeout - Max execution time in ms
 * @returns Parsed HookOutput or undefined on failure
 */
export async function executeShellHook(
	command: string,
	input: HookInput,
	timeout: number,
): Promise<HookOutput | undefined> {
	return new Promise((resolve) => {
		const proc = spawn("bash", ["-c", command], {
			timeout,
			env: {
				...process.env,
				HOOK_EVENT: input.event,
				HOOK_TOOL_NAME: input.toolName ?? "",
				HOOK_TOOL_USE_ID: input.toolUseId ?? "",
				HOOK_SESSION_ID: input.sessionId ?? "",
				HOOK_CWD: input.cwd ?? "",
			},
			stdio: ["pipe", "pipe", "pipe"],
		});

		// Send input as JSON on stdin
		proc.stdin?.write(JSON.stringify(input));
		proc.stdin?.end();

		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];

		proc.stdout?.on("data", (d: Buffer) => stdoutChunks.push(d));
		proc.stderr?.on("data", (d: Buffer) => stderrChunks.push(d));

		proc.on("close", (code) => {
			if (code !== 0) {
				// Non-zero exit code — hook failed, but don't crash the agent
				resolve(undefined);
				return;
			}

			const stdout = Buffer.concat(stdoutChunks).toString("utf-8").trim();
			if (!stdout) {
				// Empty output — hook succeeded but has nothing to say
				resolve(undefined);
				return;
			}

			try {
				const output = JSON.parse(stdout) as HookOutput;
				resolve(output);
			} catch {
				// Non-JSON output is treated as a plain message
				resolve({ message: stdout });
			}
		});

		proc.on("error", () => {
			// Process spawn error — silently resolve
			resolve(undefined);
		});
	});
}
