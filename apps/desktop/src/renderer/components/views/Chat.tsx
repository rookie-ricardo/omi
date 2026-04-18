import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertCircle,
  ArrowDown,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  MoreHorizontal,
  Terminal,
  Undo,
} from "lucide-react";

import type {
  GitChangedFile,
  GitDiffPreview,
  SessionMessage,
  ToolCall,
} from "@omi/core";

import ThreadLayout from "../ThreadLayout";
import MarkdownRenderer from "../MarkdownRenderer";
import {
  ApprovalCard,
  BlockedToolCard,
  DecisionEventCard,
  Receipt,
  RunEventPanel,
  SkillEventPanel,
  TerminalEventCard,
  ToolCallPanel,
  buildRunEventDisplayModel,
  buildSkillEventViewModel,
  formatDuration as formatToolUiDuration,
  normalizeToolCallViewModel,
} from "../tool-ui";
import { deriveThreadTitle, useWorkspaceStore } from "../../store/workspace-store";

const HISTORY_VISIBLE_LIMIT = 3;
const SCROLL_BUTTON_THRESHOLD = 140;

export default function Chat() {
  const selectedSessionId = useWorkspaceStore((state) => state.selectedSessionId);
  const sessions = useWorkspaceStore((state) => state.sessions);
  const sessionDetailsById = useWorkspaceStore((state) => state.sessionDetailsById);
  const sessionRuntimeById = useWorkspaceStore((state) => state.sessionRuntimeById);
  const firstUserMessageBySession = useWorkspaceStore((state) => state.firstUserMessageBySession);
  const renamedSessionIds = useWorkspaceStore((state) => state.renamedSessionIds);
  const streamingBySession = useWorkspaceStore((state) => state.streamingBySession);
  const pendingToolCallsBySession = useWorkspaceStore((state) => state.pendingToolCallsBySession);
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
  const sessionDetail = selectedSessionId ? sessionDetailsById[selectedSessionId] : undefined;
  const messages = sessionDetail?.messages ?? [];
  const runtime = selectedSessionId ? sessionRuntimeById[selectedSessionId] : undefined;
  const pendingToolCalls = selectedSessionId ? pendingToolCallsBySession[selectedSessionId] ?? [] : [];
  const blockedTool = selectedSessionId ? useWorkspaceStore((state) => state.blockedToolBySession[selectedSessionId] ?? null) : null;
  const streamingContent = selectedSessionId ? streamingBySession[selectedSessionId]?.content ?? "" : "";
  const isStreaming = Boolean(selectedSessionId && streamingBySession[selectedSessionId]);
  const errorMessage = selectedSessionId ? errorBySession[selectedSessionId] ?? null : null;
  const resolvedSkill = useWorkspaceStore((state) =>
    selectedSessionId ? state.resolvedSkillBySession[selectedSessionId] ?? null : null,
  );
  const toolCalls = selectedSessionId ? toolCallsBySession[selectedSessionId] ?? [] : [];
  const activeTools = selectedSessionId ? activeToolsBySession[selectedSessionId] ?? [] : [];
  const activeToolIds = new Set(activeTools.map((tool) => tool.toolCallId));
  const activeRunId =
    runtime?.activeRunId ?? (selectedSessionId ? streamingBySession[selectedSessionId]?.runId ?? null : null);
  const latestPendingTool = pendingToolCalls[0] ?? null;
  const skillEventViewModel = useMemo(
    () =>
      resolvedSkill
        ? buildSkillEventViewModel({
            id: `${selectedSessionId ?? "session"}-skill`,
            skillName: resolvedSkill.skillName,
            score: 0,
            source: "claude-agent-sdk",
            enabledToolNames: resolvedSkill.enabledToolNames,
            diagnostics: [],
          })
        : null,
    [resolvedSkill, selectedSessionId],
  );
  const runStatusBadge = useMemo(() => {
    if (errorMessage) {
      return { label: "运行失败", tone: "text-red-600 dark:text-red-300" };
    }
    if (blockedTool) {
      return { label: "待审批", tone: "text-orange-600 dark:text-orange-300" };
    }
    if (isStreaming) {
      return { label: "运行中", tone: "text-blue-600 dark:text-blue-300" };
    }
    return { label: "空闲", tone: "text-gray-500 dark:text-gray-400" };
  }, [blockedTool, errorMessage, isStreaming]);

  const orderedMessages = useMemo(
    () => orderMessages(messages),
    [messages],
  );
  const toolCallsByRun = useMemo(
    () => groupToolCallsByRootMessage(toolCalls, messages),
    [messages, toolCalls],
  );
  const latestAssistantMessageId = useMemo(() => {
    for (let index = orderedMessages.length - 1; index >= 0; index -= 1) {
      const message = orderedMessages[index];
      if (message?.role === "assistant") {
        return message.id;
      }
    }
    return null;
  }, [orderedMessages]);

  const [showAllHistory, setShowAllHistory] = useState(false);
  const [expandedRuns, setExpandedRuns] = useState<Record<string, boolean>>({});
  const [showScrollButton, setShowScrollButton] = useState(false);

  const contentRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setShowAllHistory(false);
    setExpandedRuns({});
  }, [selectedSessionId]);

  useEffect(() => {
    if (isStreaming || streamingContent) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [streamingContent, isStreaming, orderedMessages.length, toolCalls.length]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) {
      return;
    }

    const container = content.parentElement;
    if (!container) {
      return;
    }

    scrollContainerRef.current = container;

    const updateState = () => {
      const distance =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      setShowScrollButton(distance > SCROLL_BUTTON_THRESHOLD);
    };

    updateState();
    container.addEventListener("scroll", updateState);

    return () => {
      container.removeEventListener("scroll", updateState);
    };
  }, [selectedSessionId, orderedMessages.length, toolCalls.length, streamingContent]);

  const hiddenMessageCount = Math.max(0, orderedMessages.length - HISTORY_VISIBLE_LIMIT);
  const visibleMessages =
    showAllHistory || hiddenMessageCount === 0
      ? orderedMessages
      : orderedMessages.slice(-HISTORY_VISIBLE_LIMIT);

  const assistantRunIds = visibleMessages
    .filter((message) => message.role === "assistant")
    .map((message) => getMessageGroupId(message))
    .filter((runId): runId is string => Boolean(runId));
  const orderedRunIds = useMemo(
    () => getOrderedRunIds(toolCallsByRun),
    [toolCallsByRun],
  );
  const latestToolRunId = orderedRunIds.at(-1) ?? null;
  const latestVisibleRunId = assistantRunIds.at(-1) ?? latestToolRunId ?? activeRunId ?? null;

  const timelineNodes: ReactNode[] = [];
  const insertedRunIds = new Set<string>();

  for (const message of visibleMessages) {
    const runId = message.role === "assistant" ? getMessageGroupId(message) : null;
    if (message.role === "assistant" && runId && !insertedRunIds.has(runId)) {
      const runToolCalls = toolCallsByRun.get(runId) ?? [];
      if (runToolCalls.length > 0) {
        const expanded = expandedRuns[runId] ?? runId === latestVisibleRunId;
        timelineNodes.push(
          <RunActivitySection
            key={`run-${runId}`}
            runId={runId}
            toolCalls={runToolCalls}
            activeToolIds={activeToolIds}
            expanded={expanded}
            activeRunId={activeRunId}
            assistantCreatedAt={message.createdAt}
            isLatestRun={runId === latestToolRunId}
            runErrorMessage={runId === latestToolRunId ? errorMessage : null}
            onToggle={() =>
              setExpandedRuns((state) => ({
                ...state,
                [runId]: !(state[runId] ?? runId === latestVisibleRunId),
              }))
            }
          />,
        );
      }
      insertedRunIds.add(runId);
    }

    timelineNodes.push(
      <MessageBlock
        key={message.id}
        message={message}
        isLatestAssistant={message.role === "assistant" && message.id === latestAssistantMessageId}
      />,
    );
  }

  for (const runId of orderedRunIds) {
    if (insertedRunIds.has(runId)) {
      continue;
    }
    const runToolCalls = toolCallsByRun.get(runId) ?? [];
    if (runToolCalls.length === 0) {
      continue;
    }
    const expandedByDefault = runId === latestVisibleRunId || runId === activeRunId;
    const expanded = expandedRuns[runId] ?? expandedByDefault;
    timelineNodes.push(
      <RunActivitySection
        key={`run-${runId}`}
        runId={runId}
        toolCalls={runToolCalls}
        activeToolIds={activeToolIds}
        expanded={expanded}
        activeRunId={activeRunId}
        assistantCreatedAt={null}
        isLatestRun={runId === latestToolRunId}
        runErrorMessage={runId === latestToolRunId ? errorMessage : null}
        onToggle={() =>
            setExpandedRuns((state) => ({
              ...state,
              [runId]: !(state[runId] ?? expandedByDefault),
            }))
        }
      />,
    );
    insertedRunIds.add(runId);
  }

  const title = selectedSession
    ? deriveThreadTitle(
        selectedSession.title,
        firstUserMessageBySession[selectedSession.id],
        Boolean(renamedSessionIds[selectedSession.id]),
      )
    : "聊天";

  const rightPanel = (
    <GitPanel
      gitFiles={gitState?.files ?? []}
      hasRepository={Boolean(gitState?.hasRepository)}
      diffPath={diffPath}
      diffPreview={diffPreview}
      onOpenDiff={(path) => void openDiffPreview(path)}
    />
  );

  function handleScrollToBottom() {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }
    container.scrollTo({
      top: container.scrollHeight,
      behavior: "smooth",
    });
  }

  return (
    <ThreadLayout
      title={<div className="font-medium text-base truncate max-w-[360px]">{title}</div>}
      rightPanel={rightPanel}
    >
      <div ref={contentRef} className="p-6">
        <div className="max-w-3xl mx-auto space-y-5">
          {!selectedSessionId ? (
            <EmptyState label="选择左侧线程，或在新线程页输入提示开始构建。" />
          ) : messages.length === 0 && !streamingContent && !isStreaming && !errorMessage ? (
            <EmptyState label="当前线程还没有消息，输入提示后会在这里实时显示。" />
          ) : (
            <>
              {hiddenMessageCount > 0 ? (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setShowAllHistory((value) => !value)}
                    className="inline-flex items-center gap-1 text-[15px] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                  >
                    {showAllHistory ? (
                      <ChevronDown size={14} className="text-gray-400 dark:text-gray-500" />
                    ) : (
                      <ChevronRight size={14} className="text-gray-400 dark:text-gray-500" />
                    )}
                    <span>上 {hiddenMessageCount} 条消息</span>
                  </button>
                  <div className="h-px bg-gray-200 dark:bg-white/10" />
                </div>
              ) : null}

              <div className={`flex items-center gap-2 text-xs ${runStatusBadge.tone}`}>
                <span className="inline-flex items-center gap-1 rounded-full border border-current px-2 py-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-current" />
                  {runStatusBadge.label}
                </span>
                {latestPendingTool ? (
                  <span>
                    待处理工具：{latestPendingTool.toolName}
                  </span>
                ) : null}
              </div>

              {skillEventViewModel ? <SkillEventPanel viewModel={skillEventViewModel} /> : null}

              {blockedTool ? (
                <BlockedToolCard
                  toolCallId={blockedTool.toolCallId}
                  toolName={blockedTool.toolName}
                  input={blockedTool.input}
                />
              ) : null}

              {timelineNodes}

              {isStreaming && !streamingContent ? <ThinkingIndicator /> : null}

              {streamingContent ? <StreamingBlock content={streamingContent} /> : null}

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

          {showScrollButton ? (
            <div className="sticky bottom-28 flex justify-center pointer-events-none">
              <button
                type="button"
                onClick={handleScrollToBottom}
                className="pointer-events-auto w-9 h-9 rounded-full border border-gray-200 dark:border-white/10 bg-white/95 dark:bg-[#2a2a2a] text-gray-600 dark:text-gray-300 flex items-center justify-center shadow-sm hover:text-gray-900 dark:hover:text-white transition-colors"
              >
                <ArrowDown size={18} />
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </ThreadLayout>
  );
}

function RunActivitySection({
  runId,
  toolCalls,
  activeToolIds,
  expanded,
  activeRunId,
  assistantCreatedAt,
  isLatestRun,
  runErrorMessage,
  onToggle,
}: {
  runId: string;
  toolCalls: ToolCall[];
  activeToolIds: Set<string>;
  expanded: boolean;
  activeRunId: string | null;
  assistantCreatedAt: string | null;
  isLatestRun: boolean;
  runErrorMessage: string | null;
  onToggle: () => void;
}) {
  if (toolCalls.length === 0) {
    return null;
  }

  const runEvent = buildRunEventDisplayModel({
    runId,
    toolCalls,
    activeToolIds,
    activeRunId,
    assistantCreatedAt,
    runErrorMessage,
    isLatestRun,
  });
  const durationText =
    typeof runEvent.durationMs === "number" ? formatToolUiDuration(runEvent.durationMs) : null;
  const summaryText = `${runEvent.title}${durationText ? ` · ${durationText}` : ""}`;
  const showRunReceipt = runEvent.status === "completed" || runEvent.status === "failed" || runEvent.status === "canceled";

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onToggle}
        className="inline-flex items-center gap-1 text-[15px] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
      >
        {expanded ? (
          <ChevronDown size={14} className="text-gray-400 dark:text-gray-500" />
        ) : (
          <ChevronRight size={14} className="text-gray-400 dark:text-gray-500" />
        )}
        <span>{summaryText}</span>
      </button>
      <div className="h-px bg-gray-200 dark:bg-white/10" />
      {expanded ? (
        <div className="space-y-3">
          <RunEventPanel viewModel={runEvent} />

          {runEvent.status !== "started" ? (
            <div className="text-xs text-gray-400 dark:text-gray-500">
              该运行的事件已经归档到工具时间线中。
            </div>
          ) : null}

          {showRunReceipt ? (
            <Receipt
              id={`run-receipt-${runId}`}
              outcome={
                runEvent.status === "completed"
                  ? "success"
                  : runEvent.status === "failed"
                    ? "failed"
                    : "cancelled"
              }
              title={runEvent.title}
              description={runEvent.summary}
            />
          ) : null}

          {runEvent.toolCalls.map((toolCall) => (
            <ToolCallPanel
              key={`${runId}-${toolCall.id}`}
              viewModel={toolCall}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MessageBlock({
  message,
  isLatestAssistant,
}: {
  message: SessionMessage;
  isLatestAssistant: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const sendPromptText = useWorkspaceStore((state) => state.sendPromptText);
  const gitState = useWorkspaceStore((state) => state.gitState);
  const canUndo = (gitState?.files.length ?? 0) > 0;
  const timeLabel = formatClock(message.createdAt);

  function handleCopy() {
    void navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  function handleUndo() {
    void sendPromptText("撤销上一条回复中的所有文件改动，恢复到改动之前的状态");
  }

  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="group max-w-[92%]">
          <div className="rounded-2xl bg-gray-100 dark:bg-[#2a2a2a] px-4 py-2.5 text-[15px] leading-relaxed text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
            {message.content}
          </div>
          <div className="h-5 flex items-center justify-end gap-2 pr-1 text-xs text-gray-400 dark:text-gray-500 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <span>{timeLabel}</span>
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              title={copied ? "已复制" : "复制"}
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-[15px] leading-relaxed text-gray-800 dark:text-gray-200">
        <MarkdownRenderer
          content={message.content}
          className="prose dark:prose-invert prose-sm max-w-none [&>*:first-child]:mt-0"
        />
      </div>
      <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          title={copied ? "已复制" : "复制"}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
        <span>{timeLabel}</span>
        {canUndo && isLatestAssistant ? (
          <button
            type="button"
            onClick={handleUndo}
            className="inline-flex items-center gap-1 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            title="撤销"
          >
            <Undo size={12} />
            <span>撤销</span>
          </button>
        ) : null}
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
      <span className="inline-flex items-center gap-1.5">
        <span className="text-[13px]">Thinking</span>
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
        <div className="text-sm font-medium text-red-600 dark:text-red-400 mb-1">Error</div>
        <div className="text-[15px] text-red-700 dark:text-red-300 leading-relaxed">{message}</div>
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
        <ApprovalCard
          key={call.id}
          id={`approval-${call.id}`}
          title={call.toolName}
          description={truncateInputPreview(call.input)}
          metadata={[
            { key: "时间", value: new Date(call.createdAt).toLocaleString("zh-CN") },
            { key: "消息", value: call.messageId ?? "-" },
          ]}
          confirmLabel="批准"
          cancelLabel="拒绝"
          onConfirm={() => onApprove(call.id)}
          onCancel={() => onReject(call.id)}
        />
      ))}
    </div>
  );
}

function truncateInputPreview(input: Record<string, unknown>, maxLength = 420): string {
  const text = JSON.stringify(input, null, 2);
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}\n...`;
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

function getMessageGroupId(message: SessionMessage): string | null {
  return message.parentMessageId ?? message.id;
}

function orderMessages(messages: SessionMessage[]): SessionMessage[] {
  return messages
    .filter((message) => message.role !== "tool")
    .sort(compareCreatedAt);
}

function groupToolCallsByRootMessage(
  toolCalls: ToolCall[],
  messages: SessionMessage[],
): Map<string, ToolCall[]> {
  const map = new Map<string, ToolCall[]>();
  const sorted = [...toolCalls].sort(compareCreatedAt);
  const messageById = new Map(messages.map((message) => [message.id, message]));

  for (const toolCall of sorted) {
    const toolMessage = toolCall.messageId ? messageById.get(toolCall.messageId) : null;
    const runId = toolMessage?.parentMessageId ?? toolMessage?.id ?? toolCall.messageId ?? toolCall.id;
    if (!map.has(runId)) {
      map.set(runId, []);
    }
    map.get(runId)?.push(toolCall);
  }

  return map;
}

function getOrderedRunIds(groupedToolCalls: Map<string, ToolCall[]>): string[] {
  return Array.from(groupedToolCalls.entries())
    .sort((left, right) => {
      const leftFirst = left[1][0];
      const rightFirst = right[1][0];
      if (!leftFirst || !rightFirst) {
        return 0;
      }
      return compareCreatedAt(leftFirst, rightFirst);
    })
    .map(([runId]) => runId);
}

function compareCreatedAt<T extends { createdAt: string; id: string }>(left: T, right: T): number {
  const timeDiff =
    new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
  if (timeDiff !== 0) {
    return timeDiff;
  }
  return left.id.localeCompare(right.id);
}

function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
