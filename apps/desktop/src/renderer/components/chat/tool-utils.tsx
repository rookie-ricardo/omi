import {
  FileEdit,
  FileSearch,
  TerminalSquare,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import type { ToolCall } from "@omi/core";

export type ToolCategory = "explore" | "edit" | "bash" | "other";

export type ToolGroupType = "explore" | "edit" | "bash" | "mixed";

/**
 * 获取工具类型图标
 */
export function getToolIcon(name: string): React.ReactElement {
  const lower = name.toLowerCase();
  if (lower.includes("bash") || lower.includes("shell") || lower.includes("command")) {
    return <TerminalSquare size={14} />;
  }
  if (lower.includes("edit") || lower.includes("write")) {
    return <FileEdit size={14} />;
  }
  if (lower.includes("read") || lower.includes("glob") || lower.includes("grep")) {
    return <FileSearch size={14} />;
  }
  return <Wrench size={14} />;
}

/**
 * 获取工具调用摘要文本
 */
export function getToolSummary(toolCall: ToolCall): string {
  const input = toolCall.input;
  const name = toolCall.toolName.toLowerCase();

  if (name.includes("bash") || name.includes("shell") || name.includes("command")) {
    return typeof input.command === "string" ? input.command : "";
  }
  if (name.includes("edit") || name.includes("write") || name.includes("read")) {
    const path = input.file_path ?? input.path ?? "";
    return typeof path === "string" ? path : "";
  }
  if (name.includes("glob")) {
    return typeof input.pattern === "string" ? input.pattern : "";
  }
  if (name.includes("grep")) {
    return typeof input.pattern === "string" ? input.pattern : "";
  }
  return "";
}

/**
 * 判断单个工具的类别
 */
export function getToolCategory(toolName: string): ToolCategory {
  const lower = toolName.toLowerCase();
  if (lower.includes("bash") || lower.includes("shell") || lower.includes("command")) {
    return "bash";
  }
  if (lower.includes("edit") || lower.includes("write")) {
    return "edit";
  }
  if (lower.includes("read") || lower.includes("glob") || lower.includes("grep")) {
    return "explore";
  }
  return "other";
}

/**
 * 判断一组工具调用的分组类型
 */
export function getToolGroupType(toolCalls: ToolCall[]): ToolGroupType {
  const categories = new Set(toolCalls.map((t) => getToolCategory(t.toolName)));

  // 移除 "other" 类别，因为它不影响主要类型判断
  categories.delete("other");

  if (categories.size === 0) return "mixed";
  if (categories.size === 1) {
    const onlyCategory = Array.from(categories)[0];
    if (onlyCategory === "explore") return "explore";
    if (onlyCategory === "edit") return "edit";
    if (onlyCategory === "bash") return "bash";
  }
  return "mixed";
}

/**
 * 统计工具调用中各类别的数量
 */
export function countToolCategories(toolCalls: ToolCall[]): {
  explore: number;
  edit: number;
  bash: number;
  other: number;
} {
  const counts = { explore: 0, edit: 0, bash: 0, other: 0 };
  for (const tool of toolCalls) {
    const category = getToolCategory(tool.toolName);
    counts[category]++;
  }
  return counts;
}

/**
 * 生成探索活动摘要文本
 */
export function getExploreSummaryText(toolCalls: ToolCall[]): string {
  const counts = countToolCategories(toolCalls);
  const fileCount = toolCalls.filter(
    (t) => t.toolName.toLowerCase().includes("read") || t.toolName.toLowerCase().includes("glob"),
  ).length;
  const searchCount = toolCalls.filter((t) =>
    t.toolName.toLowerCase().includes("grep"),
  ).length;

  if (fileCount > 0 && searchCount > 0) {
    return `探索了 ${fileCount} 个文件，${searchCount} 个搜索`;
  }
  if (fileCount > 0) {
    return `探索了 ${fileCount} 个文件`;
  }
  if (searchCount > 0) {
    return `探索了 ${searchCount} 个搜索`;
  }
  return "探索了文件";
}

/**
 * 生成编辑活动摘要文本
 */
export function getEditSummaryText(toolCalls: ToolCall[]): string {
  const editCount = toolCalls.filter(
    (t) => t.toolName.toLowerCase().includes("edit") || t.toolName.toLowerCase().includes("write"),
  ).length;

  if (editCount === 1) {
    return "编辑了 1 个文件";
  }
  return `编辑了 ${editCount} 个文件`;
}

/**
 * 生成 Bash 活动摘要文本
 */
export function getBashSummaryText(toolCalls: ToolCall[]): string {
  const bashCount = toolCalls.filter(
    (t) =>
      t.toolName.toLowerCase().includes("bash") ||
      t.toolName.toLowerCase().includes("shell") ||
      t.toolName.toLowerCase().includes("command"),
  ).length;

  if (bashCount === 1) {
    return "运行了命令";
  }
  return `运行了 ${bashCount} 个命令`;
}

/**
 * 生成混合活动摘要文本
 */
export function getMixedSummaryText(toolCalls: ToolCall[]): string {
  const counts = countToolCategories(toolCalls);
  const parts: string[] = [];

  if (counts.explore > 0) {
    const fileCount = toolCalls.filter(
      (t) =>
        t.toolName.toLowerCase().includes("read") || t.toolName.toLowerCase().includes("glob"),
    ).length;
    const searchCount = toolCalls.filter((t) => t.toolName.toLowerCase().includes("grep"))
      .length;

    if (fileCount > 0 && searchCount > 0) {
      parts.push(`探索了 ${fileCount} 个文件，${searchCount} 个搜索`);
    } else if (fileCount > 0) {
      parts.push(`探索了 ${fileCount} 个文件`);
    } else if (searchCount > 0) {
      parts.push(`探索了 ${searchCount} 个搜索`);
    }
  }

  if (counts.edit > 0) {
    parts.push(counts.edit === 1 ? "编辑了 1 个文件" : `编辑了 ${counts.edit} 个文件`);
  }

  if (counts.bash > 0) {
    parts.push(counts.bash === 1 ? "运行了命令" : `运行了 ${counts.bash} 个命令`);
  }

  if (parts.length === 0) {
    return "执行了操作";
  }

  return parts.join("，");
}

/**
 * 解析 diff 字符串，获取增删行数
 */
export function parseDiffStats(diff: string): { additions: number; deletions: number } {
  const lines = diff.split("\n");
  let additions = 0;
  let deletions = 0;

  for (const line of lines) {
    // 跳过 diff 头部 (如 +++ / --- / @@ )
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) {
      continue;
    }
    // 统计以 + 开头的行（新增）
    if (line.startsWith("+") && !line.startsWith("++")) {
      additions++;
    }
    // 统计以 - 开头的行（删除）
    if (line.startsWith("-") && !line.startsWith("--")) {
      deletions++;
    }
  }

  return { additions, deletions };
}

