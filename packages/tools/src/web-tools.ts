import type { OmiTool } from "@omi/core";
import { Type } from "@mariozechner/pi-ai";
import { parseToolInput } from "./input-parse";

// ============================================================================
// Schemas
// ============================================================================

export const webFetchSchema = Type.Object({
  url: Type.String({ description: "URL to fetch" }),
  maxChars: Type.Optional(Type.Number({ description: "Maximum number of characters to return" })),
});

export interface WebFetchInput {
  url: string;
  maxChars?: number;
}

export const webSearchSchema = Type.Object({
  query: Type.String({ description: "Search query" }),
  limit: Type.Optional(Type.Number({ description: "Maximum number of results" })),
});

export interface WebSearchInput {
  query: string;
  limit?: number;
}

export const askUserSchema = Type.Object({
  question: Type.String({ description: "Question to ask the user" }),
  choices: Type.Optional(Type.Array(Type.String(), { description: "Optional answer choices" })),
});

export interface AskUserInput {
  question: string;
  choices?: string[];
}

// ============================================================================
// Helpers
// ============================================================================

function toTextSummary(lines: string[]): string {
  return lines.filter(Boolean).join("\n");
}

function stripHtml(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseSearchResults(html: string, limit: number): Array<{ title: string; url: string; snippet?: string }> {
  const results: Array<{ title: string; url: string; snippet?: string }> = [];
  const linkPattern = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetPattern = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i;

  let match: RegExpExecArray | null;
  while ((match = linkPattern.exec(html)) && results.length < limit) {
    const url = match[1];
    const title = stripHtml(match[2] ?? "");
    const snippetMatch = html.slice(match.index).match(snippetPattern);
    const snippet = snippetMatch ? stripHtml(snippetMatch[1] ?? "") : undefined;
    results.push({ title, url, snippet });
  }

  return results;
}

// ============================================================================
// Tool Factories
// ============================================================================

export function createWebFetchTool(): OmiTool<typeof webFetchSchema, { url?: string; status?: number; contentType?: string; title?: string; body?: string }> {
  return {
    name: "web.fetch",
    label: "web.fetch",
    description: `Fetches content from a URL, converts HTML to plain text, and returns it.

Usage:
- IMPORTANT: Will FAIL for authenticated/private URLs. Check if the URL points to an authenticated service first.
- URL must be a fully-formed valid URL. HTTP is auto-upgraded to HTTPS.
- Read-only operation. Results may be summarized. Responses are cached for 15 minutes.
- When the URL redirects, the tool informs you and provides the redirect URL.
- For GitHub URLs, prefer using the gh CLI via Bash tool instead.
- Prefer MCP-provided web fetch tool if one is available.
- Use maxChars parameter to limit the response length.`,
    parameters: webFetchSchema,
    execute: async (_toolCallId: string, params: unknown) => {
      const { url, maxChars } = parseToolInput("web.fetch", webFetchSchema, params);
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new Error(`Invalid URL: ${url}`);
      }

      const response = await fetch(parsed);
      const contentType = response.headers.get("content-type") ?? undefined;
      const body = await response.text();
      const text = stripHtml(body);
      const title = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? undefined;
      const clipped = maxChars && maxChars > 0 ? text.slice(0, maxChars) : text;
      return {
        content: [{ type: "text" as const, text: clipped }],
        details: {
          url: parsed.toString(),
          status: response.status,
          contentType,
          title,
          body: clipped,
        },
      };
    },
  };
}

export function createWebSearchTool(): OmiTool<typeof webSearchSchema, { query: string; results: Array<{ title: string; url: string; snippet?: string }> }> {
  return {
    name: "web.search",
    label: "web.search",
    description: `Allows searching the web for up-to-date information.

Usage:
- Returns results formatted as numbered search result blocks with titles, URLs, and snippets.
- CRITICAL: After answering a question using search results, you MUST include a "Sources:" section with the relevant URLs from the results.
- IMPORTANT: Use the correct year in search queries to get current results.
- Use the limit parameter to control how many results are returned (default: 5).`,
    parameters: webSearchSchema,
    execute: async (_toolCallId: string, params: unknown) => {
      const { query, limit } = parseToolInput("web.search", webSearchSchema, params);
      const resultLimit = Math.max(1, limit ?? 5);
      const searchUrl = new URL("https://duckduckgo.com/html/");
      searchUrl.searchParams.set("q", query);

      const response = await fetch(searchUrl);
      const html = await response.text();
      const results = parseSearchResults(html, resultLimit);
      const text = results.length
        ? results.map((result, index) => `${index + 1}. ${result.title}\n${result.url}${result.snippet ? `\n${result.snippet}` : ""}`).join("\n\n")
        : "No search results found";

      return {
        content: [{ type: "text" as const, text }],
        details: { query, results },
      };
    },
  };
}

export function createAskUserTool(): OmiTool<typeof askUserSchema, { question: string; choices?: string[]; waitingForUser: true; isInterrupt: true }> {
  return {
    name: "ask_user",
    label: "ask_user",
    description: `Ask the user a question during execution to get preferences, clarifications, or decisions.

Usage:
- Users can always provide a custom answer even when choices are provided.
- If you recommend a specific option, make it the first choice with "(Recommended)" suffix.
- Provide choices array for structured questions where predefined answers make sense.
- In plan mode, use this to clarify requirements BEFORE finalizing the plan, not to ask "Is my plan ready?"`,
    parameters: askUserSchema,
    execute: async (_toolCallId: string, params: unknown) => {
      const { question, choices } = parseToolInput("ask_user", askUserSchema, params);
      const lines = [question];
      if (choices && choices.length > 0) {
        lines.push("", `Choices: ${choices.join(", ")}`);
      }
      return {
        content: [{ type: "text" as const, text: toTextSummary(lines) }],
        details: { question, choices, waitingForUser: true as const, isInterrupt: true as const },
      };
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createWebTools(): OmiTool<any>[] {
  return [
    createWebFetchTool(),
    createWebSearchTool(),
    createAskUserTool(),
  ];
}
