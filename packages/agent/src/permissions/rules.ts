/**
 * Permission Policy Engine - Rule Model
 *
 * Defines the rule schema, decision types, source priorities, and matchers
 * for the permission evaluation system.
 */

// ============================================================================
// Decision Types
// ============================================================================

export type PermissionDecision = "allow" | "ask" | "deny";

/**
 * Rule sources in priority order (highest to lowest).
 * session > project > user > managed > default
 */
export type PermissionRuleSource =
  | "session"    // Per-session overrides (e.g., user approved for this session)
  | "project"    // Project-level .omi/permissions.json
  | "user"       // User-level settings (~/.omi/permissions.json)
  | "managed"    // Enterprise / admin-managed policies
  | "default";   // Built-in defaults

/**
 * Source priority: higher number = higher priority.
 */
export const SOURCE_PRIORITY: Record<PermissionRuleSource, number> = {
  session: 50,
  project: 40,
  user: 30,
  managed: 20,
  default: 10,
};

// ============================================================================
// Rule Matchers
// ============================================================================

export interface ToolNameMatcher {
  type: "tool_name";
  /** Exact tool name or glob pattern (e.g., "bash", "mcp__*"). */
  pattern: string;
}

export interface CommandPatternMatcher {
  type: "command";
  /** Regex pattern matched against bash command text. */
  pattern: string;
}

export interface PathPrefixMatcher {
  type: "path_prefix";
  /** Path prefix matched against file paths in tool input. */
  prefix: string;
}

export interface McpServerMatcher {
  type: "mcp_server";
  /** MCP server name prefix (e.g., "github", "filesystem"). */
  prefix: string;
}

export type PermissionMatcher =
  | ToolNameMatcher
  | CommandPatternMatcher
  | PathPrefixMatcher
  | McpServerMatcher;

// ============================================================================
// Permission Rule
// ============================================================================

export interface PermissionRule {
  /** Unique rule ID for audit tracking. */
  id: string;
  /** Where this rule originates from. */
  source: PermissionRuleSource;
  /** The decision when this rule matches. */
  decision: PermissionDecision;
  /** One or more matchers (all must match for the rule to apply). */
  matchers: PermissionMatcher[];
  /** Human-readable description for audit logs. */
  description: string;
  /** Whether this rule is currently active. */
  active: boolean;
}

// ============================================================================
// Evaluation Context
// ============================================================================

export interface PermissionContext {
  /** The tool name being checked. */
  toolName: string;
  /** The tool input (may contain command, path, etc.). */
  input: Record<string, unknown>;
  /** MCP server name, if this is an MCP tool. */
  mcpServerName?: string;
  /** Whether the current session is in plan mode. */
  planMode: boolean;
  /** Session ID for session-scoped rule lookup. */
  sessionId: string;
}

// ============================================================================
// Evaluation Result
// ============================================================================

export interface PermissionEvalResult {
  /** The final decision. */
  decision: PermissionDecision;
  /** The rule that determined the decision (highest priority match). */
  matchedRule: PermissionRule | null;
  /** All rules that matched, sorted by source priority (desc). */
  matchedRules: PermissionRule[];
}

// ============================================================================
// Matcher Utilities
// ============================================================================

/**
 * Check if a tool name matches a pattern.
 * Supports simple glob: trailing "*" matches any suffix.
 */
export function matchToolName(toolName: string, pattern: string): boolean {
  if (pattern.endsWith("*")) {
    const prefix = pattern.slice(0, -1);
    return toolName.startsWith(prefix);
  }
  return toolName === pattern;
}

/**
 * Check if a command string matches a regex pattern.
 */
export function matchCommand(command: string, pattern: string): boolean {
  try {
    return new RegExp(pattern, "i").test(command);
  } catch {
    return false;
  }
}

/**
 * Check if a path starts with the given prefix.
 */
export function matchPathPrefix(filePath: string, prefix: string): boolean {
  const normalizedFilePath = normalizePathPrefix(filePath);
  const normalizedPrefix = normalizePathPrefix(prefix);

  if (normalizedPrefix === "") {
    return true;
  }

  return (
    normalizedFilePath === normalizedPrefix ||
    normalizedFilePath.startsWith(`${normalizedPrefix}/`)
  );
}

