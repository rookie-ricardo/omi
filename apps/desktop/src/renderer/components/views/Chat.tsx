import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Check, Copy, MoreHorizontal, Terminal, Undo } from "lucide-react";

import type { GitChangedFile, GitDiffPreview, SessionMessage, ToolCall } from "@omi/core";

import ThreadLayout from "../ThreadLayout";
import MarkdownRenderer from "../MarkdownRenderer";
import ToolCallCard from "../ToolCallCard";
import {
  deriveThreadTitle,
  useWorkspaceStore,
} from "../../store/workspace-store";

export default function Chat() {
  const selectedSessionId = useWorkspaceStore((state) => state.selectedSessionId);
  const sessions = useWorkspaceStore((state) => state.sessions);
  const sessionDetailsById = useWorkspaceStore((state) => state.sessionDetailsById);
  const firstUserMessageBySession = useWorkspaceStore(
    (state) => state.firstUserMessageBySession,
  );
  const renamedSessionIds = useWorkspaceStore((state) => state.renamedSessionIds);
  const streamingBySession = useWorkspaceStore((state) => state.streamingBySession);
  const pendingToolCallsBySession = useWorkspaceStore(
    (state) => state.pendingToolCallsBySession,
  );
  const gitState = useWorkspaceStore((state) => state.gitState);
  const diffPath = useWorkspaceStore((state) => state.diffPath);
  const diffPreview = useWorkspaceStore((state) => state.diffPreview);
  const openDiffPreview = useWorkspaceStore((state) => state.openDiffPreview);
  const approveToolCall = useWorkspaceStore((state) => state.approveToolCall);
  const rejectToolCall = useWorkspaceStore((state) => state.rejectToolCall);
  const errorBySession = useWorkspaceStore((state) => state.errorBySession);
  const toolCallsBySession = useWorkspaceStore((state) => state.toolCallsBySession);
  const activeToolsBySession = useWorkspaceStore((state) => state.activeToolsBySession);

  const selectedSession = selectedSessionId
    ? sessions.find((session) => session.id === selectedSessionId) ?? null
    : null;
  const sessionDetail = selectedSessionId
    ? sessionDetailsById[selectedSessionId]
    : undefined;
  const messages = sessionDetail?.messages ?? [];
  const pendingToolCalls = selectedSessionId
    ? pendingToolCallsBySession[selectedSessionId] ?? []
    : [];
  const streamingContent = selectedSessionId
    ? streamingBySession[selectedSessionId]?.content ?? ""
    : "";
  const isStreaming = Boolean(
    selectedSessionId && streamingBySession[selectedSessionId],
  );
  const errorMessage = selectedSessionId
    ? errorBySession[selectedSessionId] ?? null
    : null;
  const toolCalls = selectedSessionId
    ? toolCallsBySession[selectedSessionId] ?? []
    : [];
  const activeTools = selectedSessionId
    ? activeToolsBySession[selectedSessionId] ?? []
    : [];
  const activeToolIds = new Set(activeTools.map((t) => t.toolCallId));

  const timelineItems = useMemo(() => {
    const items: Array<
      | { kind: "message"; message: SessionMessage }
      | { kind: "toolCall"; toolCall: ToolCall }
    > = [];
    const messagesByTime = [...messages].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    const toolsByTime = [...toolCalls].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    let mi = 0;
    let ti = 0;
    while (mi < messagesByTime.length || ti < toolsByTime.length) {
      const msg = messagesByTime[mi];
      const tool = toolsByTime[ti];
      if (msg && (!tool || new Date(msg.createdAt).getTime() <= new Date(tool.createdAt).getTime())) {
        items.push({ kind: "message", message: msg });
        mi++;
      } else if (tool) {
        items.push({ kind: "toolCall", toolCall: tool });
        ti++;
      }
    }
    return items;
  }, [messages, toolCalls]);

  const title = selectedSession
    ? deriveThreadTitle(
        selectedSession.title,
        firstUserMessageBySession[selectedSession.id],
        Boolean(renamedSessionIds[selectedSession.id]),
      )
    : "聊天";

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isStreaming || streamingContent) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [streamingContent, isStreaming, timelineItems.length]);

  const rightPanel = (
    <GitPanel
      gitFiles={gitState?.files ?? []}
      hasRepository={Boolean(gitState?.hasRepository)}
      diffPath={diffPath}
      diffPreview={diffPreview}
      onOpenDiff={(path) => void openDiffPreview(path)}
    />
  );

  return (
    <ThreadLayout title={<div className="font-medium text-base truncate max-w-[360px]">{title}</div>} rightPanel={rightPanel}>
      <div className="p-6">
        <div className="max-w-3xl mx-auto space-y-6">
          {!selectedSessionId ? (
            <EmptyState label="选择左侧线程，或在新线程页输入提示开始构建。" />
          ) : messages.length === 0 && !streamingContent && !isStreaming && !errorMessage ? (
            <EmptyState label="当前线程还没有消息，输入提示后会在这里实时显示。" />
          ) : (
            <>
              {timelineItems.map((item) =>
                item.kind === "message" ? (
                  <MessageBubble key={item.message.id} message={item.message} />
                ) : (
                  <ToolCallCard
                    key={item.toolCall.id}
                    toolCall={item.toolCall}
                    isActive={activeToolIds.has(item.toolCall.id)}
                  />
                ),
              )}

              {isStreaming && !streamingContent ? <ThinkingIndicator /> : null}

              {streamingContent ? (
                <div className="flex justify-start">
                  <div className="max-w-[88%] rounded-[24px] border border-gray-200/90 dark:border-white/10 bg-white/95 dark:bg-[#252525] px-5 py-3 text-[15px] leading-relaxed text-gray-800 dark:text-gray-200 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
                    <MarkdownRenderer content={streamingContent} />
                    <span className="inline-block ml-1 w-2 h-4 align-middle bg-gray-400 dark:bg-gray-500 animate-pulse" />
                  </div>
                </div>
              ) : null}

              {errorMessage && !isStreaming ? (
                <AssistantErrorBubble message={errorMessage} />
              ) : null}
            </>
          )}

          {pendingToolCalls.length > 0 ? (
            <ToolApprovalSection
              calls={pendingToolCalls}
              onApprove={(toolCallId) => void approveToolCall(toolCallId)}
              onReject={(toolCallId) => void rejectToolCall(toolCallId)}
            />
          ) : null}

          <div ref={messagesEndRef} />
        </div>
      </div>
    </ThreadLayout>
  );
}

function ThinkingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="relative overflow-hidden rounded-[20px] border border-gray-200/90 dark:border-white/10 bg-white/95 dark:bg-[#252525] px-4 py-2.5 text-sm font-medium text-gray-500 dark:text-gray-300 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
        <span className="relative z-10">Thinking</span>
        <span className="pointer-events-none absolute inset-0 thinking-shimmer" />
      </div>
    </div>
  );
}

function AssistantErrorBubble({ message }: { message: string }) {
  return (
    <div className="flex justify-start">
      <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-400/20 rounded-2xl rounded-tl-sm px-4 py-3 max-w-[85%] text-[15px] leading-relaxed text-red-700 dark:text-red-300">
        <div className="flex items-center gap-2">
          <AlertCircle size={16} className="text-red-500 dark:text-red-400 flex-shrink-0" />
          <span>运行失败</span>
        </div>
        <div className="mt-1 whitespace-pre-wrap break-words">{message}</div>
      </div>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-300 dark:border-white/10 px-5 py-4 text-sm text-gray-500 dark:text-gray-400">
      {label}
    </div>
  );
}

function MessageBubble({ message }: { message: SessionMessage }) {
  const [copied, setCopied] = useState(false);
  const sendPromptText = useWorkspaceStore((state) => state.sendPromptText);
  const gitState = useWorkspaceStore((state) => state.gitState);
  const canUndo = (gitState?.files.length ?? 0) > 0;

  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-[26px] bg-gray-100 dark:bg-[#2a2a2a] px-5 py-2.5 text-[15px] text-gray-800 dark:text-gray-200 whitespace-pre-wrap shadow-[0_6px_18px_rgba(15,23,42,0.06)]">
          {message.content}
        </div>
      </div>
    );
  }

  function handleCopy() {
    void navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleUndo() {
    void sendPromptText("撤销上一条回复中的所有文件改动，恢复到改动之前的状态");
  }

  return (
    <div className="group flex flex-col items-start gap-2">
      <div className="max-w-[88%] rounded-[24px] border border-gray-200/90 dark:border-white/10 bg-white/95 dark:bg-[#252525] px-5 py-3 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
        <MarkdownRenderer
          content={message.content}
          className="text-[15px] text-gray-800 dark:text-gray-200 leading-relaxed"
        />
      </div>
      <div className="flex items-center gap-2 pl-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        {canUndo ? (
          <button
            onClick={handleUndo}
            className="px-2.5 py-1 text-xs bg-gray-100/85 dark:bg-[#2a2a2a]/85 hover:bg-gray-200 dark:hover:bg-[#333333] rounded-md text-gray-600 dark:text-gray-300 flex items-center gap-1 transition-colors"
          >
            <Undo size={12} /> 撤销
          </button>
        ) : null}
        <button
          onClick={handleCopy}
          className="px-2.5 py-1 text-xs bg-gray-100/85 dark:bg-[#2a2a2a]/85 hover:bg-gray-200 dark:hover:bg-[#333333] rounded-md text-gray-600 dark:text-gray-300 transition-colors"
        >
          {copied ? (
            <><Check size={12} className="inline mr-1" />已复制</>
          ) : (
            <><Copy size={12} className="inline mr-1" />复制</>
          )}
        </button>
      </div>
    </div>
  );
}

