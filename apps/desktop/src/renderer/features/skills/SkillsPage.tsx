import { cn } from "@/ui";

import type { SkillDescriptor } from "@omi/core";

export function SkillsPage(props: { skills: SkillDescriptor[]; loading: boolean }) {
  if (props.loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-foreground/48">
        正在扫描 Skill...
      </div>
    );
  }

  if (props.skills.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="max-w-xl rounded-[28px] border border-foreground/8 bg-foreground/3 p-6 text-center shadow-[0_18px_40px_color-mix(in_oklab,var(--foreground)_4%,transparent)]">
          <div className="text-lg font-semibold">还没有发现 Skill</div>
          <p className="mt-3 text-sm leading-7 text-foreground/56">
            当前会扫描工作区和用户目录下的 <code>.agent/skills</code> 与 <code>.claude/skills</code>
            。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto pr-1">
      <div className="mx-auto grid max-w-5xl gap-4 pb-6 md:grid-cols-2 xl:grid-cols-3">
        {props.skills.map((skill) => (
          <article
            key={skill.id}
            className="rounded-[28px] border border-foreground/8 bg-foreground/3 p-5 shadow-[0_20px_40px_color-mix(in_oklab,var(--foreground)_4%,transparent)]"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">{skill.name}</div>
                <div className="mt-2 text-sm leading-6 text-foreground/58">{skill.description}</div>
              </div>
              <span
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px]",
                  skill.source.scope === "workspace"
                    ? "bg-success/14 text-success"
                    : "bg-foreground/8 text-foreground/58",
                )}
              >
                {skill.source.scope === "workspace" ? "工作区" : "用户"}
              </span>
            </div>

            {skill.allowedTools.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {skill.allowedTools.map((toolName) => (
                  <span
                    key={toolName}
                    className="rounded-full bg-foreground/7 px-2.5 py-1 text-[11px] text-foreground/58"
                  >
                    {toolName}
                  </span>
                ))}
              </div>
            ) : null}

            <div className="mt-5 space-y-1 text-xs text-foreground/45">
              <div>{skill.source.client === "agent" ? ".agent" : ".claude"}</div>
              <div className="truncate">{skill.source.skillPath}</div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
