/**
 * OmiTool - Canonical tool interface for the OMI agent system.
 *
 * All tool implementations across the system conform to this interface.
 *
 * Design principles:
 * - Structurally compatible with pi-ai's tool expectations
 * - All generic parameters are optional (bare `OmiTool` is valid)
 * - The execute signature supports abort signals and streaming updates
 */

// ============================================================================
// Tool Content Types
// ============================================================================

/**
 * A single content block in a tool result.
 *
 * Content blocks are protocol-defined (by the underlying model adapter, e.g., pi-ai).
 * We intentionally keep this type permissive to avoid coupling our tool interface
 * to any specific model protocol's content schema.
 *
 * Common shapes include:
 * - `{ type: "text", text: string }`
 * - `{ type: "image", data: string, mimeType: string }`
 */
export interface ToolContentBlock {
  type: string;
  [key: string]: unknown;
}

// ============================================================================
// Tool Result
// ============================================================================

/**
 * Standardized return type for tool execution.
 *
 * `content` is the LLM-facing output (what the model sees as tool result).
 *   Content blocks are protocol-defined (by the underlying model adapter, e.g., pi-ai).
 *   We use `ReadonlyArray<{ type: string } & Record<string, unknown>>` to accept
 *   any content block that has a `type` discriminator without imposing an index signature
 *   on the implementor's types.
 *
 * `details` is structured data for programmatic consumption by the agent layer.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface OmiToolResult<TDetails = unknown> {
  content: any[];
  details?: TDetails;
}

// ============================================================================
// OmiTool Interface
// ============================================================================

/**
 * Canonical tool interface for the OMI agent system.
 *
 * @typeParam TSchema - The JSON Schema or TypeBox schema for tool parameters.
 *   Defaults to `unknown` for untyped usage.
 * @typeParam TDetails - The structured details type returned alongside content.
 *   Defaults to `unknown`.
 */
export interface OmiTool<TSchema = unknown, TDetails = unknown> {
  /** Unique tool name (used as the function name in LLM tool calls). */
  name: string;

  /** Human-readable display label. Falls back to `name` if not provided. */
  label?: string;

  /** Tool description shown to the LLM to help it decide when to use this tool. */
  description: string;

  /** JSON Schema or TypeBox schema defining the tool's input parameters. */
  parameters: TSchema;

  /**
   * Execute the tool with the given parameters.
   *
   * @param toolCallId - Unique identifier for this tool invocation.
   * @param params - The parsed input parameters (validated against `parameters` schema).
   * @param signal - Optional abort signal for cancellation support.
   * @param onUpdate - Optional callback for streaming partial results during execution.
   * @returns A promise resolving to the tool result.
   */
  execute: (
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
    onUpdate?: (result: unknown) => void,
  ) => Promise<OmiToolResult<TDetails>>;
}

// ============================================================================
// ThinkingLevel
// ============================================================================

/**
 * Thinking level for model reasoning control.
 *
 * Controls how much "thinking" the model does before responding.
 * Higher levels produce more thorough but slower responses.
 */
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

/** Default thinking levels (without xhigh). */
export const STANDARD_THINKING_LEVELS: readonly ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
] as const;

/** All thinking levels including xhigh. */
export const ALL_THINKING_LEVELS: readonly ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;
