import { FileSearch, Search } from "lucide-react";

import type { ToolCall } from "@omi/core";

import { getExplorePathOrPattern } from "./tool-utils";

interface ExploreActivityDetailsProps {
  toolCalls: ToolCall[];
}

/**
 * 探索活动详情面板
 * 显示已读取的文件和搜索模式
 */
export default function ExploreActivityDetails({
  toolCalls,
}: ExploreActivityDetailsProps) {
  // 分类：读取的文件 vs 搜索模式
  const readTools: ToolCall[] = [];
  const searchTools: ToolCall[] = [];

  for (const tool of toolCalls) {
    const name = tool.toolName.toLowerCase();
    if (name.includes("read") || name.includes("glob")) {
      readTools.push(tool);
    } else if (name.includes("grep")) {
      searchTools.push(tool);
    }
  }

  // 去重文件路径和搜索模式
  const filePaths = new Set<string>();
  for (const tool of readTools) {
    const path = getExplorePathOrPattern(tool);
    if (path) filePaths.add(path);
  }

  const patterns = new Set<string>();
  for (const tool of searchTools) {
    const pattern = getExplorePathOrPattern(tool);
    if (pattern) patterns.add(pattern);
  }

  const hasContent = filePaths.size > 0 || patterns.size > 0;

  if (!hasContent) {
    return (
      <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
        没有可显示的详细信息
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {filePaths.size > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {Array.from(filePaths).map((path) => (
            <div
              key={path}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-gray-100 dark:bg-white/5 text-xs text-gray-600 dark:text-gray-400"
            >
              <FileSearch size={10} className="text-gray-400 dark:text-gray-500 flex-shrink-0" />
              <span className="font-mono truncate max-w-[200px]">{path}</span>
            </div>
          ))}
        </div>
      ) : null}

      {patterns.size > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {Array.from(patterns).map((pattern) => (
            <div
              key={pattern}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-gray-100 dark:bg-white/5 text-xs text-gray-600 dark:text-gray-400"
            >
              <Search size={10} className="text-gray-400 dark:text-gray-500 flex-shrink-0" />
              <span className="font-mono truncate max-w-[200px]">{pattern}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
