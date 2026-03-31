import { Button, Textarea } from "@/ui";
import { ChevronDown, Clock3, Plus, SendHorizontal } from "lucide-react";
import type { ChangeEvent, KeyboardEvent } from "react";

export function Composer(props: {
  prompt: string;
  branchLabel?: string | null;
  modelLabel: string;
  onPromptChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onCreateSession: () => void;
  onSend: () => void;
  disabled: boolean;
}) {
  return (
    <div className="mx-auto mt-6 w-full max-w-4xl">
      <div className="rounded-[28px] border border-foreground/10 bg-background/88 p-3 shadow-[0_24px_50px_color-mix(in_oklab,var(--foreground)_7%,transparent)] backdrop-blur-xl">
        <Textarea
          value={props.prompt}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
            props.onPromptChange(event.target.value)
          }
          onKeyDown={props.onKeyDown}
          rows={4}
          placeholder="向 OMI 描述任务，@ 添加上下文，/ 调出命令"
          className="min-h-[112px] resize-none border-0 bg-transparent px-2 py-2 text-[15px] shadow-none focus-visible:ring-0"
        />

        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={props.onCreateSession}
              className="inline-flex size-9 items-center justify-center rounded-full text-foreground/60 transition-colors hover:bg-foreground/5 hover:text-foreground"
              aria-label="创建线程"
            >
              <Plus className="size-4" />
            </button>
            <div className="inline-flex items-center gap-1 rounded-full border border-foreground/10 px-3 py-2 text-sm text-foreground/62">
              <Clock3 className="size-4" strokeWidth={1.75} />
              {props.modelLabel}
              <ChevronDown className="size-3.5" />
            </div>
          </div>

          <Button
            type="button"
            size="icon"
            onClick={props.onSend}
            disabled={props.disabled}
            className="rounded-full"
          >
            <SendHorizontal className="size-4" strokeWidth={1.85} />
          </Button>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between px-3 text-xs text-foreground/46">
        <div className="flex items-center gap-4">
          <span>本地</span>
          <span className="text-info">完全访问权限</span>
        </div>
        <span>{props.branchLabel ?? "非 Git 工作区"}</span>
      </div>
    </div>
  );
}
