import { useState } from "react";
import { ChevronDown, ChevronRight, Wrench, Loader2 } from "lucide-react";

import { cn } from "../../lib/cn";
import CodeDiff from "./CodeDiff";
import Receipt from "./Receipt";
import Terminal from "./Terminal";
import type { NormalizedToolCallViewModel } from "./models";

interface ToolCallPanelProps {
  viewModel: NormalizedToolCallViewModel;
}

function statusClass(status: NormalizedToolCallViewModel["status"]): string {
  switch (status) {
    case "running":
      return "text-blue-600 dark:text-blue-300";
    case "failed":
      return "text-red-600 dark:text-red-300";
    case "canceled":
      return "text-gray-600 dark:text-gray-300";
    case "requires_action":
      return "text-amber-600 dark:text-amber-300";
    default:
      return "text-green-600 dark:text-green-300";
  }
}

function renderBody(viewModel: NormalizedToolCallViewModel) {
  if (viewModel.kind === "terminal") {
    return (
      <Terminal
        id={`terminal-${viewModel.id}`}
        status={viewModel.status}
        command={viewModel.command ?? viewModel.toolName}
        cwd={viewModel.cwd}
        stdout={viewModel.stdout || viewModel.outputPreview}
        stderr={viewModel.stderr || (viewModel.errorText ?? "")}
        exitCode={viewModel.exitCode}
        outputTruncated={viewModel.outputTruncated}
      />
    );
  }

  if (viewModel.kind === "code-diff") {
    return (
      <CodeDiff
        id={`codediff-${viewModel.id}`}
        filePath={viewModel.filePath}
        diff={viewModel.diff}
        fallbackCode={viewModel.outputPreview || viewModel.inputPreview}
      />
    );
  }

  return (
    <div
      data-tool-ui-id={`generic-${viewModel.id}`}
      data-slot="tool-call-generic"
      className="rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1e1e1e] overflow-hidden"
    >
      <div className="px-3 py-2 border-b border-gray-200 dark:border-white/10 text-xs text-gray-500 dark:text-gray-400">
        输入
      </div>
      <pre className="m-0 p-3 text-[12px] leading-5 text-gray-700 dark:text-gray-200 max-h-[220px] overflow-auto custom-scrollbar whitespace-pre-wrap select-text">
        {viewModel.inputPreview}
      </pre>
      <div className="px-3 py-2 border-t border-gray-200 dark:border-white/10 text-xs text-gray-500 dark:text-gray-400">
        输出
      </div>
      <pre className="m-0 p-3 text-[12px] leading-5 text-gray-700 dark:text-gray-200 max-h-[220px] overflow-auto custom-scrollbar whitespace-pre-wrap select-text">
        {(viewModel.errorText ?? viewModel.outputPreview) || "无输出"}
      </pre>
    </div>
  );
}

export default function ToolCallPanel({ viewModel }: ToolCallPanelProps) {
  const [expanded, setExpanded] = useState(viewModel.status !== "completed");
  const statusText = viewModel.metadata.find((item) => item.label === "状态")?.value ?? "";

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="w-full inline-flex items-center gap-2 text-left"
      >
        {expanded ? (
          <ChevronDown className="size-4 text-gray-400" />
        ) : (
          <ChevronRight className="size-4 text-gray-400" />
        )}
        <Wrench className="size-4 text-gray-400" />
        <span className="text-sm text-gray-700 dark:text-gray-200 truncate">{viewModel.subtitle}</span>
        <span className={cn("text-xs ml-auto", statusClass(viewModel.status))}>
          {viewModel.status === "running" ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="size-3 animate-spin" /> {statusText}
            </span>
          ) : statusText}
        </span>
      </button>

      {(viewModel.approvalState === "approved" || viewModel.approvalState === "rejected") ? (
        <Receipt
          id={`receipt-${viewModel.id}`}
          outcome={viewModel.approvalState === "approved" ? "success" : "cancelled"}
          title={viewModel.approvalState === "approved" ? "审批已通过" : "审批已拒绝"}
          description={viewModel.subtitle}
        />
      ) : null}

      {expanded ? (
        <div className="space-y-2">
          {renderBody(viewModel)}
          <div className="flex flex-wrap gap-1.5">
            {viewModel.metadata.map((item) => (
              <span
                key={`${viewModel.id}-${item.label}`}
                className="px-2 py-1 rounded-md bg-gray-100 dark:bg-[#2a2a2a] text-xs text-gray-600 dark:text-gray-300"
              >
                {item.label}: {item.value}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
