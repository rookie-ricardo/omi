import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";

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

export default function ToolActivityGroup({ toolCalls, activeToolIds }: ToolActivityGroupProps) {
  const groupType = getToolGroupType(toolCalls);
  const [expanded, setExpanded] = useState(true);

  const hasActive = toolCalls.some((toolCall) => activeToolIds.has(toolCall.id));
  const hasFailed = toolCalls.some(hasError);

  const summaryText = (() => {
    if (groupType === "explore") {
      return getExploreSummaryText(toolCalls);
    }
    if (groupType === "edit") {
      return getEditSummaryText(toolCalls);
    }
    if (groupType === "bash") {
      return getBashSummaryText(toolCalls);
    }
    return getMixedSummaryText(toolCalls);
  })();

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="inline-flex items-center gap-1.5 text-[15px] leading-6 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
      >
        {expanded ? (
          <ChevronDown size={14} className="text-gray-400 dark:text-gray-500" />
        ) : (
          <ChevronRight size={14} className="text-gray-400 dark:text-gray-500" />
        )}
        <span>{summaryText}</span>
        {hasActive ? (
          <Loader2 size={12} className="text-blue-500 animate-spin" />
        ) : hasFailed ? (
          <span className="text-[13px] text-red-500 dark:text-red-400">失败</span>
        ) : null}
      </button>

      {expanded ? (
        <div className="pl-5 space-y-2">
          {groupType === "explore" ? (
            <ExploreActivityDetails toolCalls={toolCalls} />
          ) : groupType === "edit" ? (
            <EditActivityDetails toolCalls={toolCalls} />
          ) : groupType === "bash" ? (
            <BashActivityDetails toolCalls={toolCalls} isActive={hasActive} />
          ) : (
            <MixedDetails toolCalls={toolCalls} isActive={hasActive} />
          )}
        </div>
      ) : null}
    </div>
  );
}

interface MixedDetailsProps {
  toolCalls: ToolCall[];
  isActive: boolean;
}

function MixedDetails({ toolCalls, isActive }: MixedDetailsProps) {
  const explore = toolCalls.filter((toolCall) => {
    const name = toolCall.toolName.toLowerCase();
    return (
      name.includes("read") ||
      name.includes("grep") ||
      name.includes("search") ||
      name.includes("glob") ||
      name.includes("ls") ||
      name.includes("find")
    );
  });

  const edit = toolCalls.filter((toolCall) => {
    const name = toolCall.toolName.toLowerCase();
    return name.includes("edit") || name.includes("write");
  });

  const bash = toolCalls.filter((toolCall) => {
    const name = toolCall.toolName.toLowerCase();
    return name.includes("bash") || name.includes("shell") || name.includes("command");
  });

  return (
    <div className="space-y-2">
      {explore.length > 0 ? <ExploreActivityDetails toolCalls={explore} /> : null}
      {edit.length > 0 ? <EditActivityDetails toolCalls={edit} /> : null}
      {bash.length > 0 ? <BashActivityDetails toolCalls={bash} isActive={isActive} /> : null}
    </div>
  );
}
