import { Sparkles, Wrench } from "lucide-react";

import Receipt from "./Receipt";
import type { SkillEventViewModel } from "./event-models";

interface SkillEventPanelProps {
  viewModel: SkillEventViewModel;
}

export default function SkillEventPanel({ viewModel }: SkillEventPanelProps) {
  return (
    <div className="space-y-2 rounded-xl border border-indigo-200/70 dark:border-indigo-400/20 bg-indigo-50/70 dark:bg-indigo-500/10 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-indigo-700 dark:text-indigo-300">
        <Sparkles size={14} />
        Skill 已激活
      </div>
      <div className="rounded-xl border border-indigo-100 dark:border-white/10 bg-white/90 dark:bg-[#1e1e1e] p-3 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-gray-800 dark:text-gray-200">
              {viewModel.skillName}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              来源 {viewModel.source} · 评分 {viewModel.score}
            </div>
          </div>
          <div className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
            <Wrench size={12} />
            {viewModel.enabledToolNames.length} 个工具
          </div>
        </div>

        {viewModel.enabledToolNames.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {viewModel.enabledToolNames.map((toolName) => (
              <span
                key={`${viewModel.id}-${toolName}`}
                className="px-2 py-1 rounded-md bg-gray-100 dark:bg-white/10 text-xs text-gray-600 dark:text-gray-300"
              >
                {toolName}
              </span>
            ))}
          </div>
        ) : null}

        {viewModel.diagnostics.length > 0 ? (
          <Receipt
            id={`skill-receipt-${viewModel.id}`}
            outcome="success"
            title="技能诊断"
            description={viewModel.diagnostics.join("\n")}
          />
        ) : null}
      </div>
    </div>
  );
}