function ToolApprovalSection({
  calls,
  onApprove,
  onReject,
}: {
  calls: ToolCall[];
  onApprove: (toolCallId: string) => void;
  onReject: (toolCallId: string) => void;
}) {
  return (
    <div className="rounded-xl border border-amber-200/80 dark:border-amber-400/20 bg-amber-50/70 dark:bg-amber-500/10 p-4 space-y-3">
      <div className="text-sm font-medium text-amber-700 dark:text-amber-300">待审批工具调用</div>
      {calls.map((call) => (
        <div
          key={call.id}
          className="rounded-lg bg-white dark:bg-[#252525] border border-amber-200/80 dark:border-amber-400/20 p-3"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {call.toolName}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {new Date(call.createdAt).toLocaleString("zh-CN")}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="px-3 py-1.5 text-sm rounded-md bg-green-600 text-white hover:bg-green-700 transition-colors"
                onClick={() => onApprove(call.id)}
              >
                批准
              </button>
              <button
                type="button"
                className="px-3 py-1.5 text-sm rounded-md bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                onClick={() => onReject(call.id)}
              >
                拒绝
              </button>
            </div>
          </div>
          <pre className="mt-3 overflow-x-auto rounded-md bg-gray-50 dark:bg-[#1e1e1e] p-2 text-xs text-gray-700 dark:text-gray-300">
            {JSON.stringify(call.input, null, 2)}
          </pre>
        </div>
      ))}
    </div>
  );
}

