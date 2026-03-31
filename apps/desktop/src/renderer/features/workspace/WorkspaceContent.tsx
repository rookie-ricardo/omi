import { Button, cn } from "@/ui";

import type { Session, SessionStatus, Task, ToolCall } from "@omi/core";

interface SessionDetailResponse {
  session: Session;
  messages: Array<{ id: string; role: string; content: string; createdAt: string }>;
  tasks: Task[];
}

export function WorkspaceContent(props: {
  session: Session | null;
  detail?: SessionDetailResponse;
  tasks: Task[];
  pendingApprovals: ToolCall[];
  onApproveTool: (toolCallId: string) => Promise<void>;
}) {
  return (
    <div className="h-full overflow-y-auto pr-1">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 pb-6">
        {props.detail?.messages?.length ? (
          <section className="grid gap-3">
            {props.detail.messages.map((message) => (
              <article
                key={message.id}
                className={cn(
                  "max-w-[82%] rounded-[24px] px-4 py-3 shadow-[0_10px_30px_color-mix(in_oklab,var(--foreground)_5%,transparent)]",
                  message.role === "user"
                    ? "ml-auto bg-foreground text-background"
                    : "bg-foreground/4 text-foreground",
                )}
              >
                <div className="mb-2 flex items-center justify-between gap-4 text-xs opacity-65">
                  <span>{roleLabel(message.role)}</span>
                  <span>{formatConversationTime(message.createdAt)}</span>
                </div>
                <div className="whitespace-pre-wrap text-sm leading-6">{message.content}</div>
              </article>
            ))}
          </section>
        ) : null}

        {props.pendingApprovals.length > 0 ? (
          <ToolApprovalPanel
            pendingApprovals={props.pendingApprovals}
            onApproveTool={props.onApproveTool}
          />
        ) : null}

        {props.tasks.length > 0 ? (
          <section className="rounded-[28px] border border-foreground/8 bg-foreground/3 p-4 shadow-[0_20px_40px_color-mix(in_oklab,var(--foreground)_4%,transparent)]">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">关联任务</div>
                <div className="mt-1 text-xs text-foreground/48">
                  {props.session?.title ?? "当前线程"} 生成的工作项
                </div>
              </div>
              <div className="rounded-full bg-foreground/6 px-2.5 py-1 text-xs text-foreground/52">
                {props.tasks.length}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {props.tasks.map((task) => (
                <article
                  key={task.id}
                  className="rounded-[24px] border border-foreground/8 bg-background/78 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-sm font-medium">{task.title}</div>
                    <span className="rounded-full bg-foreground/5 px-2 py-1 text-[11px] text-foreground/55">
                      {task.status}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-foreground/60">
                    {task.candidateReason}
                  </p>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

export function EmptyWorkspace(props: {
  title: string;
  subtitle: string;
  onSelectPrompt: (prompt: string) => void;
}) {
  const starterPrompts = [
    {
      title: "梳理这个仓库的主页面结构",
      description: "给出首页实现的关键模块、数据流和交互要点。",
    },
    {
      title: "生成一页 PDF，概述这个应用",
      description: "整理当前能力、技术栈和下一步实现方向。",
    },
    {
      title: "规划下一步迭代任务",
      description: "基于现有代码和数据模型拆解优先级。",
    },
  ];

  return (
    <div className="flex h-full flex-col justify-center">
      <div className="mx-auto flex w-full max-w-4xl flex-col items-center">
        <div className="flex size-16 items-center justify-center rounded-full border border-foreground/12 bg-foreground/3 shadow-[0_16px_50px_color-mix(in_oklab,var(--foreground)_5%,transparent)]">
          <span className="text-2xl">+</span>
        </div>
        <h1 className="mb-0 mt-6 text-5xl font-semibold tracking-[-0.04em]">{props.title}</h1>
        <button
          type="button"
          className="mt-3 inline-flex items-center gap-1 text-3xl font-semibold text-foreground/48 transition-colors hover:text-foreground/68"
        >
          {props.subtitle}
        </button>

        <div className="mt-12 flex w-full flex-col gap-3 md:flex-row">
          {starterPrompts.map((item) => (
            <button
              key={item.title}
              type="button"
              onClick={() => props.onSelectPrompt(item.title)}
              className="flex-1 rounded-[26px] border border-foreground/8 bg-foreground/3 p-4 text-left shadow-[0_12px_30px_color-mix(in_oklab,var(--foreground)_4%,transparent)] transition-transform hover:-translate-y-0.5 hover:bg-foreground/4"
            >
              <div className="mt-6 text-lg font-medium">{item.title}</div>
              <p className="mt-2 text-sm leading-6 text-foreground/56">{item.description}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function BridgeUnavailable() {
  return (
    <div className="flex h-full flex-col items-center justify-center">
      <div className="mx-auto max-w-xl rounded-[28px] border border-destructive/18 bg-destructive/8 p-6 text-center shadow-[0_20px_48px_color-mix(in_oklab,var(--destructive)_10%,transparent)]">
        <div className="text-lg font-semibold">桌面桥接未连接</div>
        <p className="mt-3 text-sm leading-7 text-foreground/62">
          渲染层没有拿到 <code>window.omi</code>
          ，所以当前只能渲染静态界面，不能读取真实会话或发送消息。
        </p>
      </div>
    </div>
  );
}

function ToolApprovalPanel(props: {
  pendingApprovals: ToolCall[];
  onApproveTool: (toolCallId: string) => Promise<void>;
}) {
  return (
    <section className="rounded-[28px] border border-info/25 bg-info/8 p-4 shadow-[0_16px_32px_color-mix(in_oklab,var(--info)_14%,transparent)]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">待审批工具调用</div>
          <div className="mt-1 text-xs text-foreground/52">这些工具需要确认后才会继续执行。</div>
        </div>
        <div className="rounded-full bg-background/70 px-2.5 py-1 text-xs text-foreground/62">
          {props.pendingApprovals.length}
        </div>
      </div>

      <div className="grid gap-3">
        {props.pendingApprovals.map((event) => (
          <article
            key={event.id}
            className="rounded-[22px] border border-foreground/8 bg-background/75 p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium">{event.toolName}</div>
              <Button
                size="sm"
                type="button"
                onClick={() => void props.onApproveTool(event.id)}
                className="rounded-full"
              >
                批准
              </Button>
            </div>
            <pre className="mt-3 overflow-x-auto rounded-2xl bg-foreground/4 p-3 text-xs leading-6 text-foreground/68">
              {JSON.stringify(event.input, null, 2)}
            </pre>
          </article>
        ))}
      </div>
    </section>
  );
}

function formatConversationTime(input: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(input));
}

function roleLabel(role: string) {
  switch (role) {
    case "assistant":
      return "OMI";
    case "user":
      return "你";
    case "tool":
      return "工具";
    default:
      return "系统";
  }
}

export function statusLabel(status: SessionStatus) {
  switch (status) {
    case "running":
      return "运行中";
    case "blocked":
      return "阻塞";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "canceled":
      return "已取消";
    default:
      return "空闲";
  }
}

export function statusClasses(status: SessionStatus) {
  switch (status) {
    case "running":
      return "bg-success/14 text-success";
    case "blocked":
      return "bg-info/14 text-info";
    case "failed":
      return "bg-destructive/14 text-destructive";
    case "completed":
      return "bg-foreground/8 text-foreground/72";
    case "canceled":
      return "bg-foreground/6 text-foreground/55";
    default:
      return "bg-foreground/5 text-foreground/55";
  }
}
