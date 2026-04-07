/**
 * Config Tool — Runtime configuration management
 *
 * Aligned with claude-code's ConfigTool and open-agent-sdk's config-tool.
 * Allows the agent to read and modify runtime settings such as:
 * - Model selection
 * - Permission mode
 * - Custom preferences
 * - Notification settings
 */

import type { OmiTool } from "@omi/core";
import { Type } from "@mariozechner/pi-ai";
import { parseToolInput } from "./input-parse";

// ============================================================================
// Schema
// ============================================================================

export const configReadSchema = Type.Object({
	key: Type.Optional(Type.String({ description: "Configuration key to read. Omit to list all." })),
});

export interface ConfigReadInput {
	key?: string;
}

export const configWriteSchema = Type.Object({
	key: Type.String({ description: "Configuration key to set" }),
	value: Type.Unknown({ description: "Value to set" }),
});

export interface ConfigWriteInput {
	key: string;
	value: unknown;
}

// ============================================================================
// Config Store
// ============================================================================

const configStore = new Map<string, unknown>();

/**
 * Get a config value.
 */
export function getConfigValue(key: string): unknown | undefined {
	return configStore.get(key);
}

/**
 * Set a config value.
 */
export function setConfigValue(key: string, value: unknown): void {
	configStore.set(key, value);
}

/**
 * Get all config as a record.
 */
export function getAllConfig(): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [key, value] of configStore) {
		result[key] = value;
	}
	return result;
}

/**
 * Reset all config.
 */
export function resetConfig(): void {
	configStore.clear();
}

// ============================================================================
// Tool Factories
// ============================================================================

export function createConfigReadTool(): OmiTool {
	return {
		name: "config.read",
		label: "config.read",
		description:
			"Read runtime configuration. Pass a specific key to read one setting, or omit to list all settings.",
		parameters: configReadSchema,
		execute: async (_toolCallId: string, params: unknown) => {
			const { key } = parseToolInput("config.read", configReadSchema, params);

			if (key) {
				const value = configStore.get(key);
				if (value === undefined) {
					return {
						content: [{ type: "text" as const, text: `Config key '${key}' is not set.` }],
						details: { key, found: false },
					};
				}
				return {
					content: [{ type: "text" as const, text: `${key} = ${JSON.stringify(value)}` }],
					details: { key, value, found: true },
				};
			}

			// List all config
			const all = getAllConfig();
			const keys = Object.keys(all);
			if (keys.length === 0) {
				return {
					content: [{ type: "text" as const, text: "No configuration set." }],
					details: { count: 0 },
				};
			}

			const lines = keys.map((k) => `  ${k} = ${JSON.stringify(all[k])}`);
			return {
				content: [{ type: "text" as const, text: `Configuration (${keys.length} keys):\n${lines.join("\n")}` }],
				details: { count: keys.length, config: all },
			};
		},
	};
}

export function createConfigWriteTool(): OmiTool {
	return {
		name: "config.write",
		label: "config.write",
		description:
			"Set a runtime configuration value. Can be used to change model, permissions, or custom settings.",
		parameters: configWriteSchema,
		execute: async (_toolCallId: string, params: unknown) => {
			const { key, value } = parseToolInput("config.write", configWriteSchema, params);

			const previousValue = configStore.get(key);
			configStore.set(key, value);

			const lines = [`Config updated: ${key} = ${JSON.stringify(value)}`];
			if (previousValue !== undefined) {
				lines.push(`  Previous: ${JSON.stringify(previousValue)}`);
			}

			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
				details: { key, value, previousValue },
			};
		},
	};
}