function GitPanel({
  gitFiles,
  hasRepository,
  diffPath,
  diffPreview,
  onOpenDiff,
}: {
  gitFiles: GitChangedFile[];
  hasRepository: boolean;
  diffPath: string | null;
  diffPreview: GitDiffPreview | null;
  onOpenDiff: (path: string) => void;
}) {
  return (
    <div className="w-[380px] border-l border-gray-200 dark:border-white/10 bg-white dark:bg-[#1e1e1e] flex flex-col h-full flex-shrink-0 transition-colors">
      <div className="h-14 flex items-center justify-between px-4 border-b border-gray-100 dark:border-white/10 flex-shrink-0">
        <div className="font-medium text-base">
          Git 变更{" "}
          <span className="text-gray-400 dark:text-gray-500 text-sm ml-1">{gitFiles.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <button className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded text-gray-500 dark:text-gray-400 transition-colors">
            <Terminal size={14} />
          </button>
          <button className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded text-gray-500 dark:text-gray-400 transition-colors">
            <MoreHorizontal size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-3">
        {!hasRepository ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">
            当前目录不是 Git 仓库，无法展示变更。
          </div>
        ) : gitFiles.length === 0 ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">暂无变更文件。</div>
        ) : (
          gitFiles.map((file) => (
            <button
              key={file.path}
              type="button"
              onClick={() => onOpenDiff(file.path)}
              className={`w-full text-left rounded-lg border p-3 transition-colors ${
                diffPath === file.path
                  ? "border-blue-300 dark:border-blue-500/40 bg-blue-50/70 dark:bg-blue-500/10"
                  : "border-gray-200 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-[#252525]"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                  {file.path}
                </span>
                <span className={`text-xs ${statusColor(file.status)}`}>
                  {statusLabel(file.status)}
                </span>
              </div>
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {file.staged ? "已暂存" : "未暂存"} · {file.unstaged ? "工作区有改动" : "仅暂存区"}
              </div>
            </button>
          ))
        )}

        {diffPreview ? <DiffPreviewCard preview={diffPreview} /> : null}
      </div>
    </div>
  );
}

function DiffPreviewCard({ preview }: { preview: GitDiffPreview }) {
  const added = preview.rows.filter((row) => row.kind === "added").length;
  const removed = preview.rows.filter((row) => row.kind === "removed").length;
  return (
    <div className="border border-gray-200 dark:border-white/10 rounded-lg overflow-hidden transition-colors">
      <div className="bg-gray-50 dark:bg-[#252525] px-3 py-2 flex items-center justify-between text-sm border-b border-gray-200 dark:border-white/10">
        <span className="font-medium text-gray-700 dark:text-gray-300 truncate">{preview.path}</span>
        <div className="flex items-center gap-2">
          <span className="text-green-500 dark:text-green-400">+{added}</span>
          <span className="text-red-500 dark:text-red-400">-{removed}</span>
        </div>
      </div>
      <div className="p-3 text-xs font-mono text-gray-600 dark:text-gray-400 bg-white dark:bg-[#1e1e1e] space-y-1 max-h-[320px] overflow-y-auto custom-scrollbar">
        {preview.rows.slice(0, 120).map((row, index) => (
          <div
            key={`${preview.path}-${index}`}
            className={`px-1 -mx-3 ${
              row.kind === "added"
                ? "text-green-500 dark:text-green-400 bg-green-50 dark:bg-green-900/20"
                : row.kind === "removed"
                  ? "text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20"
                  : ""
            }`}
          >
            {row.kind === "added" ? "+" : row.kind === "removed" ? "-" : " "}
            {row.rightText || row.leftText}
          </div>
        ))}
      </div>
    </div>
  );
}

function statusLabel(status: GitChangedFile["status"]): string {
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

function statusColor(status: GitChangedFile["status"]): string {
  switch (status) {
    case "added":
      return "text-green-500 dark:text-green-400";
    case "deleted":
      return "text-red-500 dark:text-red-400";
    case "renamed":
      return "text-blue-500 dark:text-blue-400";
    case "untracked":
      return "text-amber-500 dark:text-amber-400";
    default:
      return "text-gray-500 dark:text-gray-400";
  }
}
