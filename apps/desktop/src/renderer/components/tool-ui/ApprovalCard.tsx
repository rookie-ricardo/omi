import { Check, ShieldAlert, X } from "lucide-react";

import { cn } from "../../lib/cn";

export type ApprovalChoice = "approved" | "denied";

interface MetadataItem {
  key: string;
  value: string;
}

interface ApprovalCardProps {
  id: string;
  title: string;
  description?: string;
  metadata?: MetadataItem[];
  confirmLabel?: string;
  cancelLabel?: string;
  choice?: ApprovalChoice;
  onConfirm?: () => void;
  onCancel?: () => void;
  className?: string;
}

function Receipt({ id, title, choice, className }: {
  id: string;
  title: string;
  choice: ApprovalChoice;
  className?: string;
}) {
  const approved = choice === "approved";
  return (
    <div
      data-tool-ui-id={id}
      data-slot="approval-card"
      data-receipt="true"
      className={cn(
        "rounded-xl border px-3 py-2 inline-flex items-center gap-2",
        approved
          ? "border-green-200/80 dark:border-green-500/20 bg-green-50/70 dark:bg-green-500/10"
          : "border-gray-200/80 dark:border-white/20 bg-gray-50 dark:bg-[#2a2a2a]",
        className,
      )}
    >
      <span className={cn(
        "inline-flex size-5 items-center justify-center rounded-full",
        approved
          ? "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300"
          : "bg-gray-200 text-gray-700 dark:bg-white/10 dark:text-gray-300",
      )}>
        {approved ? <Check className="size-3.5" /> : <X className="size-3.5" />}
      </span>
      <span className="text-sm text-gray-700 dark:text-gray-200">
        {approved ? "Approved" : "Denied"}: {title}
      </span>
    </div>
  );
}

export default function ApprovalCard({
  id,
  title,
  description,
  metadata,
  confirmLabel,
  cancelLabel,
  choice,
  onConfirm,
  onCancel,
  className,
}: ApprovalCardProps) {
  if (choice) {
    return <Receipt id={id} title={title} choice={choice} className={className} />;
  }

  return (
    <article
      data-tool-ui-id={id}
      data-slot="approval-card"
      className={cn(
        "rounded-xl border border-amber-200/80 dark:border-amber-400/20 bg-white dark:bg-[#252525] p-4 space-y-3",
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <span className="inline-flex size-8 rounded-lg items-center justify-center bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300">
          <ShieldAlert className="size-4" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
          {description ? (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 whitespace-pre-wrap">{description}</p>
          ) : null}
        </div>
      </div>

      {metadata && metadata.length > 0 ? (
        <dl className="space-y-1.5">
          {metadata.map((item) => (
            <div key={`${id}-${item.key}`} className="flex items-center justify-between gap-3">
              <dt className="text-xs text-gray-500 dark:text-gray-400">{item.key}</dt>
              <dd className="text-xs text-gray-700 dark:text-gray-200 truncate">{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          className="px-3 py-1.5 text-sm rounded-md bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-100 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          onClick={() => onCancel?.()}
        >
          {cancelLabel ?? "Deny"}
        </button>
        <button
          type="button"
          className="px-3 py-1.5 text-sm rounded-md bg-green-600 text-white hover:bg-green-700 transition-colors"
          onClick={() => onConfirm?.()}
        >
          {confirmLabel ?? "Approve"}
        </button>
      </div>
    </article>
  );
}
