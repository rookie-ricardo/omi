/**
 * Tool wrappers for extension-registered tools.
 *
 * These wrappers only adapt tool execution so extension tools receive the runner context.
 * Tool call and tool result interception is handled by AgentSession via agent-core hooks.
 */

import type { OmiTool } from "@omi/core";
import type { ExtensionRunner } from "./runner";

/**
 * Represents a tool registered by an extension
 */
export interface RegisteredTool {
	definition: {
		name: string;
		label?: string;
		description: string;
		parameters: unknown;
		execute: (
			toolCallId: string,
			params: unknown,
			signal?: AbortSignal,
			onUpdate?: (result: unknown) => void,
			context?: unknown,
		) => Promise<unknown>;
	};
}

/**
 * Wrap a RegisteredTool into an OmiTool.
 * Uses the runner's createContext() for consistent context across tools and event handlers.
 */
export function wrapRegisteredTool(registeredTool: RegisteredTool, runner: ExtensionRunner): OmiTool {
	const { definition } = registeredTool;
	return {
		name: definition.name,
		label: definition.label ?? definition.name,
		description: definition.description,
		parameters: definition.parameters as OmiTool["parameters"],
		execute: (toolCallId: string, params: unknown, signal?: AbortSignal, onUpdate?: (result: unknown) => void) =>
			definition.execute(toolCallId, params, signal, onUpdate as any, (runner as any).createContext()) as any,
	};
}

/**
 * Wrap all registered tools into OmiTools.
 * Uses the runner's createContext() for consistent context across tools and event handlers.
 */
export function wrapRegisteredTools(registeredTools: RegisteredTool[], runner: ExtensionRunner): OmiTool[] {
	return registeredTools.map((rt) => wrapRegisteredTool(rt, runner));
}
