import { FileEdit } from "lucide-react";

import type { ToolCall } from "@omi/core";

import { extractDiffFromToolCall, getEditFilePath, parseDiffStats } from "./tool-utils";

interface EditActivityDetailsProps {
  toolCalls: ToolCall[];
}

interface FileEditInfo {
  filePath: string;
  additions: number;
  deletions: number;
}

/**
 * 编辑活动详情面板
 * 显示已编辑文件列表及 diff 统计
 */
export default function EditActivityDetails({
  toolCalls,
}: EditActivityDetailsProps) {
  // 提取每个编辑工具的文件路径和 diff 统计
  const fileEdits: FileEditInfo[] = [];

  for (const tool of toolCalls) {
    const name = tool.toolName.toLowerCase();
    if (name.includes("edit") || name.includes("write")) {
      const filePath = getEditFilePath(tool);
      if (!filePath) continue;

      const diff = extractDiffFromToolCall(tool);
      const stats = diff ? parseDiffStats(diff) : { additions: 0, deletions: 0 };

      fileEdits.push({ filePath, ...stats });
    }
  }

  // 去重（同一文件可能被编辑多次）
  const uniqueEdits = new Map<string, FileEditInfo>();
  for (const edit of fileEdits) {
    const existing = uniqueEdits.get(edit.filePath);
    if (existing) {
      // 累加统计
      existing.additions += edit.additions;
      existing.deletions += edit.deletions;
    } else {
      uniqueEdits.set(edit.filePath, { ...edit });
    }
  }

  const edits = Array.from(uniqueEdits.values());

  if (edits.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
        没有可显示的编辑信息
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {edits.map((edit) => (
        <div
          key={edit.filePath}
          className="flex items-center gap-2 px-2 py-0.5 rounded-full bg-gray-100 dark:bg-white/5 text-xs text-gray-600 dark:text-gray-400"
        >
          <FileEdit size={10} className="text-gray-400 dark:text-gray-500 flex-shrink-0" />
          <span className="font-mono truncate max-w-[180px]">{edit.filePath}</span>
          <div className="flex items-center gap-1.5">
            {edit.additions > 0 ? (
              <span className="text-green-600 dark:text-green-400 font-medium text-[10px]">
                +{edit.additions}
              </span>
            ) : null}
            {edit.deletions > 0 ? (
              <span className="text-red-600 dark:text-red-400 font-medium text-[10px]">
                -{edit.deletions}
              </span>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
