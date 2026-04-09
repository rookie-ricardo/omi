import React, { useEffect, useMemo, useRef } from "react";
import {
  AlertCircle,
  ArrowUp,
  Brain,
  Check,
  ChevronDown,
  Copy,
  ClipboardCheck,
  Cpu,
  GitBranch,
  GitCommit,
  ListTodo,
  MessageSquare,
  Monitor,
  Paperclip,
  Plus,
  Square,
  UserCircle,
  Box,
  Bug,
  Gauge,
} from "lucide-react";

import { formatProviderConfigLabel, useWorkspaceStore } from "../store/workspace-store";

interface ThreadLayoutProps {
  title?: React.ReactNode;
  children: React.ReactNode;
  rightPanel?: React.ReactNode;
  onSendSuccess?: (sessionId: string) => void;
}

export default function ThreadLayout({
  title = "新线程",
  children,
  rightPanel,
  onSendSuccess,
}: ThreadLayoutProps) {
  const composerInput = useWorkspaceStore((state) => state.composerInput);
  const selectedFiles = useWorkspaceStore((state) => state.selectedFiles);
  const selectedSessionId = useWorkspaceStore((state) => state.selectedSessionId);
  const modelCatalog = useWorkspaceStore((state) => state.modelCatalog);
  const sessionRuntimeById = useWorkspaceStore((state) => state.sessionRuntimeById);
  const gitState = useWorkspaceStore((state) => state.gitState);
  const pendingToolCallsBySession = useWorkspaceStore(
    (state) => state.pendingToolCallsBySession,
  );
  const reasoningLevel = useWorkspaceStore((state) => state.reasoningLevel);
  const uiPanels = useWorkspaceStore((state) => state.uiPanels);
  const setComposerInput = useWorkspaceStore((state) => state.setComposerInput);
  const sendPrompt = useWorkspaceStore((state) => state.sendPrompt);
  const cancelRun = useWorkspaceStore((state) => state.cancelRun);
  const streamingBySession = useWorkspaceStore((state) => state.streamingBySession);
  const openComposerFileDialog = useWorkspaceStore((state) => state.openComposerFileDialog);
  const removeSelectedFile = useWorkspaceStore((state) => state.removeSelectedFile);
  const clearSelectedFiles = useWorkspaceStore((state) => state.clearSelectedFiles);
  const setReasoningLevel = useWorkspaceStore((state) => state.setReasoningLevel);
  const switchModel = useWorkspaceStore((state) => state.switchModel);
  const setUiPanelOpen = useWorkspaceStore((state) => state.setUiPanelOpen);
  const closeAllPanels = useWorkspaceStore((state) => state.closeAllPanels);
  const toggleDiffPanel = useWorkspaceStore((state) => state.toggleDiffPanel);

  const executeSlashCommand = useWorkspaceStore((state) => state.executeSlashCommand);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const commitRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<HTMLDivElement>(null);
  const reasoningRef = useRef<HTMLDivElement>(null);

  const providerConfigs = modelCatalog?.providerConfigs ?? [];
  const currentRuntime = selectedSessionId
    ? sessionRuntimeById[selectedSessionId]
    : undefined;
  const selectedProviderId =
    currentRuntime?.selectedProviderConfigId ?? providerConfigs[0]?.id ?? "";
  const selectedProvider =
    providerConfigs.find((config) => config.id === selectedProviderId) ?? providerConfigs[0];
  const selectedModelLabel = selectedProvider
    ? formatProviderConfigLabel(selectedProvider)
    : "未配置模型";

  const pendingApprovalCount =
    selectedSessionId && pendingToolCallsBySession[selectedSessionId]
      ? pendingToolCallsBySession[selectedSessionId].length
      : 0;
  const stagedCount =
    gitState?.files.filter((file) => file.staged).length ?? 0;
  const unstagedCount =
    gitState?.files.filter((file) => file.unstaged).length ?? 0;
  const branchLabel = gitState?.branch ?? "non-git";
  const isStreaming = Boolean(
    selectedSessionId && streamingBySession[selectedSessionId],
  );

  const slashCommands = useMemo(
    () => [
      { title: "MCP", subtitle: "显示 MCP 服务器状态", icon: <Paperclip size={16} /> },
      { title: "Model", subtitle: selectedModelLabel, icon: <Box size={16} /> },
      { title: "Reasoning", subtitle: reasoningLevel, icon: <Brain size={16} /> },
      { title: "个性", subtitle: "切换系统角色", icon: <UserCircle size={16} /> },
      { title: "代码审查", subtitle: "审查当前改动", icon: <Bug size={16} /> },
      { title: "反馈", subtitle: "提交反馈", icon: <MessageSquare size={16} /> },
      { title: "状态", subtitle: "显示线程 ID 与额度", icon: <Gauge size={16} /> },
      { title: "计划模式", subtitle: "开启计划模式", icon: <ListTodo size={16} /> },
    ],
    [reasoningLevel, selectedModelLabel],
  );

  useEffect(() => {
    if (!textareaRef.current) {
      return;
    }
    textareaRef.current.style.height = "auto";
    textareaRef.current.style.height = `${Math.max(textareaRef.current.scrollHeight, 24)}px`;
  }, [composerInput]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (editorRef.current?.contains(event.target as Node)) {
        return;
      }
      if (commitRef.current?.contains(event.target as Node)) {
        return;
      }
      if (modelRef.current?.contains(event.target as Node)) {
        return;
      }
      if (reasoningRef.current?.contains(event.target as Node)) {
        return;
      }
      closeAllPanels();
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [closeAllPanels]);

  useEffect(() => {
    function onEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeAllPanels();
      }
    }
    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener("keydown", onEscape);
    };
  }, [closeAllPanels]);

  async function handleSend() {
    const sessionId = await sendPrompt();
    if (sessionId && onSendSuccess) {
      onSendSuccess(sessionId);
    }
  }

  return (
    <div className="flex-1 flex h-full relative overflow-hidden bg-white dark:bg-[#1e1e1e] text-gray-900 dark:text-gray-100 transition-colors w-full">
      <div className="flex-1 flex flex-col h-full relative">
        <div className="h-14 flex items-center justify-between px-6 border-b border-transparent flex-shrink-0">
          <div className="font-medium text-base truncate max-w-[300px]">{title}</div>
          <div className="flex items-center gap-3 text-base">
            <div className="relative" ref={editorRef}>
              <button
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-[#2a2a2a] cursor-pointer border border-gray-200 dark:border-white/10 shadow-sm bg-white dark:bg-[#252525] transition-colors"
                title="选择编辑器"
                onClick={() => {
                  setUiPanelOpen("editorMenuOpen", !uiPanels.editorMenuOpen);
                  setUiPanelOpen("commitMenuOpen", false);
                }}
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="#007ACC">
                  <path d="M23.15 2.587L18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z" />
                </svg>
                <ChevronDown size={14} className="text-gray-400" />
              </button>

              {uiPanels.editorMenuOpen ? (
                <div className="absolute top-full right-0 mt-1.5 w-44 bg-white dark:bg-[#2a2a2a] rounded-xl shadow-lg border border-gray-200 dark:border-white/10 py-1.5 z-50 overflow-hidden">
                  <HeaderMenuItem label="VS Code" />
                  <HeaderMenuItem label="Finder" />
                  <HeaderMenuItem label="Terminal" />
                  <HeaderMenuItem label="IntelliJ IDEA" />
                </div>
              ) : null}
            </div>

            <div className="relative" ref={commitRef}>
              <button
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-[#2a2a2a] cursor-pointer border border-gray-200 dark:border-white/10 shadow-sm bg-white dark:bg-[#252525] transition-colors"
                title="Git 提交"
                onClick={() => {
                  setUiPanelOpen("commitMenuOpen", !uiPanels.commitMenuOpen);
                  setUiPanelOpen("editorMenuOpen", false);
                }}
              >
                <GitCommit size={14} className="text-gray-800 dark:text-gray-200" />
                <span className="text-sm font-medium text-gray-800 dark:text-gray-200">提交</span>
                <ChevronDown size={14} className="text-gray-400" />
              </button>

              {uiPanels.commitMenuOpen ? (
                <div className="absolute top-full right-0 mt-1.5 w-52 bg-white dark:bg-[#2a2a2a] rounded-xl shadow-lg border border-gray-200 dark:border-white/10 py-1.5 z-50 overflow-hidden">
                  <HeaderMenuItem label="提交当前改动" />
                  <HeaderMenuItem label="提交并推送" />
                  <HeaderMenuItem label="创建 PR 草稿" />
                </div>
              ) : null}
            </div>

            <div className="w-px h-4 bg-gray-200 dark:bg-white/10 mx-1" />

            <div className="text-gray-500 dark:text-gray-400 cursor-pointer hover:text-gray-700 dark:hover:text-gray-300 transition-colors p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-white/5">
              <ClipboardCheck size={18} strokeWidth={1.5} />
            </div>

            <div
              className="text-gray-500 dark:text-gray-400 cursor-pointer hover:text-gray-700 dark:hover:text-gray-300 transition-colors ml-1 p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-white/5"
              onClick={() => void toggleDiffPanel()}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <path d="M12 16V8" />
                <path d="M8 12l4-4 4 4" />
                <path d="M8 16h8" />
              </svg>
            </div>

            <div className="flex items-center gap-1.5 text-sm font-mono ml-1 px-2 py-1 rounded-md hover:bg-gray-100 dark:hover:bg-white/5 cursor-pointer">
              <span className="text-[#16a34a] dark:text-[#22c55e]">+{stagedCount}</span>
              <span className="text-[#dc2626] dark:text-[#ef4444]">-{unstagedCount || pendingApprovalCount}</span>
            </div>

            <div className="ml-2 cursor-pointer text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-white/5">
              <Copy size={16} strokeWidth={1.5} />
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pb-44 relative flex flex-col custom-scrollbar">
          {children}
        </div>

        <div className="absolute bottom-1 left-3 right-3 flex justify-center flex-shrink-0 z-40">
          <div className="w-3/4 relative">
            {uiPanels.slashMenuOpen ? (
              <div className="absolute bottom-full left-0 right-0 mb-2 bg-white dark:bg-[#252525] rounded-2xl border border-gray-200 dark:border-white/10 shadow-lg overflow-hidden flex flex-col max-h-[400px] z-50">
                <ul className="overflow-y-auto p-2 flex flex-col gap-0.5 custom-scrollbar">
                  {slashCommands.map((command) => (
                    <SlashMenuItem
                      key={command.title}
                      title={command.title}
                      subtitle={command.subtitle}
                      icon={command.icon}
                      onClick={() => void executeSlashCommand(command.title)}
                    />
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="w-full bg-white dark:bg-[#252525] rounded-2xl border border-gray-200 dark:border-white/10 shadow-sm flex flex-col overflow-visible relative">
              {selectedFiles.length > 0 ? (
                <div className="px-6 pt-3 flex flex-wrap gap-2">
                  {selectedFiles.map((path) => (
                    <div
                      key={path}
                      className="flex items-center gap-1.5 px-2 py-1 bg-gray-200 dark:bg-white/10 rounded-lg text-xs text-gray-700 dark:text-gray-300 group transition-colors hover:bg-gray-300 dark:hover:bg-white/20"
                    >
                      <span className="truncate max-w-[200px]">{path.split("/").pop()}</span>
                      <button
                        type="button"
                        className="cursor-pointer hover:text-red-500 transition-colors"
                        onClick={() => removeSelectedFile(path)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => clearSelectedFiles()}
                    className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors ml-1"
                  >
                    清除全部
                  </button>
                </div>
              ) : null}

              <div className="px-6 pt-3.5 pb-1.5">
                <textarea
                  ref={textareaRef}
                  value={composerInput}
                  onChange={(event) => setComposerInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void handleSend();
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      closeAllPanels();
                    }
                  }}
                  placeholder="Ask Codex anything, @ to add files, / for commands, $ for skills"
                  className="w-full resize-none outline-none text-[15px] leading-relaxed text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 bg-transparent min-h-[24px] max-h-[300px] overflow-y-auto custom-scrollbar"
                  rows={1}
                />
              </div>

              <div className="px-4 py-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void openComposerFileDialog()}
                    className="p-2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
                    title="添加文件或文件夹"
                  >
                    <Plus size={20} />
                  </button>

                  <div className="relative" ref={modelRef}>
                    <button
                      onClick={() => {
                        setUiPanelOpen("modelMenuOpen", !uiPanels.modelMenuOpen);
                        setUiPanelOpen("reasoningMenuOpen", false);
                      }}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
                    >
                      {selectedModelLabel}{" "}
                      <ChevronDown size={14} className="text-gray-400 dark:text-gray-500" />
                    </button>

                    {uiPanels.modelMenuOpen ? (
                      <div className="absolute bottom-full left-0 mb-2 w-64 bg-white dark:bg-[#2a2a2a] rounded-xl shadow-lg border border-gray-100 dark:border-white/10 py-1.5 z-50">
                        <div className="px-3 py-1.5 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                          选择模型
                        </div>
                        {providerConfigs.map((config) => {
                          const label = formatProviderConfigLabel(config);
                          const active = selectedProviderId === config.id;
                          return (
                            <button
                              type="button"
                              key={config.id}
                              className="w-full px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-white/5 flex items-center justify-between transition-colors"
                              onClick={() => {
                                void switchModel(config.id);
                                setUiPanelOpen("modelMenuOpen", false);
                              }}
                            >
                              <span
                                className={
                                  active
                                    ? "text-blue-500 dark:text-blue-400 font-medium"
                                    : "text-gray-700 dark:text-gray-200"
                                }
                              >
                                {label}
                              </span>
                              {active ? (
                                <Check size={14} className="text-blue-500 dark:text-blue-400" />
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>

                  <div className="relative" ref={reasoningRef}>
                    <button
                      onClick={() => {
                        setUiPanelOpen("reasoningMenuOpen", !uiPanels.reasoningMenuOpen);
                        setUiPanelOpen("modelMenuOpen", false);
                      }}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
                    >
                      {reasoningLevel}{" "}
                      <ChevronDown size={14} className="text-gray-400 dark:text-gray-500" />
                    </button>

                    {uiPanels.reasoningMenuOpen ? (
                      <div className="absolute bottom-full left-0 mb-2 w-36 bg-white dark:bg-[#2a2a2a] rounded-xl shadow-lg border border-gray-100 dark:border-white/10 py-1.5 z-50">
                        <div className="px-3 py-1.5 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                          选择推理功能
                        </div>
                        {(["低", "中", "高", "超高"] as const).map((level) => (
                          <button
                            type="button"
                            key={level}
                            className="w-full px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-white/5 flex items-center gap-2 transition-colors"
                            onClick={() => {
                              setReasoningLevel(level);
                              setUiPanelOpen("reasoningMenuOpen", false);
                            }}
                          >
                            <Cpu
                              size={14}
                              className={
                                reasoningLevel === level
                                  ? "text-blue-500 dark:text-blue-400"
                                  : "text-gray-400"
                              }
                            />
                            <span
                              className={
                                reasoningLevel === level
                                  ? "text-blue-500 dark:text-blue-400 font-medium"
                                  : "text-gray-700 dark:text-gray-200"
                              }
                            >
                              {level}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>

                {isStreaming ? (
                  <button
                    onClick={() => void cancelRun()}
                    className="w-9 h-9 rounded-full flex items-center justify-center bg-red-500 hover:bg-red-600 text-white transition-all hover:scale-105 active:scale-95 shadow-md"
                    title="停止生成"
                  >
                    <Square size={14} fill="currentColor" />
                  </button>
                ) : (
                  <button
                    onClick={() => void handleSend()}
                    disabled={!composerInput.trim()}
                    className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${
                      composerInput.trim()
                        ? "bg-black dark:bg-white text-white dark:text-black hover:scale-105 active:scale-95 shadow-md"
                        : "bg-gray-100 dark:bg-[#2a2a2a] text-gray-400 dark:text-gray-600 cursor-not-allowed"
                    }`}
                  >
                    <ArrowUp size={18} strokeWidth={2.5} />
                  </button>
                )}
              </div>
            </div>

            <div className="flex justify-center text-sm text-gray-500 dark:text-gray-400 py-1.5 mt-2">
              <div className="w-full flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1 cursor-pointer hover:text-gray-800 dark:hover:text-gray-200 transition-colors">
                    <Monitor size={14} />
                    <span>本地</span>
                    <ChevronDown size={12} />
                  </div>
                  <div className="flex items-center gap-1 text-orange-500 dark:text-orange-400 cursor-pointer hover:text-orange-600 dark:hover:text-orange-300 transition-colors font-medium">
                    <AlertCircle size={14} />
                    <span>完全访问权限</span>
                    <ChevronDown size={12} />
                  </div>
                </div>
                <div className="flex items-center gap-1 cursor-pointer hover:text-gray-800 dark:hover:text-gray-200 transition-colors">
                  <GitBranch size={14} />
                  <span>{branchLabel}</span>
                  <ChevronDown size={12} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {uiPanels.showDiffPanel ? rightPanel : null}
    </div>
  );
}

function SlashMenuItem({
  icon,
  title,
  subtitle,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  onClick?: () => void;
}) {
  return (
    <li
      onClick={onClick}
      className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors hover:bg-gray-100 dark:hover:bg-white/5"
    >
      <div className="text-gray-500 dark:text-gray-400 flex-shrink-0">{icon}</div>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <span className="text-sm text-gray-800 dark:text-gray-200 whitespace-nowrap">
          {title}
        </span>
        {subtitle ? (
          <span className="text-xs text-gray-400 dark:text-gray-500 truncate">{subtitle}</span>
        ) : null}
      </div>
    </li>
  );
}

function HeaderMenuItem({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-100 dark:hover:bg-white/5 text-left text-sm text-gray-700 dark:text-gray-200 transition-colors"
    >
      <span>{label}</span>
    </button>
  );
}
