import type { ToolCall } from "@omi/core";

import {
  getBashCommand,
  getBashOutputText,
  parseBashExitCode,
  parseToolError,
} from "./tool-utils";

interface BashActivityDetailsProps {
  toolCalls: ToolCall[];
  isActive: boolean;
}

export default function BashActivityDetails({
  toolCalls,
  isActive,
}: BashActivityDetailsProps) {
  return (
    <div className="space-y-3">
      {toolCalls.map((toolCall) => (
        <BashDetailCard key={toolCall.id} toolCall={toolCall} isActive={isActive} />
      ))}
    </div>
  );
}

interface BashDetailCardProps {
  toolCall: ToolCall;
  isActive: boolean;
}

function BashDetailCard({ toolCall, isActive }: BashDetailCardProps) {
  const command = getBashCommand(toolCall) || "bash";
  const errorText = parseToolError(toolCall.error);
  const outputText = getBashOutputText(toolCall);
  const exitCode = parseBashExitCode(toolCall);
  const running = isActive && !outputText && !errorText;

  const statusText = (() => {
    if (running) {
      return "执行中";
    }
    if (exitCode !== null) {
      return exitCode === 0 ? "成功" : `退出码 ${exitCode}`;
    }
    if (errorText) {
      return "失败";
    }
    return "成功";
  })();

  const statusClassName =
    statusText === "成功"
      ? "text-green-600 dark:text-green-400"
      : statusText === "执行中"
        ? "text-blue-500 dark:text-blue-400"
        : "text-gray-500 dark:text-gray-400";

  return (
    <div className="space-y-1.5">
      <div className="text-[15px] leading-6 text-gray-500 dark:text-gray-400 truncate" title={command}>
        Ran {command}
      </div>
      <div className="rounded-xl overflow-hidden border border-gray-200 dark:border-white/10 bg-[#efefef] dark:bg-[#2a2a2a]">
        <div className="px-3 py-1.5 text-[15px] text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-white/10">
          Shell
        </div>
        <pre className="m-0 p-3 text-[15px] leading-6 text-gray-700 dark:text-gray-300 whitespace-pre-wrap max-h-[280px] overflow-y-auto custom-scrollbar">
          {`$ ${command}${outputText ? `\n\n${outputText}` : ""}`}
        </pre>
        <div className={`px-3 pb-2 text-xs text-right ${statusClassName}`}>
          {statusText}
        </div>
      </div>
    </div>
  );
}