/**
 * 从工具调用输出中提取 diff 字符串
 */
export function extractDiffFromToolCall(toolCall: ToolCall): string | null {
  if (!toolCall.output) return null;

  const output = toolCall.output;
  if (typeof output === "string") {
    // 检查是否是 diff 格式
    if (output.startsWith("---") || output.includes("@@")) {
      return output;
    }
  }

  if (typeof output === "object" && output !== null && !Array.isArray(output)) {
    const record = output as Record<string, unknown>;
    // 尝试从 details.diff 中获取
    if (
      typeof record.details === "object" &&
      record.details !== null &&
      !Array.isArray(record.details)
    ) {
      const details = record.details as Record<string, unknown>;
      if (typeof details.diff === "string") {
        return details.diff;
      }
    }
    // 尝试直接从 diff 字段获取
    if (typeof record.diff === "string") {
      return record.diff;
    }
  }

  return null;
}

/**
 * 格式化工具输出为字符串
 */
export function formatToolOutput(output: unknown): string {
  if (typeof output === "string") {
    return output;
  }
  if (typeof output === "number" || typeof output === "boolean") {
    return String(output);
  }
  if (output === null || output === undefined) {
    return "";
  }
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
}

/**
 * 获取编辑工具的文件路径
 */
export function getEditFilePath(toolCall: ToolCall): string {
  const input = toolCall.input;
  const path = input.file_path ?? input.path ?? "";
  return typeof path === "string" ? path : "";
}

/**
 * 获取探索工具的文件路径或模式
 */
export function getExplorePathOrPattern(toolCall: ToolCall): string {
  const input = toolCall.input;
  const name = toolCall.toolName.toLowerCase();

  if (name.includes("read")) {
    const path = input.file_path ?? input.path ?? "";
    return typeof path === "string" ? path : "";
  }
  if (name.includes("glob") || name.includes("grep")) {
    return typeof input.pattern === "string" ? input.pattern : "";
  }
  return "";
}

/**
 * 判断工具调用是否有输出
 */
export function hasOutput(toolCall: ToolCall): boolean {
  return toolCall.output !== null && toolCall.output !== undefined;
}

/**
 * 判断工具调用是否失败
 */
export function hasError(toolCall: ToolCall): boolean {
  return toolCall.error !== null;
}
