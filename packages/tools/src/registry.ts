/**
 * Tool Surface Governance - Tool Registry
 *
 * Central registry for all tool definitions with:
 * - Registration and lookup
 * - Filter predicates (by risk, read-only, capability)
 * - Default tool sets
 */

import type { AgentTool } from "@mariozechner/pi-agent-core";

import type {
  ToolDefinition,
  ToolRiskLevel,
  ToolIdempotencyPolicy,
  ToolOutput,
  ToolErrorCode,
} from "./definitions";
import {
  buildErrorOutput,
  buildToolError,
  TOOL_ERROR_CODES,
} from "./definitions";

// ============================================================================
// Filter Predicates
// ============================================================================

export type ToolFilter = (def: ToolDefinition) => boolean;

/** Filter tools by risk level (inclusive). */
export function byRiskLevel(maxRisk: ToolRiskLevel): ToolFilter {
  return (def) => {
    const riskOrder = ["none", "low", "medium", "high", "critical"] as const;
    return riskOrder.indexOf(def.riskLevel) <= riskOrder.indexOf(maxRisk);
  };
}

/** Filter to only read-only tools. */
export function readOnly(): ToolFilter {
  return (def) => def.isReadOnly;
}

/** Filter to only write tools. */
export function writeTools(): ToolFilter {
  return (def) => !def.isReadOnly;
}

/** Filter to only enabled-by-default tools. */
export function enabledByDefault(): ToolFilter {
  return (def) => def.enabledByDefault;
}

/** Filter to tools with specific names. */
export function byNames(names: string[]): ToolFilter {
  const nameSet = new Set(names);
  return (def) => nameSet.has(def.name);
}

/** Filter to tools whose name matches a pattern. */
export function byPattern(pattern: RegExp): ToolFilter {
  return (def) => pattern.test(def.name);
}

/** Filter to tools with specific idempotency policy. */
export function byIdempotency(policy: ToolIdempotencyPolicy): ToolFilter {
  return (def) => def.idempotencyPolicy === policy;
}

/** Combine multiple filters with AND. */
export function and(...filters: ToolFilter[]): ToolFilter {
  return (def) => filters.every((f) => f(def));
}

/** Combine multiple filters with OR. */
export function or(...filters: ToolFilter[]): ToolFilter {
  return (def) => filters.some((f) => f(def));
}

/** Negate a filter. */
export function not(filter: ToolFilter): ToolFilter {
  return (def) => !filter(def);
}

// ============================================================================
// Tool Categories (for default sets)
// ============================================================================

/**
 * Core tools for a basic coding loop:
 * Explore -> Edit -> Verify -> Summarize
 */
export const CORE_TOOL_NAMES = new Set([
  "read",
  "ls",
  "grep",
  "glob",
  "bash",
  "edit",
  "notebook_edit",
  "write",
]);

/**
 * Safe tools (no approval required).
 */
export const SAFE_TOOL_NAMES = new Set(["read", "ls", "grep", "glob"]);

/**
 * Write tools (always require approval).
 */
export const WRITE_TOOL_NAMES = new Set(["bash", "edit", "write"]);

/**
 * Tools available in plan mode (read-only).
 */
export const PLAN_MODE_TOOL_NAMES = new Set(["read", "ls", "grep", "glob"]);

// ============================================================================
// Registry
// ============================================================================

export interface ToolRegistryEntry {
  definition: ToolDefinition;
  /** Factory function to create the AgentTool instance. */
  factory: (cwd: string) => AgentTool;
}

export interface ToolRegistry {
  /** Register a tool definition and factory. */
  register(entry: ToolRegistryEntry): void;
  /** Unregister a tool by name. */
  unregister(name: string): boolean;
  /** Get a tool definition by name. */
  get(name: string): ToolDefinition | undefined;
  /** Get a tool entry by name. */
  getEntry(name: string): ToolRegistryEntry | undefined;
  /** List all registered tool definitions. */
  listAll(): ToolDefinition[];
  /** List tool definitions matching a filter. */
  list(filter?: ToolFilter): ToolDefinition[];
  /** Create all AgentTool instances matching a filter. */
  createAll(cwd: string, filter?: ToolFilter): AgentTool[];
  /** Create a map of tool names to AgentTool instances. */
  createMap(cwd: string, filter?: ToolFilter): Record<string, AgentTool>;
  /** Check if a tool is registered. */
  has(name: string): boolean;
}

/**
 * Create a new tool registry.
 */
export function createToolRegistry(): ToolRegistry {
  const entries = new Map<string, ToolRegistryEntry>();

  return {
    register(entry: ToolRegistryEntry) {
      entries.set(entry.definition.name, entry);
    },

    unregister(name: string): boolean {
      return entries.delete(name);
    },

    get(name: string): ToolDefinition | undefined {
      return entries.get(name)?.definition;
    },

    getEntry(name: string): ToolRegistryEntry | undefined {
      return entries.get(name);
    },

    listAll(): ToolDefinition[] {
      return [...entries.values()].map((e) => e.definition);
    },

    list(filter?: ToolFilter): ToolDefinition[] {
      const all = [...entries.values()].map((e) => e.definition);
      if (!filter) return all;
      return all.filter(filter);
    },

    createAll(cwd: string, filter?: ToolFilter): AgentTool[] {
      const defs = this.list(filter);
      return defs
        .map((def) => {
          const entry = entries.get(def.name);
          return entry ? entry.factory(cwd) : null;
        })
        .filter((t): t is AgentTool => t !== null);
    },

    createMap(cwd: string, filter?: ToolFilter): Record<string, AgentTool> {
      const tools = this.createAll(cwd, filter);
      const map: Record<string, AgentTool> = {};
      for (const tool of tools) {
        map[tool.name] = tool;
      }
      return map;
    },

    has(name: string): boolean {
      return entries.has(name);
    },
  };
}

// ============================================================================
// Global Registry Instance
// ============================================================================

let globalRegistry: ToolRegistry | null = null;

export function getGlobalRegistry(): ToolRegistry {
  if (!globalRegistry) {
    globalRegistry = createToolRegistry();
  }
  return globalRegistry;
}

export function setGlobalRegistry(registry: ToolRegistry): void {
  globalRegistry = registry;
}

export function resetGlobalRegistry(): void {
  globalRegistry = null;
}

// ============================================================================
// Structured Tool Execution Wrapper
// ============================================================================

/**
 * Wrapper that executes a tool and returns structured output.
 * Used by tools that need standardized error handling.
 */
export async function executeWithStructuredOutput(
  tool: AgentTool,
  callId: string,
  rawInput: unknown,
): Promise<ToolOutput> {
  const start = Date.now();

  try {
    const result = await tool.execute(callId, rawInput);

    const content =
      result.content
        ?.filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n") ?? "";

    return {
      ok: true,
      data: result.details ?? {},
      content,
      meta: {
        durationMs: Date.now() - start,
        version: "1.0",
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Try to classify the error
    let code: ToolErrorCode = "COMMAND_FAILED";
    if (message.includes("ENOENT") || message.includes("not found")) {
      code = "FILE_NOT_FOUND";
    } else if (message.includes("EACCES") || message.includes("permission denied")) {
      code = "PERMISSION_DENIED";
    } else if (message.includes("timeout") || message.includes("timed out")) {
      code = "COMMAND_TIMEOUT";
    }

    return buildErrorOutput(
      buildToolError(code, message, { retryable: code !== "PERMISSION_DENIED" }),
      { durationMs: Date.now() - start },
    );
  }
}
