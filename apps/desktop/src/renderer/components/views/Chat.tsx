import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Check, Copy, MoreHorizontal, Terminal, Undo, User } from "lucide-react";

import type { GitChangedFile, GitDiffPreview, SessionMessage, ToolCall } from "@omi/core";

import ThreadLayout from "../ThreadLayout";
import MarkdownRenderer from "../MarkdownRenderer";
import ToolActivityGroup from "../chat/ToolActivityGroup";
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

  // 将工具调用按时间分组 - 连续的工具调用聚合在一起
  const toolGroups = useMemo(() => {
    const groups: Array<
      | { kind: "message"; message: SessionMessage }
      | { kind: "toolGroup"; toolCalls: ToolCall[] }
    > = [];

    const messagesByTime = [...messages].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    const toolsByTime = [...toolCalls].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

    let mi = 0;
    let ti = 0;
    let currentToolGroup: ToolCall[] = [];

    while (mi < messagesByTime.length || ti < toolsByTime.length) {
      const msg = messagesByTime[mi];
      const tool = toolsByTime[ti];

      const msgTime = msg ? new Date(msg.createdAt).getTime() : Infinity;
      const toolTime = tool ? new Date(tool.createdAt).getTime() : Infinity;

      if (msgTime <= toolTime) {
        // 先处理未完成的工具组
        if (currentToolGroup.length > 0) {
          groups.push({ kind: "toolGroup", toolCalls: currentToolGroup });
          currentToolGroup = [];
        }
        groups.push({ kind: "message", message: msg });
        mi++;
      } else {
        // 工具调用 - 加入当前组
        currentToolGroup.push(tool);
        ti++;
      }
    }

    // 处理最后的工具组
    if (currentToolGroup.length > 0) {
      groups.push({ kind: "toolGroup", toolCalls: currentToolGroup });
    }

    return groups;
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
  }, [streamingContent, isStreaming, toolGroups.length]);

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
              {toolGroups.map((item, index) =>
                item.kind === "message" ? (
                  <MessageBlock
                    key={item.message.id}
                    message={item.message}
                    isLast={index === toolGroups.length - 1}
                  />
                ) : (
                  <ToolActivityGroup
                    key={item.toolCalls[0]?.id || `empty-${index}`}
                    toolCalls={item.toolCalls}
                    activeToolIds={activeToolIds}
                  />
                ),
              )}

              {isStreaming && !streamingContent ? <ThinkingIndicator /> : null}

              {streamingContent ? (
                <StreamingBlock content={streamingContent} />
              ) : null}

              {errorMessage && !isStreaming ? (
                <AssistantErrorBlock message={errorMessage} />
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

function MessageBlock({ message, isLast }: { message: SessionMessage; isLast?: boolean }) {
  const [copied, setCopied] = useState(false);
  const sendPromptText = useWorkspaceStore((state) => state.sendPromptText);
  const gitState = useWorkspaceStore((state) => state.gitState);
  const canUndo = (gitState?.files.length ?? 0) > 0;

  function handleCopy() {
    void navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleUndo() {
    void sendPromptText("撤销上一条回复中的所有文件改动，恢复到改动之前的状态");
  }

  if (message.role === "user") {
    const timeStr = new Date(message.createdAt).toLocaleString("zh-CN", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    return (
      <div className="group flex justify-end">
        <div className="flex flex-col items-end gap-1">
          <div className="max-w-[90%] rounded-2xl bg-gray-100 dark:bg-[#2a2a2a] px-4 py-2.5 text-[15px] text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">
            {message.content}
          </div>
          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <span className="text-xs text-gray-400 dark:text-gray-500">{timeStr}</span>
            <button
              onClick={handleCopy}
              className="p-1 hover:bg-gray-100 dark:hover:bg-white/10 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              title={copied ? "已复制" : "复制"}
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // AI 消息 - 纯文本流式展示，无任何装饰
  return (
    <div className="group">
      <div className="text-[15px] text-gray-800 dark:text-gray-200 leading-relaxed">
        <MarkdownRenderer
          content={message.content}
          className="prose dark:prose-invert prose-sm max-w-none [&>*:first-child]:mt-0"
        />
      </div>
      <div className="flex items-center gap-2 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={handleCopy}
          className="p-1 hover:bg-gray-100 dark:hover:bg-white/10 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          title={copied ? "已复制" : "复制"}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
        {canUndo && isLast && (
          <button
            onClick={handleUndo}
            className="p-1 hover:bg-gray-100 dark:hover:bg-white/10 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            title="撤销"
          >
            <Undo size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

function StreamingBlock({ content }: { content: string }) {
  return (
    <div>
      <div className="text-[15px] text-gray-800 dark:text-gray-200 leading-relaxed">
        <MarkdownRenderer
          content={content}
          className="prose dark:prose-invert prose-sm max-w-none [&>*:first-child]:mt-0"
        />
      </div>
      <span className="inline-block ml-1 w-1.5 h-4 bg-gray-400 animate-pulse align-middle" />
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <div className="text-sm text-gray-500 dark:text-gray-400">
      <span className="inline-flex items-center gap-1">
        <span className="w-1 h-1 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "0ms" }} />
        <span className="w-1 h-1 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "150ms" }} />
        <span className="w-1 h-1 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "300ms" }} />
      </span>
    </div>
  );
}

function AssistantErrorBlock({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-6 h-6 rounded-full bg-red-500 flex items-center justify-center flex-shrink-0 mt-0.5">
        <AlertCircle size={14} className="text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium text-red-600 dark:text-red-400">Error</span>
        </div>
        <div className="text-[15px] text-red-700 dark:text-red-300 leading-relaxed">
          {message}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="text-center py-12">
      <div className="text-sm text-gray-400 dark:text-gray-500">
        {label}
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
