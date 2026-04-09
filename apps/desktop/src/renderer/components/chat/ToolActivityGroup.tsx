import { useEffect, useState } from "react";
import { FileEdit, FileSearch, Loader2, TerminalSquare, Wrench } from "lucide-react";

import type { ToolCall } from "@omi/core";

import BashActivityDetails from "./BashActivityDetails";
import EditActivityDetails from "./EditActivityDetails";
import ExploreActivityDetails from "./ExploreActivityDetails";
import {
  getBashSummaryText,
  getEditSummaryText,
  getExploreSummaryText,
  getMixedSummaryText,
  getToolGroupType,
  hasError,
} from "./tool-utils";

interface ToolActivityGroupProps {
  toolCalls: ToolCall[];
  activeToolIds: Set<string>;
}

export default function ToolActivityGroup({
  toolCalls,
  activeToolIds,
}: ToolActivityGroupProps) {
  const groupType = getToolGroupType(toolCalls);
  const [expanded, setExpanded] = useState(false);

  // 检查组内是否有活跃工具
  const hasActive = toolCalls.some((t) => activeToolIds.has(t.id));

  // 如果组内有活跃工具，自动展开
  useEffect(() => {
    if (hasActive) {
      setExpanded(true);
    }
  }, [hasActive]);

  // 检查组内是否有错误
  const hasErrorInGroup = toolCalls.some(hasError);

  // 检查组内是否已完成（有输出）
  const hasCompleted = toolCalls.some((t) => t.output !== null);

  // 获取摘要文本
  const getSummaryText = (): string => {
    switch (groupType) {
      case "explore":
        return getExploreSummaryText(toolCalls);
      case "edit":
        return getEditSummaryText(toolCalls);
      case "bash":
        return getBashSummaryText(toolCalls);
      case "mixed":
        return getMixedSummaryText(toolCalls);
    }
  };

  // 获取组图标
  const getGroupIcon = () => {
    switch (groupType) {
      case "explore":
        return <FileSearch size={14} />;
      case "edit":
        return <FileEdit size={14} />;
      case "bash":
        return <TerminalSquare size={14} />;
      case "mixed":
        return <Wrench size={14} />;
    }
  };

  return (
    <div className="group/tool-activity py-0.5">
      {/* 摘要行 - 更紧凑的 pill 样式 */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5 rounded-full cursor-pointer transition-colors"
      >
        <span className="text-gray-400 dark:text-gray-500 flex-shrink-0">
          {getGroupIcon()}
        </span>
        <span>{getSummaryText()}</span>
        <span className="flex-shrink-0">
          {hasActive ? (
            <Loader2 size={10} className="text-blue-500 animate-spin" />
          ) : hasErrorInGroup ? (
            <span className="text-red-500 text-[10px]">失败</span>
          ) : hasCompleted ? (
            <span className="text-green-500 text-[10px]">✓</span>
          ) : null}
        </span>
      </button>

      {/* 展开的详情面板 - 更紧凑的内联展示 */}
      {expanded ? (
        <div className="mt-1 pl-5">
          {groupType === "explore" ? (
            <ExploreActivityDetails toolCalls={toolCalls} />
          ) : groupType === "edit" ? (
            <EditActivityDetails toolCalls={toolCalls} />
          ) : groupType === "bash" ? (
            <BashActivityDetails toolCalls={toolCalls} isActive={hasActive} />
          ) : (
            <MixedActivityDetails toolCalls={toolCalls} isActive={hasActive} />
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * 混合活动详情面板
 * 按类型分组显示各种工具调用
 */
interface MixedActivityDetailsProps {
  toolCalls: ToolCall[];
  isActive: boolean;
}

function MixedActivityDetails({ toolCalls, isActive }: MixedActivityDetailsProps) {
  // 按类型分组
  const exploreTools: ToolCall[] = [];
  const editTools: ToolCall[] = [];
  const bashTools: ToolCall[] = [];
  const otherTools: ToolCall[] = [];

  for (const tool of toolCalls) {
    const name = tool.toolName.toLowerCase();
    if (name.includes("bash") || name.includes("shell") || name.includes("command")) {
      bashTools.push(tool);
    } else if (name.includes("edit") || name.includes("write")) {
      editTools.push(tool);
    } else if (name.includes("read") || name.includes("glob") || name.includes("grep")) {
      exploreTools.push(tool);
    } else {
      otherTools.push(tool);
    }
  }

  return (
    <div className="space-y-2">
      {exploreTools.length > 0 ? (
        <ExploreActivityDetails toolCalls={exploreTools} />
      ) : null}
      {editTools.length > 0 ? (
        <EditActivityDetails toolCalls={editTools} />
      ) : null}
      {bashTools.length > 0 ? (
        <BashActivityDetails toolCalls={bashTools} isActive={isActive} />
      ) : null}
      {otherTools.length > 0 ? (
        <OtherToolsDetails toolCalls={otherTools} />
      ) : null}
    </div>
  );
}

/**
 * 其他类型工具的详情面板
 */
function OtherToolsDetails({ toolCalls }: { toolCalls: ToolCall[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {toolCalls.map((tool) => (
        <div
          key={tool.id}
          className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-gray-100 dark:bg-white/5 text-xs text-gray-600 dark:text-gray-400"
        >
          <Wrench size={10} className="text-gray-400 dark:text-gray-500" />
          <span className="truncate max-w-[150px]">{tool.toolName}</span>
          {tool.error ? (
            <span className="text-red-500 dark:text-red-400 text-[10px]">失败</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
