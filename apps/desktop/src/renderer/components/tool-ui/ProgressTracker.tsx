import { Check, Loader2, X, Circle } from "lucide-react";

import { cn } from "../../lib/cn";
import type { ProgressStepStatus, RunProgressStep } from "./models";

interface ProgressTrackerProps {
  id: string;
  title: string;
  summary: string;
  steps: RunProgressStep[];
  elapsedMs?: number | null;
}

function formatElapsed(elapsedMs: number): string {
  const seconds = Math.max(1, Math.round(elapsedMs / 1000));
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;

  if (minutes > 0) {
    return `${minutes}m ${restSeconds}s`;
  }

  return `${restSeconds}s`;
}

function StatusIcon({ status }: { status: ProgressStepStatus }) {
  if (status === "completed") {
    return (
      <span className="inline-flex size-5 items-center justify-center rounded-full bg-green-500 text-white">
        <Check className="size-3.5" />
      </span>
    );
  }

  if (status === "in-progress") {
    return (
      <span className="inline-flex size-5 items-center justify-center rounded-full border border-blue-300 dark:border-blue-500/60 text-blue-500">
        <Loader2 className="size-3.5 animate-spin" />
      </span>
    );
  }

  if (status === "failed") {
    return (
      <span className="inline-flex size-5 items-center justify-center rounded-full bg-red-500 text-white">
        <X className="size-3.5" />
      </span>
    );
  }

  return (
    <span className="inline-flex size-5 items-center justify-center rounded-full border border-gray-300 dark:border-white/25 text-gray-400">
      <Circle className="size-3" />
    </span>
  );
}

export default function ProgressTracker({ id, title, summary, steps, elapsedMs }: ProgressTrackerProps) {
  return (
    <section
      data-tool-ui-id={id}
      data-slot="progress-tracker"
      className="rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#252525] p-3"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{title}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{summary}</div>
        </div>
        {typeof elapsedMs === "number" && Number.isFinite(elapsedMs) ? (
          <time className="text-xs font-mono text-gray-500 dark:text-gray-400" dateTime={`PT${Math.max(1, Math.round(elapsedMs / 1000))}S`}>
            {formatElapsed(elapsedMs)}
          </time>
        ) : null}
      </div>

      <ol className="mt-3 space-y-2">
        {steps.map((step, index) => (
          <li key={step.id} className="relative flex items-start gap-2.5">
            {index < steps.length - 1 ? (
              <div className="absolute left-[9px] top-5 h-[calc(100%-10px)] w-px bg-gray-200 dark:bg-white/10" />
            ) : null}
            <StatusIcon status={step.status} />
            <div className="min-w-0 pb-1.5">
              <div className={cn(
                "text-sm leading-5",
                step.status === "pending"
                  ? "text-gray-500 dark:text-gray-400"
                  : "text-gray-800 dark:text-gray-200",
              )}>
                {step.label}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{step.description}</div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
