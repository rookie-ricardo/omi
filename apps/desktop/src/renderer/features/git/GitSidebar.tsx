import { cn } from "@/ui";

import type { GitChangedFile, GitRepoState } from "@omi/core";

export function GitSidebar(props: {
  repoState: GitRepoState;
  selectedPath: string | null;
  onOpenDiff: (path: string) => void;
}) {
  if (!props.repoState.hasRepository) {
    return null;
  }

  return (
    <aside className="w-[320px] shrink-0 border-l border-foreground/8 bg-[linear-gradient(180deg,color-mix(in_oklab,var(--background)_97%,black)_0%,var(--background)_100%)]">
      <div className="border-b border-foreground/8 px-5 py-4">
        <div className="text-sm font-semibold">Git 变更</div>
        <div className="mt-1 text-xs text-foreground/48">
          {props.repoState.branch ?? "HEAD"} · {props.repoState.files.length} 个文件
        </div>
      </div>

      <div className="h-[calc(100%-65px)] overflow-y-auto p-3">
        <div className="grid gap-2">
          {props.repoState.files.map((file) => (
            <button
              key={file.path}
              type="button"
              onDoubleClick={() => props.onOpenDiff(file.path)}
              className={cn(
                "rounded-[18px] border border-transparent px-3 py-3 text-left transition-colors",
                props.selectedPath === file.path
                  ? "border-info/30 bg-info/8"
                  : "bg-foreground/3 hover:bg-foreground/5",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{file.path}</div>
                  <div className="mt-1 text-xs text-foreground/48">
                    {describeFileState(file)}
                  </div>
                </div>
                <span className={cn("text-[11px] font-semibold", stateClassName(file.status))}>
                  {stateLabel(file.status)}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}

function describeFileState(file: GitChangedFile) {
  const flags = [];
  if (file.staged) {
    flags.push("已暂存");
  }
  if (file.unstaged) {
    flags.push("工作区");
  }
  return flags.length > 0 ? flags.join(" · ") : "仅查看";
}

function stateLabel(status: GitChangedFile["status"]) {
  switch (status) {
    case "added":
      return "新增";
    case "deleted":
      return "删除";
    case "renamed":
      return "重命名";
    case "untracked":
      return "未跟踪";
    default:
      return "修改";
  }
}

function stateClassName(status: GitChangedFile["status"]) {
  switch (status) {
    case "added":
      return "text-success";
    case "deleted":
      return "text-destructive";
    case "renamed":
      return "text-info";
    case "untracked":
      return "text-warning";
    default:
      return "text-foreground/58";
  }
}
