import { CheckCircle2, Info, XCircle, Ban } from "lucide-react";

import { cn } from "../../lib/cn";

export type ReceiptOutcome = "success" | "failed" | "cancelled" | "info";

interface ReceiptProps {
  id: string;
  outcome: ReceiptOutcome;
  title: string;
  description?: string;
  className?: string;
}

function outcomeStyle(outcome: ReceiptOutcome): {
  icon: typeof CheckCircle2;
  textClassName: string;
  ringClassName: string;
} {
  switch (outcome) {
    case "success":
      return {
        icon: CheckCircle2,
        textClassName: "text-green-700 dark:text-green-300",
        ringClassName: "ring-green-200/80 dark:ring-green-500/20",
      };
    case "failed":
      return {
        icon: XCircle,
        textClassName: "text-red-700 dark:text-red-300",
        ringClassName: "ring-red-200/80 dark:ring-red-500/20",
      };
    case "cancelled":
      return {
        icon: Ban,
        textClassName: "text-gray-700 dark:text-gray-300",
        ringClassName: "ring-gray-200/80 dark:ring-white/20",
      };
    default:
      return {
        icon: Info,
        textClassName: "text-blue-700 dark:text-blue-300",
        ringClassName: "ring-blue-200/80 dark:ring-blue-500/20",
      };
  }
}

export default function Receipt({ id, outcome, title, description, className }: ReceiptProps) {
  const style = outcomeStyle(outcome);
  const Icon = style.icon;

  return (
    <div
      data-tool-ui-id={id}
      data-slot="receipt"
      className={cn(
        "rounded-xl bg-white/80 dark:bg-[#242424] ring-1 px-3 py-2",
        style.ringClassName,
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <Icon className={cn("size-4 mt-0.5", style.textClassName)} />
        <div className="min-w-0">
          <div className={cn("text-sm font-medium", style.textClassName)}>{title}</div>
          {description ? (
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{description}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
