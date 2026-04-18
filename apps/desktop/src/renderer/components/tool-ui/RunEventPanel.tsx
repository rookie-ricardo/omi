import { Activity, CircleCheckBig, CircleDashed, OctagonAlert } from "lucide-react";

import ProgressTracker from "./ProgressTracker";
import type { RunEventDisplayModel } from "./models";

interface RunEventPanelProps {
  viewModel: RunEventDisplayModel;
}

function statusIcon(status: RunEventDisplayModel["status"]) {
  switch (status) {
    case "completed":
      return <CircleCheckBig size={14} />;
    case "failed":
    case "canceled":
      return <OctagonAlert size={14} />;
    default:
      return <Activity size={14} />;
  }
}

export default function RunEventPanel({ viewModel }: RunEventPanelProps) {
  const tone =
    viewModel.status === "failed"
      ? "border-red-200/70 dark:border-red-400/20 bg-red-50/70 dark:bg-red-500/10 text-red-700 dark:text-red-300"
      : viewModel.status === "canceled"
        ? "border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 text-gray-700 dark:text-gray-300"
        : "border-blue-200/70 dark:border-blue-400/20 bg-blue-50/70 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300";

  return (
    <div className={`space-y-3 rounded-xl border p-4 ${tone}`}>
      <div className="flex items-center gap-2 text-sm font-medium">
        {statusIcon(viewModel.status)}
        <span>{viewModel.title}</span>
        <span className="text-xs opacity-80">{viewModel.summary}</span>
      </div>
      <ProgressTracker
        id={`run-panel-${viewModel.runId}`}
        title={viewModel.title}
        summary={viewModel.summary}
        steps={viewModel.steps}
        elapsedMs={viewModel.durationMs}
      />
    </div>
  );
}
