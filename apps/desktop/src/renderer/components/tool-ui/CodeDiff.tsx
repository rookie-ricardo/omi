import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, FileCode2 } from "lucide-react";

import { cn } from "../../lib/cn";

const COLLAPSE_LINES = 80;

interface CodeDiffProps {
  id: string;
  filePath?: string | null;
  diff: string | null;
  fallbackCode?: string;
}

function parseStats(diff: string): { additions: number; deletions: number } {
  const lines = diff.split("\n");
  let additions = 0;
  let deletions = 0;

  for (const line of lines) {
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) {
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("++")) {
      additions += 1;
    }
    if (line.startsWith("-") && !line.startsWith("--")) {
      deletions += 1;
    }
  }

  return { additions, deletions };
}

function diffLineClass(line: string): string {
  if (line.startsWith("@@")) {
    return "text-blue-300 bg-blue-500/10";
  }
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return "text-green-300 bg-green-500/10";
  }
  if (line.startsWith("-") && !line.startsWith("---")) {
    return "text-red-300 bg-red-500/10";
  }
  if (line.startsWith("+++") || line.startsWith("---")) {
    return "text-indigo-300 bg-indigo-500/10";
  }
  return "text-gray-300";
}

export default function CodeDiff({ id, filePath, diff, fallbackCode }: CodeDiffProps) {
  const [expanded, setExpanded] = useState(false);

  const effectiveDiff = (diff && diff.trim().length > 0) ? diff : null;
  const lines = useMemo(() => (effectiveDiff ? effectiveDiff.split("\n") : []), [effectiveDiff]);
  const stats = useMemo(() => (effectiveDiff ? parseStats(effectiveDiff) : { additions: 0, deletions: 0 }), [effectiveDiff]);

  const collapsible = lines.length > COLLAPSE_LINES;
  const visibleLines = !collapsible || expanded ? lines : lines.slice(0, COLLAPSE_LINES);

  if (!effectiveDiff) {
    return (
      <div
        data-tool-ui-id={id}
        data-slot="code-diff"
        className="rounded-xl border border-gray-200 dark:border-white/10 bg-[#111318] overflow-hidden"
      >
        <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2 text-gray-300 text-xs">
          <FileCode2 className="size-3.5" />
          <span className="truncate">{filePath ?? "Code Diff"}</span>
        </div>
        <pre className="m-0 p-3 text-[12px] leading-5 text-gray-300 max-h-[360px] overflow-auto custom-scrollbar whitespace-pre-wrap select-text">
          {fallbackCode && fallbackCode.trim().length > 0 ? fallbackCode : "无法解析 diff，输出结构缺少可视化字段。"}
        </pre>
      </div>
    );
  }

  return (
    <div
      data-tool-ui-id={id}
      data-slot="code-diff"
      className="rounded-xl border border-gray-200 dark:border-white/10 bg-[#111318] overflow-hidden"
    >
      <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between gap-2 text-xs">
        <div className="inline-flex items-center gap-2 min-w-0">
          <FileCode2 className="size-3.5 text-gray-300" />
          <span className="truncate text-gray-200">{filePath ?? "Code Diff"}</span>
        </div>
        <div className="inline-flex items-center gap-2 font-mono">
          <span className="text-green-300">+{stats.additions}</span>
          <span className="text-red-300">-{stats.deletions}</span>
        </div>
      </div>

      <div className="max-h-[420px] overflow-auto custom-scrollbar">
        <pre className="m-0 p-3 text-[12px] leading-5 font-mono whitespace-pre select-text">
          {visibleLines.map((line, index) => (
            <div key={`${id}-${index}`} className={cn("px-1 -mx-1", diffLineClass(line))}>
              {line || " "}
            </div>
          ))}
        </pre>
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
              <ChevronDown className="size-3.5" /> 展开剩余 {lines.length - COLLAPSE_LINES} 行
            </>
          )}
        </button>
      ) : null}
    </div>
  );
}
