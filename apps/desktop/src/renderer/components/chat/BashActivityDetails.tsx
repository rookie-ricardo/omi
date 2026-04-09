import { Check, X } from "lucide-react";

import type { ToolCall } from "@omi/core";

import { formatToolOutput } from "./tool-utils";

interface BashActivityDetailsProps {
  toolCalls: ToolCall[];
  isActive: boolean;
}

export default function BashActivityDetails({
  toolCalls,
  isActive,
}: BashActivityDetailsProps) {
  return (
    <div className="space-y-1">
      {toolCalls.map((tool) => (
        <BashInlineBlock
          key={tool.id}
          toolCall={tool}
          isActive={isActive}
        />
      ))}
    </div>
  );
}

interface BashInlineBlockProps {
  toolCall: ToolCall;
  isActive: boolean;
}

function BashInlineBlock({ toolCall, isActive }: BashInlineBlockProps) {
  const command =
    typeof toolCall.input.command === "string" ? toolCall.input.command : "";

  // 提取 stdout
  let output = "";
  if (
    toolCall.output &&
    typeof toolCall.output === "object" &&
    !Array.isArray(toolCall.output)
  ) {
    const record = toolCall.output as Record<string, unknown>;
    if (typeof record.stdout === "string") {
      output = record.stdout;
    } else if (typeof record.output === "string") {
      output = record.output;
    }
  } else if (typeof toolCall.output === "string") {
    output = toolCall.output;
  }

  const hasError = toolCall.error !== null;
  const isCompleted = !isActive && toolCall.output !== null;

  return (
    <div className="flex items-start gap-2 text-xs">
      <div className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400 flex-shrink-0 pt-0.5">
        <span className="text-gray-400">$</span>
        <span className="font-mono text-green-600 dark:text-green-400 truncate max-w-[300px]">
          {command || "..."}
        </span>
      </div>
      <div className="flex items-center gap-1">
        {isActive ? (
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
        ) : hasError ? (
          <X size={10} className="text-red-500" />
        ) : isCompleted ? (
          <Check size={10} className="text-green-500" />
        ) : null}
      </div>
      {output && !hasError ? (
        <span className="text-gray-500 dark:text-gray-400 truncate max-w-[200px]">
          {output.split('\n')[0]}
          {output.includes('\n') ? '...' : ''}
        </span>
      ) : null}
      {hasError ? (
        <span className="text-red-500 dark:text-red-400 truncate max-w-[200px]">
          {toolCall.error}
        </span>
      ) : null}
    </div>
  );
}
