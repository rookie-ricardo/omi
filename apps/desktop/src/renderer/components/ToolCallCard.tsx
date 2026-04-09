import { useState, useEffect } from "react";
import {
  ChevronRight,
  ChevronDown,
  Check,
  X,
  Loader2,
  TerminalSquare,
  FileEdit,
  FileSearch,
  Wrench,
} from "lucide-react";

import type { ToolCall } from "@omi/core";

interface ActiveTool {
  toolCallId: string;
  toolName: string;
}

interface ToolCallCardProps {
  toolCall: ToolCall;
  isActive?: boolean;
}

function getToolIcon(name: string) {
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

function getToolSummary(toolCall: ToolCall): string {
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

function getEditStats(toolCall: ToolCall): string | null {
  if (!toolCall.output) return null;
  const name = toolCall.toolName.toLowerCase();
  if (name.includes("edit")) {
    return "已编辑";
  }
  return null;
}

function formatToolOutput(output: unknown): string {
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

export default function ToolCallCard({ toolCall, isActive }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(isActive ?? false);

  useEffect(() => {
    if (isActive) {
      setExpanded(true);
    } else {
      setExpanded(false);
    }
  }, [isActive]);

  const hasError = toolCall.error !== null;
  const isCompleted = !isActive && toolCall.output !== null;
  const summary = getToolSummary(toolCall);
  const editStats = getEditStats(toolCall);

  return (
    <div className="rounded-lg border border-gray-200 dark:border-white/10 overflow-hidden transition-colors">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-[#252525] hover:bg-gray-100 dark:hover:bg-[#2a2a2a] transition-colors text-left"
      >
        {expanded ? (
          <ChevronDown size={14} className="text-gray-400 flex-shrink-0" />
        ) : (
          <ChevronRight size={14} className="text-gray-400 flex-shrink-0" />
        )}

        <span className="text-gray-500 dark:text-gray-400 flex-shrink-0">
          {getToolIcon(toolCall.toolName)}
        </span>

        <span className="text-sm font-medium text-gray-700 dark:text-gray-200 flex-shrink-0">
          {toolCall.toolName}
        </span>

        {summary ? (
          <span className="text-xs text-gray-500 dark:text-gray-400 truncate font-mono min-w-0">
            {summary}
          </span>
        ) : null}

        {editStats ? (
          <span className="text-xs text-blue-500 dark:text-blue-400 flex-shrink-0">
            {editStats}
          </span>
        ) : null}

        <span className="ml-auto flex-shrink-0">
          {isActive ? (
            <Loader2 size={14} className="text-blue-500 animate-spin" />
          ) : hasError ? (
            <X size={14} className="text-red-500" />
          ) : isCompleted ? (
            <Check size={14} className="text-green-500" />
          ) : null}
        </span>
      </button>

      {expanded ? (
        <div className="border-t border-gray-200 dark:border-white/10">
          <ToolCallBody toolCall={toolCall} isActive={isActive} />
        </div>
      ) : null}
    </div>
  );
}

function ToolCallBody({
  toolCall,
  isActive,
}: {
  toolCall: ToolCall;
  isActive?: boolean;
}) {
  const name = toolCall.toolName.toLowerCase();
  const isBash =
    name.includes("bash") || name.includes("shell") || name.includes("command");

  if (isBash) {
    return <BashBody toolCall={toolCall} isActive={isActive} />;
  }

  return <GenericBody toolCall={toolCall} isActive={isActive} />;
}

function BashBody({
  toolCall,
  isActive,
}: {
  toolCall: ToolCall;
  isActive?: boolean;
}) {
  const command =
    typeof toolCall.input.command === "string" ? toolCall.input.command : "";
  const output =
    toolCall.output &&
    typeof toolCall.output === "object" &&
    !Array.isArray(toolCall.output) &&
    typeof (toolCall.output as Record<string, unknown>).stdout === "string"
      ? String((toolCall.output as Record<string, unknown>).stdout)
      : formatToolOutput(toolCall.output);

  return (
    <div className="bg-[#1e1e1e] text-gray-300 text-xs font-mono">
      {command ? (
        <div className="px-3 py-2 border-b border-white/5">
          <span className="text-gray-500">$ </span>
          <span className="text-green-400">{command}</span>
        </div>
      ) : null}
      {output || toolCall.error ? (
        <div className="px-3 py-2 max-h-[200px] overflow-y-auto custom-scrollbar whitespace-pre-wrap">
          {toolCall.error ? (
            <span className="text-red-400">{toolCall.error}</span>
          ) : (
            output
          )}
        </div>
      ) : null}
      {isActive && !output ? (
        <div className="px-3 py-2">
          <span className="inline-block w-2 h-3 bg-gray-400 animate-pulse" />
        </div>
      ) : null}
    </div>
  );
}

function GenericBody({
  toolCall,
  isActive,
}: {
  toolCall: ToolCall;
  isActive?: boolean;
}) {
  return (
    <div className="text-xs font-mono">
      <div className="px-3 py-2 bg-gray-50 dark:bg-[#1e1e1e] border-b border-gray-200 dark:border-white/5">
        <div className="text-gray-500 dark:text-gray-400 mb-1">输入</div>
        <pre className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap max-h-[120px] overflow-y-auto custom-scrollbar">
          {JSON.stringify(toolCall.input, null, 2)}
        </pre>
      </div>
      {toolCall.output !== null || toolCall.error ? (
        <div className="px-3 py-2 bg-gray-50 dark:bg-[#1e1e1e]">
          <div className="text-gray-500 dark:text-gray-400 mb-1">
            {toolCall.error ? "错误" : "输出"}
          </div>
          <pre
            className={`whitespace-pre-wrap max-h-[200px] overflow-y-auto custom-scrollbar ${
              toolCall.error
                ? "text-red-500 dark:text-red-400"
                : "text-gray-700 dark:text-gray-300"
            }`}
          >
            {toolCall.error ?? formatToolOutput(toolCall.output)}
          </pre>
        </div>
      ) : isActive ? (
        <div className="px-3 py-2 bg-gray-50 dark:bg-[#1e1e1e]">
          <span className="inline-block w-2 h-3 bg-gray-400 dark:bg-gray-500 animate-pulse" />
        </div>
      ) : null}
    </div>
  );
}

export function ActiveToolIndicator({ tools }: { tools: ActiveTool[] }) {
  if (tools.length === 0) return null;

  return (
    <div className="space-y-2">
      {tools.map((tool) => (
        <div
          key={tool.toolCallId}
          className="rounded-lg border border-blue-200 dark:border-blue-400/20 bg-blue-50/50 dark:bg-blue-500/5 px-3 py-2 flex items-center gap-2"
        >
          <Loader2 size={14} className="text-blue-500 animate-spin flex-shrink-0" />
          <span className="text-sm text-blue-700 dark:text-blue-300">
            正在执行: {tool.toolName}
          </span>
        </div>
      ))}
    </div>
  );
}
