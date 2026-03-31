import { cn } from "@/ui";

import type { GitDiffPreview } from "@omi/core";

export function GitDiffModal(props: {
  preview: GitDiffPreview | null;
  loading: boolean;
  onClose: () => void;
}) {
  if (!props.preview && !props.loading) {
    return null;
  }

  return (
    <div className="app-no-drag absolute inset-0 z-30 flex items-center justify-center bg-black/36 px-6 py-8 backdrop-blur-sm">
      <div className="flex h-full max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-[32px] border border-foreground/10 bg-background shadow-[0_32px_90px_rgba(0,0,0,0.32)]">
        <div className="flex items-center justify-between border-b border-foreground/8 px-6 py-4">
          <div>
            <div className="text-sm font-semibold">Diff 预览</div>
            <div className="mt-1 text-xs text-foreground/48">
              {props.preview?.path ?? "正在加载..."}
            </div>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-full border border-foreground/10 px-3 py-1.5 text-sm text-foreground/62 transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            关闭
          </button>
        </div>

        {props.loading || !props.preview ? (
          <div className="flex flex-1 items-center justify-center text-sm text-foreground/48">
            正在生成 diff...
          </div>
        ) : (
          <div className="grid flex-1 min-h-0 grid-cols-2 overflow-hidden">
            <DiffColumn
              title={props.preview.leftTitle}
              rows={props.preview.rows}
              side="left"
            />
            <DiffColumn
              title={props.preview.rightTitle}
              rows={props.preview.rows}
              side="right"
            />
          </div>
        )}
      </div>
    </div>
  );
}

function DiffColumn(props: {
  title: string;
  rows: GitDiffPreview["rows"];
  side: "left" | "right";
}) {
  return (
    <div className="min-h-0 overflow-auto border-l border-foreground/8 first:border-l-0">
      <div className="sticky top-0 z-10 border-b border-foreground/8 bg-background/96 px-4 py-3 text-xs font-medium text-foreground/56 backdrop-blur">
        {props.title}
      </div>
      <div className="font-mono text-xs">
        {props.rows.map((row, index) => {
          const lineNumber = props.side === "left" ? row.leftLineNumber : row.rightLineNumber;
          const text = props.side === "left" ? row.leftText : row.rightText;
          return (
            <div
              key={`${props.side}-${index}`}
              className={cn(
                "grid grid-cols-[56px_1fr] border-b border-foreground/6",
                row.kind === "added" && props.side === "right" ? "bg-success/8" : "",
                row.kind === "removed" && props.side === "left" ? "bg-destructive/8" : "",
              )}
            >
              <div className="border-r border-foreground/6 px-3 py-1.5 text-right text-foreground/35">
                {lineNumber ?? ""}
              </div>
              <pre className="overflow-x-auto whitespace-pre-wrap px-3 py-1.5 text-foreground/78">
                {text}
              </pre>
            </div>
          );
        })}
      </div>
    </div>
  );
}
