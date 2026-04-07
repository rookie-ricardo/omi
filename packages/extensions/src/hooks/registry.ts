/**
 * Hook System — Registry
 *
 * Central registry for managing and executing lifecycle hooks.
 * Supports both programmatic (function) and shell (command) handlers.
 */

import type {
	HookConfig,
	HookDefinition,
	HookEvent,
	HookInput,
	HookOutput,
	HOOK_EVENTS,
} from "./types.js";
import { executeShellHook } from "./shell-hook.js";

const DEFAULT_TIMEOUT = 30_000; // 30 seconds

// ============================================================================
// Hook Registry
// ============================================================================

export class HookRegistry {
	private readonly hooks = new Map<HookEvent, HookDefinition[]>();

	/**
	 * Register hooks from a configuration object (e.g., from settings file).
	 * Only events that match known HOOK_EVENTS are registered.
	 */
	registerFromConfig(config: HookConfig): void {
		for (const [event, definitions] of Object.entries(config)) {
			// Validate that the event name is a known hook event
			if (!isValidHookEvent(event)) {
				continue;
			}
			const hookEvent = event as HookEvent;
			const existing = this.hooks.get(hookEvent) ?? [];
			this.hooks.set(hookEvent, [...existing, ...definitions]);
		}
	}

	/**
	 * Register a single hook for a specific event.
	 */
	register(event: HookEvent, definition: HookDefinition): void {
		const existing = this.hooks.get(event) ?? [];
		existing.push(definition);
		this.hooks.set(event, existing);
	}

	/**
	 * Unregister all hooks for a specific event.
	 */
	unregisterAll(event: HookEvent): void {
		this.hooks.delete(event);
	}

	/**
	 * Execute all hooks registered for an event.
	 *
	 * Hooks run sequentially in registration order. Each hook receives the
	 * same input, but a PreToolUse hook's `modifiedInput` will NOT propagate
	 * to subsequent hooks — the caller is responsible for applying modifications.
	 *
	 * Errors in individual hooks are caught and logged but do not prevent
	 * subsequent hooks from executing.
	 *
	 * @returns Array of non-null HookOutputs from all handlers.
	 */
	async execute(event: HookEvent, input: HookInput): Promise<HookOutput[]> {
		const definitions = this.hooks.get(event) ?? [];
		const results: HookOutput[] = [];

		for (const def of definitions) {
			// Apply tool name matcher (for tool-specific hooks)
			if (def.matcher && input.toolName) {
				try {
					const regex = new RegExp(def.matcher);
					if (!regex.test(input.toolName)) {
						continue; // Skip — tool name doesn't match
					}
				} catch {
					// Invalid regex — skip this hook
					continue;
				}
			}

			const timeout = def.timeout ?? DEFAULT_TIMEOUT;

			try {
				let output: HookOutput | void | undefined;

				if (def.handler) {
					// Programmatic handler with timeout
					output = await Promise.race([
						def.handler(input),
						new Promise<void>((_, reject) =>
							setTimeout(() => reject(new Error(`Hook timeout after ${timeout}ms`)), timeout),
						),
					]);
				} else if (def.command) {
					// Shell command handler
					output = await executeShellHook(def.command, input, timeout);
				}

				if (output) {
					results.push(output);
				}
			} catch (err: unknown) {
				// Log but don't fail on hook errors
				const message = err instanceof Error ? err.message : String(err);
				console.error(`[HookRegistry] ${event} hook failed: ${message}`);
			}
		}

		return results;
	}

	/**
	 * Check if any hooks are registered for an event.
	 */
	hasHooks(event: HookEvent): boolean {
		return (this.hooks.get(event)?.length ?? 0) > 0;
	}

	/**
	 * Get the number of hooks registered for an event.
	 */
	hookCount(event: HookEvent): number {
		return this.hooks.get(event)?.length ?? 0;
	}

	/**
	 * Get all registered events.
	 */
	getRegisteredEvents(): HookEvent[] {
		return [...this.hooks.keys()].filter((key) => (this.hooks.get(key)?.length ?? 0) > 0);
	}

	/**
	 * Clear all hooks.
	 */
	clear(): void {
		this.hooks.clear();
	}
}

// ============================================================================
// Helpers
// ============================================================================

const VALID_HOOK_EVENTS = new Set<string>([
	"PreToolUse",
	"PostToolUse",
	"PostToolUseFailure",
	"SessionStart",
	"SessionEnd",
	"Stop",
	"SubagentStart",
	"SubagentStop",
	"UserPromptSubmit",
	"PermissionRequest",
	"PermissionDenied",
	"TaskCreated",
	"TaskCompleted",
	"ConfigChange",
	"CwdChanged",
	"FileChanged",
	"Notification",
	"PreCompact",
	"PostCompact",
	"TeammateIdle",
]);

function isValidHookEvent(event: string): boolean {
	return VALID_HOOK_EVENTS.has(event);
}

// ============================================================================
// Aggregate Hook Results
// ============================================================================

/**
 * Utility: Check if any hook output in the array requests blocking.
 */
export function shouldBlock(outputs: HookOutput[]): boolean {
	return outputs.some((o) => o.block === true);
}

/**
 * Utility: Collect all messages from hook outputs.
 */
export function collectMessages(outputs: HookOutput[]): string[] {
	return outputs.filter((o) => o.message).map((o) => o.message!);
}

/**
 * Utility: Get the first modified input from hook outputs (for PreToolUse).
 */
export function getModifiedInput(outputs: HookOutput[]): unknown | undefined {
	for (const output of outputs) {
		if (output.modifiedInput !== undefined) {
			return output.modifiedInput;
		}
	}
	return undefined;
}

/**
 * Utility: Get the block reason (first one wins).
 */
export function getBlockReason(outputs: HookOutput[]): string | undefined {
	for (const output of outputs) {
		if (output.block && output.blockReason) {
			return output.blockReason;
		}
	}
	return undefined;
}

/**
 * Utility: Collect all permission updates from hook outputs.
 */
export function collectPermissionUpdates(outputs: HookOutput[]): Array<{ tool: string; behavior: "allow" | "deny" }> {
	return outputs
		.filter((o) => o.permissionUpdate)
		.map((o) => o.permissionUpdate!);
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a new HookRegistry, optionally pre-loaded with config.
 */
export function createHookRegistry(config?: HookConfig): HookRegistry {
	const registry = new HookRegistry();
	if (config) {
		registry.registerFromConfig(config);
	}
	return registry;
}
