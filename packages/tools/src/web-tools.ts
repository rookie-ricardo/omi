import type { AgentTool } from "@mariozechner/pi-agent-core";
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

export function createWebFetchTool(): AgentTool<typeof webFetchSchema, { url?: string; status?: number; contentType?: string; title?: string; body?: string }> {
  return {
    name: "web.fetch",
    label: "web.fetch",
    description: "Fetch a web page and return its text content.",
    parameters: webFetchSchema,
    execute: async (_toolCallId: string, params: unknown) => {
      const { url, maxChars } = parseToolInput("web.fetch", webFetchSchema, params) as WebFetchInput;
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

export function createWebSearchTool(): AgentTool<typeof webSearchSchema, { query: string; results: Array<{ title: string; url: string; snippet?: string }> }> {
  return {
    name: "web.search",
    label: "web.search",
    description: "Search the web and return top results.",
    parameters: webSearchSchema,
    execute: async (_toolCallId: string, params: unknown) => {
      const { query, limit } = parseToolInput("web.search", webSearchSchema, params) as WebSearchInput;
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

export function createAskUserTool(): AgentTool<typeof askUserSchema, { question: string; choices?: string[]; waitingForUser: true }> {
  return {
    name: "ask_user",
    label: "ask_user",
    description: "Ask the user a clarifying question and wait for a response.",
    parameters: askUserSchema,
    execute: async (_toolCallId: string, params: unknown) => {
      const { question, choices } = parseToolInput("ask_user", askUserSchema, params) as AskUserInput;
      const lines = [question];
      if (choices && choices.length > 0) {
        lines.push("", `Choices: ${choices.join(", ")}`);
      }
      return {
        content: [{ type: "text" as const, text: toTextSummary(lines) }],
        details: { question, choices, waitingForUser: true as const },
      };
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createWebTools(): AgentTool<any>[] {
  return [
    createWebFetchTool(),
    createWebSearchTool(),
    createAskUserTool(),
  ];
}