/**
 * Check if an MCP server name starts with the given prefix.
 */
export function matchMcpServer(serverName: string, prefix: string): boolean {
  return serverName.startsWith(prefix);
}

/**
 * Evaluate whether a single rule matches the given context.
 */
export function ruleMatchesContext(rule: PermissionRule, context: PermissionContext): boolean {
  if (!rule.active) {
    return false;
  }

  const inferredMcpServerName = context.mcpServerName ?? inferMcpServerName(context.toolName);

  return rule.matchers.every((matcher) => {
    switch (matcher.type) {
      case "tool_name":
        return matchToolName(context.toolName, matcher.pattern);
      case "command": {
        const command = extractCommand(context.input);
        return command ? matchCommand(command, matcher.pattern) : false;
      }
      case "path_prefix": {
        const path = extractPath(context.input);
        return path ? matchPathPrefix(path, matcher.prefix) : false;
      }
      case "mcp_server":
        return inferredMcpServerName
          ? matchMcpServer(inferredMcpServerName, matcher.prefix)
          : false;
    }
  });
}

// ============================================================================
// Helper: Extract command/path from tool input
// ============================================================================

function extractCommand(input: Record<string, unknown>): string | null {
  const command = input.command ?? input.cmd;
  if (typeof command === "string") return command;

  // bash tool uses "command" field
  if (typeof input.command === "string") return input.command;

  return null;
}

function extractPath(input: Record<string, unknown>): string | null {
  const path = input.path ?? input.file_path ?? input.filePath ?? input.file;
  if (typeof path === "string") return path;

  return null;
}

function normalizePathPrefix(value: string): string {
  return value.replace(/^\.\//, "").replace(/\/+$/, "");
}

function inferMcpServerName(toolName: string): string | null {
  const match = toolName.match(/^mcp__([^_]+?)__/);
  return match?.[1] ?? null;
}

// ============================================================================
// Built-in Default Rules
// ============================================================================

export const DEFAULT_RULES: PermissionRule[] = [
  {
    id: "default:deny-rm-rf",
    source: "default",
    decision: "deny",
    matchers: [{ type: "tool_name", pattern: "bash" }, { type: "command", pattern: "\\brm\\s+-rf\\s+/(\\s|$)" }],
    description: "Deny dangerous rm -rf / commands",
    active: true,
  },
  {
    id: "default:ask-bash",
    source: "default",
    decision: "ask",
    matchers: [{ type: "tool_name", pattern: "bash" }],
    description: "Require approval for bash commands",
    active: true,
  },
  {
    id: "default:ask-edit",
    source: "default",
    decision: "ask",
    matchers: [{ type: "tool_name", pattern: "edit" }],
    description: "Require approval for file edits",
    active: true,
  },
  {
    id: "default:ask-write",
    source: "default",
    decision: "ask",
    matchers: [{ type: "tool_name", pattern: "write" }],
    description: "Require approval for file writes",
    active: true,
  },
  {
    id: "default:allow-read",
    source: "default",
    decision: "allow",
    matchers: [{ type: "tool_name", pattern: "read" }],
    description: "Allow read operations",
    active: true,
  },
  {
    id: "default:allow-ls",
    source: "default",
    decision: "allow",
    matchers: [{ type: "tool_name", pattern: "ls" }],
    description: "Allow directory listing",
    active: true,
  },
  {
    id: "default:allow-grep",
    source: "default",
    decision: "allow",
    matchers: [{ type: "tool_name", pattern: "grep" }],
    description: "Allow grep search",
    active: true,
  },
  {
    id: "default:allow-find",
    source: "default",
    decision: "allow",
    matchers: [{ type: "tool_name", pattern: "find" }],
    description: "Allow find search",
    active: true,
  },
  {
    id: "default:ask-mcp",
    source: "default",
    decision: "ask",
    matchers: [{ type: "tool_name", pattern: "mcp__*" }],
    description: "Require approval for MCP tools by default",
    active: true,
  },
];

/**
 * Tools that are considered write operations (blocked in plan mode).
 */
export const WRITE_TOOLS = new Set(["bash", "edit", "write"]);

/**
 * Tools that are read-only (allowed in plan mode).
 */
export const READ_TOOLS = new Set(["read", "ls", "grep", "find"]);
