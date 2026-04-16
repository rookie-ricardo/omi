import type { ToolCall } from "@omi/core";

export type ToolCategory = "explore" | "edit" | "bash" | "other";
export type ToolGroupType = "explore" | "edit" | "bash" | "mixed";
export type ExploreActionType = "read" | "search" | "list";

interface TextLikeContent {
  type?: string;
  text?: unknown;
}

function lower(value: string): string {
  return value.toLowerCase();
}

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function safeJsonParse(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

export function getToolCategory(toolName: string): ToolCategory {
  const name = lower(toolName);
  if (name.includes("bash") || name.includes("shell") || name.includes("command")) {
    return "bash";
  }
  if (name.includes("edit") || name.includes("write")) {
    return "edit";
  }
  if (
    name.includes("read") ||
    name.includes("grep") ||
    name.includes("search") ||
    name.includes("glob") ||
    name.includes("ls") ||
    name.includes("find")
  ) {
    return "explore";
  }
  return "other";
}

export function getToolGroupType(toolCalls: ToolCall[]): ToolGroupType {
  const categories = new Set<ToolCategory>(toolCalls.map((toolCall) => getToolCategory(toolCall.toolName)));
  categories.delete("other");

  if (categories.size === 1) {
    const kind = Array.from(categories)[0];
    if (kind === "explore" || kind === "edit" || kind === "bash") {
      return kind;
    }
  }

  return "mixed";
}

export function getExploreActionType(toolName: string): ExploreActionType | null {
  const name = lower(toolName);
  if (name.includes("read")) {
    return "read";
  }
  if (name.includes("grep") || name.includes("search")) {
    return "search";
  }
  if (name.includes("ls") || name.includes("glob") || name.includes("find")) {
    return "list";
  }
  return null;
}

export function splitToolCallsByActivity(toolCalls: ToolCall[]): Array<{ kind: ToolCategory; toolCalls: ToolCall[] }> {
  const sorted = [...toolCalls].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  const order: ToolCategory[] = [];
  const grouped = new Map<ToolCategory, ToolCall[]>();

  for (const toolCall of sorted) {
    const category = getToolCategory(toolCall.toolName);
    if (!grouped.has(category)) {
      grouped.set(category, []);
      order.push(category);
    }
    grouped.get(category)?.push(toolCall);
  }

  return order.map((kind) => ({ kind, toolCalls: grouped.get(kind) ?? [] }));
}

function countExploreActions(toolCalls: ToolCall[]): { files: number; searches: number; lists: number } {
  let files = 0;
  let searches = 0;
  let lists = 0;

  for (const toolCall of toolCalls) {
    const action = getExploreActionType(toolCall.toolName);
    if (action === "read") {
      files += 1;
    } else if (action === "search") {
      searches += 1;
    } else if (action === "list") {
      lists += 1;
    }
  }

  return { files, searches, lists };
}

export function getExploreSummaryText(toolCalls: ToolCall[]): string {
  const counts = countExploreActions(toolCalls);
  const parts: string[] = [];

  if (counts.files > 0) {
    parts.push(pluralize(counts.files, "file", "files"));
  }
  if (counts.searches > 0) {
    parts.push(pluralize(counts.searches, "search", "searches"));
  }
  if (counts.lists > 0) {
    parts.push(pluralize(counts.lists, "list", "lists"));
  }

  if (parts.length === 0) {
    return "Explored";
  }

  return `Explored ${parts.join(", ")}`;
}

export function getEditSummaryText(toolCalls: ToolCall[]): string {
  const uniqueFiles = new Set<string>();
  for (const toolCall of toolCalls) {
    const path = getEditFilePath(toolCall);
    if (path) {
      uniqueFiles.add(path);
    }
  }

  const count = uniqueFiles.size || toolCalls.length;
  return `Edited ${pluralize(count, "file", "files")}`;
}

export function getBashSummaryText(toolCalls: ToolCall[]): string {
  return `Ran ${pluralize(toolCalls.length, "command", "commands")}`;
}

export function getMixedSummaryText(toolCalls: ToolCall[]): string {
  const exploreTools = toolCalls.filter((toolCall) => getToolCategory(toolCall.toolName) === "explore");
  const editTools = toolCalls.filter((toolCall) => getToolCategory(toolCall.toolName) === "edit");
  const bashTools = toolCalls.filter((toolCall) => getToolCategory(toolCall.toolName) === "bash");

  const parts: string[] = [];
  if (editTools.length > 0) {
    parts.push(getEditSummaryText(editTools));
  }
  if (exploreTools.length > 0) {
    const exploreText = getExploreSummaryText(exploreTools).replace(/^Explored\s+/, "explored ");
    parts.push(exploreText);
  }
  if (bashTools.length > 0) {
    const bashText = getBashSummaryText(bashTools).replace(/^Ran\s+/, "ran ");
    parts.push(bashText);
  }

  if (parts.length === 0) {
    return "Processed";
  }

  parts[0] = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  return parts.join(", ");
}

function textFromContentItem(item: unknown): string {
  if (typeof item === "string") {
    return item;
  }

  if (item && typeof item === "object") {
    const contentItem = item as TextLikeContent;
    if (contentItem.type === "text" && typeof contentItem.text === "string") {
      return contentItem.text;
    }
  }

  try {
    return JSON.stringify(item, null, 2);
  } catch {
    return String(item);
  }
}

export function extractToolOutputText(output: unknown): string {
  if (typeof output === "string") {
    return output;
  }

  if (typeof output === "number" || typeof output === "boolean") {
    return String(output);
  }

  if (Array.isArray(output)) {
    return output.map(textFromContentItem).join("\n").trim();
  }

  if (output && typeof output === "object") {
    const record = output as Record<string, unknown>;

    if (Array.isArray(record.content)) {
      return extractToolOutputText(record.content);
    }

    if (typeof record.stdout === "string") {
      return record.stdout;
    }

    if (typeof record.output === "string") {
      return record.output;
    }

    if (typeof record.text === "string") {
      return record.text;
    }

    if (record.error && typeof record.error === "string") {
      return record.error;
    }

    try {
      return JSON.stringify(output, null, 2);
    } catch {
      return String(output);
    }
  }

  return "";
}

export function parseToolError(error: string | null): string | null {
  if (!error) {
    return null;
  }

  const parsed = safeJsonParse(error);
  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    if (typeof record.error === "string") {
      return record.error;
    }
  }

  return error;
}

