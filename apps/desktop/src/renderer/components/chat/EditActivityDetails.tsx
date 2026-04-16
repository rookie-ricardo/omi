import type { ToolCall } from "@omi/core";

import { extractDiffFromToolCall, getEditFilePath, parseDiffStats } from "./tool-utils";

interface EditActivityDetailsProps {
  toolCalls: ToolCall[];
}

interface FileEditInfo {
  filePath: string;
  additions: number;
  deletions: number;
  order: number;
}

/**
 * 编辑活动详情面板
 * 显示已编辑文件列表及 diff 统计
 */
export default function EditActivityDetails({
  toolCalls,
}: EditActivityDetailsProps) {
  const fileEdits: FileEditInfo[] = [];

  for (const [index, tool] of toolCalls.entries()) {
    const name = tool.toolName.toLowerCase();
    if (name.includes("edit") || name.includes("write")) {
      const filePath = getEditFilePath(tool);
      if (!filePath) continue;

      const diff = extractDiffFromToolCall(tool);
      const stats = diff ? parseDiffStats(diff) : { additions: 0, deletions: 0 };

      fileEdits.push({ filePath, ...stats, order: index });
    }
  }

  const uniqueEdits = new Map<string, FileEditInfo>();
  for (const edit of fileEdits) {
    const existing = uniqueEdits.get(edit.filePath);
    if (existing) {
      existing.additions += edit.additions;
      existing.deletions += edit.deletions;
    } else {
      uniqueEdits.set(edit.filePath, { ...edit });
    }
  }

  const edits = Array.from(uniqueEdits.values()).sort((a, b) => a.order - b.order);

  if (edits.length === 0) {
    return null;
  }

  return (
    <div className="space-y-1">
      {edits.map((edit) => (
        <div
          key={edit.filePath}
          className="text-[15px] leading-6 text-gray-500 dark:text-gray-400"
        >
          <span className="text-gray-500 dark:text-gray-400">已编辑 </span>
          <span className="text-blue-500 dark:text-blue-400">{edit.filePath}</span>
          <span className="ml-1 inline-flex items-center gap-1.5">
            {edit.additions > 0 ? (
              <span className="text-green-600 dark:text-green-400">
                +{edit.additions}
              </span>
            ) : null}
            {edit.deletions > 0 ? (
              <span className="text-red-600 dark:text-red-400">
                -{edit.deletions}
              </span>
            ) : null}
          </span>
        </div>
      ))}
    </div>
  );
}
