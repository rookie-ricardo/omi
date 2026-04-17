import { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronUp, Copy, Loader2 } from "lucide-react";

import { cn } from "../../lib/cn";
import type { NormalizedToolCallStatus } from "./models";

const MAX_COLLAPSED_LINES = 36;

interface TerminalProps {
  id: string;
  status: NormalizedToolCallStatus;
  command: string;
  stdout: string;
  stderr: string;
  cwd?: string | null;
  exitCode?: number | null;
  outputTruncated?: boolean;
}

function countLines(value: string): number {
  const trimmed = value.replace(/\n+$/g, "");
  if (!trimmed) {
    return 0;
  }
  return trimmed.split("\n").length;
}

export default function Terminal({
  id,
  status,
  command,
  stdout,
  stderr,
  cwd,
  exitCode,
  outputTruncated,
}: TerminalProps) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const fullOutput = useMemo(
    () => [stdout, stderr].filter((segment) => Boolean(segment)).join("\n\n"),
    [stdout, stderr],
  );

  const hasOutput = fullOutput.length > 0;
  const lineCount = countLines(fullOutput);
  const collapsible = lineCount > MAX_COLLAPSED_LINES;
  const displayOutput = !collapsible || expanded
    ? fullOutput
    : fullOutput.split("\n").slice(0, MAX_COLLAPSED_LINES).join("\n");

  async function handleCopy() {
    if (!hasOutput) {
      return;
    }
    await navigator.clipboard.writeText(fullOutput);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div
      data-tool-ui-id={id}
      data-slot="terminal"
      className="rounded-xl border border-gray-200 dark:border-white/10 overflow-hidden bg-[#0f1116] text-gray-200"
    >
      <div className="px-3 py-2 bg-black/20 border-b border-white/10 flex items-center justify-between gap-3">
        <code className="text-[12px] text-gray-300 truncate">
          {cwd ? `${cwd}$ ` : "$ "}
          {command || "(no command)"}
        </code>
        <div className="flex items-center gap-2">
          {status === "running" ? <Loader2 className="size-3.5 text-blue-300 animate-spin" /> : null}
          {typeof exitCode === "number" ? (
            <span className={cn(
              "text-[11px] font-mono",
              exitCode === 0 ? "text-green-300" : "text-red-300",
            )}>
              {exitCode}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="inline-flex items-center justify-center size-6 rounded-md hover:bg-white/10 transition-colors"
            title={copied ? "已复制" : "复制输出"}
          >
            {copied ? <Check className="size-3.5 text-green-300" /> : <Copy className="size-3.5 text-gray-300" />}
          </button>
        </div>
      </div>

      <div className="px-3 py-2 text-[12px] font-mono leading-5 max-h-[380px] overflow-auto custom-scrollbar select-text whitespace-pre-wrap">
        {!hasOutput ? (
          status === "running" ? (
            <span className="inline-flex items-center gap-2 text-gray-400">
              <Loader2 className="size-3.5 animate-spin" />
              <span>命令执行中...</span>
            </span>
          ) : (
            <span className="text-gray-500">无输出</span>
          )
        ) : (
          <>
            {displayOutput}
            {outputTruncated ? (
              <div className="mt-2 text-amber-300">输出已截断，完整日志请在工作区查看。</div>
            ) : null}
            {collapsible && !expanded ? (
              <div className="mt-2 text-gray-500">已折叠，点击展开查看更多。</div>
            ) : null}
          </>
        )}
      </div>

      {collapsible ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="w-full h-8 border-t border-white/10 text-[12px] text-gray-300 hover:bg-white/5 transition-colors inline-flex items-center justify-center gap-1"
        >
          {expanded ? (
            <>
              <ChevronUp className="size-3.5" /> 折叠
            </>
          ) : (
            <>
              <ChevronDown className="size-3.5" /> 展开全部 {lineCount} 行
            </>
          )}
        </button>
      ) : null}
    </div>
  );
}