export function parseDiffStats(diff: string): { additions: number; deletions: number } {
  const lines = diff.split("\n");
  let additions = 0;
  let deletions = 0;

  for (const line of lines) {
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) {
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("++")) {
      additions += 1;
    }
    if (line.startsWith("-") && !line.startsWith("--")) {
      deletions += 1;
    }
  }

  return { additions, deletions };
}

export function extractDiffFromToolCall(toolCall: ToolCall): string | null {
  if (!toolCall.output) {
    return null;
  }

  const output = toolCall.output;

  if (typeof output === "string") {
    if (output.includes("@@") || output.startsWith("---")) {
      return output;
    }
    return null;
  }

  if (Array.isArray(output)) {
    const text = extractToolOutputText(output);
    if (text.includes("@@") || text.startsWith("---")) {
      return text;
    }
    return null;
  }

  if (typeof output === "object") {
    const record = output as Record<string, unknown>;

    if (typeof record.diff === "string") {
      return record.diff;
    }

    if (record.details && typeof record.details === "object") {
      const details = record.details as Record<string, unknown>;
      if (typeof details.diff === "string") {
        return details.diff;
      }
    }

    if (Array.isArray(record.content)) {
      const text = extractToolOutputText(record.content);
      if (text.includes("@@") || text.startsWith("---")) {
        return text;
      }
    }
  }

  return null;
}

export function getEditFilePath(toolCall: ToolCall): string {
  const input = toolCall.input as Record<string, unknown>;
  const candidate = input.path ?? input.file_path ?? input.filePath;
  return typeof candidate === "string" ? candidate : "";
}

export function getExplorePathOrPattern(toolCall: ToolCall): string {
  const input = toolCall.input as Record<string, unknown>;
  const action = getExploreActionType(toolCall.toolName);

  if (action === "read" || action === "list") {
    const candidate = input.path ?? input.file_path ?? input.filePath ?? input.pattern;
    return typeof candidate === "string" ? candidate : "";
  }

  if (action === "search") {
    const candidate = input.pattern ?? input.query ?? input.path;
    return typeof candidate === "string" ? candidate : "";
  }

  const fallback = input.path ?? input.pattern;
  return typeof fallback === "string" ? fallback : "";
}

export function getBashCommand(toolCall: ToolCall): string {
  const input = toolCall.input as Record<string, unknown>;
  const command = input.command;
  return typeof command === "string" ? command : "";
}

export function parseBashExitCode(toolCall: ToolCall): number | null {
  const output = toolCall.output;

  if (output && typeof output === "object" && !Array.isArray(output)) {
    const record = output as Record<string, unknown>;

    if (typeof record.exitCode === "number") {
      return record.exitCode;
    }

    if (record.details && typeof record.details === "object") {
      const details = record.details as Record<string, unknown>;
      if (typeof details.exitCode === "number") {
        return details.exitCode;
      }
    }
  }

  const outputText = extractToolOutputText(output);
  const outputMatch = outputText.match(/Command exited with code\s+(\d+)/i);
  if (outputMatch) {
    return Number.parseInt(outputMatch[1], 10);
  }

  const errorText = parseToolError(toolCall.error);
  if (errorText) {
    const errorMatch = errorText.match(/Command exited with code\s+(\d+)/i);
    if (errorMatch) {
      return Number.parseInt(errorMatch[1], 10);
    }
  }

  return null;
}

export function getBashOutputText(toolCall: ToolCall): string {
  const outputText = extractToolOutputText(toolCall.output);
  if (outputText) {
    return outputText;
  }

  return parseToolError(toolCall.error) ?? "";
}

export function hasOutput(toolCall: ToolCall): boolean {
  return toolCall.output !== null && toolCall.output !== undefined;
}

export function hasError(toolCall: ToolCall): boolean {
  return Boolean(parseToolError(toolCall.error));
}
