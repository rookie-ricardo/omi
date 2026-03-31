import { Button, cn, useTheme } from "@/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  CircleDot,
  Clock3,
  FileText,
  Folder,
  Grid2x2,
  MoonStar,
  PenLine,
  Plus,
  Settings2,
  SunMedium,
} from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useState } from "react";

import type {
  GitDiffPreview,
  GitRepoState,
  ProviderConfig,
  Session,
  SessionStatus,
  SkillDescriptor,
  Task,
} from "@omi/core";
import type {
  ModelListResult,
  SessionModelSwitchResult,
  SessionRuntimeGetResult,
  ToolPendingListResult,
} from "@omi/protocol";

import { type RunnerEventState, useRunnerEvents } from "../../store";
import { GitDiffModal } from "../git/GitDiffModal";
import { GitSidebar } from "../git/GitSidebar";
import { SkillsPage } from "../skills/SkillsPage";
import { SettingsPage } from "../settings/SettingsPage";
import { Composer } from "../workspace/Composer";
import {
  BridgeUnavailable,
  EmptyWorkspace,
  WorkspaceContent,
  statusClasses,
  statusLabel,
} from "../workspace/WorkspaceContent";
import { type RunnerEvent } from "../workspace/event-utils";
import {
  buildSessionModelOptions,
  formatProviderConfigLabel,
  resolveSessionModel,
} from "./model-governance";

interface SessionDetailResponse {
  session: Session;
  messages: Array<{ id: string; role: string; content: string; createdAt: string }>;
  tasks: Task[];
}

type ViewMode = "workspace" | "skills" | "settings";
type SettingsSaveInput = {
  id?: string;
  type: string;
  baseUrl: string;
  model: string;
  apiKey: string;
};

export function App() {
  const queryClient = useQueryClient();
  const { resolvedMode, setMode } = useTheme();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("workspace");
  const [selectedDiffPath, setSelectedDiffPath] = useState<string | null>(null);
  const [switchingModelId, setSwitchingModelId] = useState<string | null>(null);
  const [savingProviderConfigKey, setSavingProviderConfigKey] = useState<string | null>(null);
  const appendRunEvent = useRunnerEvents((state: RunnerEventState) => state.appendRunEvent);
  const bridge = getOmiBridge();

  const sessionsQuery = useQuery({
    queryKey: ["sessions"],
    enabled: bridge !== null,
    queryFn: () => requireBridge(bridge).invoke<Session[]>("session.list"),
  });
  const tasksQuery = useQuery({
    queryKey: ["tasks"],
    enabled: bridge !== null,
    queryFn: () => requireBridge(bridge).invoke<Task[]>("task.list"),
  });
  const skillsQuery = useQuery({
    queryKey: ["skills"],
    enabled: bridge !== null,
    queryFn: () => requireBridge(bridge).invoke<SkillDescriptor[]>("skill.list"),
  });
  const modelListQuery = useQuery({
    queryKey: ["models"],
    enabled: bridge !== null,
    queryFn: () => requireBridge(bridge).invoke<ModelListResult>("model.list"),
  });
  const gitStatusQuery = useQuery({
    queryKey: ["git", "status"],
    enabled: bridge !== null,
    queryFn: () => requireBridge(bridge).invoke<GitRepoState>("git.status"),
  });
  const gitDiffQuery = useQuery({
    queryKey: ["git", "diff", selectedDiffPath],
    enabled: bridge !== null && Boolean(selectedDiffPath),
    queryFn: () =>
      requireBridge(bridge).invoke<GitDiffPreview>("git.diff", {
        path: selectedDiffPath,
      }),
  });

  useEffect(() => {
    if (!bridge) {
      return;
    }

    const unsubscribe = bridge.subscribe((rawEvent) => {
      const event = rawEvent as RunnerEvent;
      const runId = typeof event.payload.runId === "string" ? event.payload.runId : undefined;
      if (runId) {
        appendRunEvent(runId, event);
      }

      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      void queryClient.invalidateQueries({ queryKey: ["git", "status"] });
      if (selectedSessionId) {
        void queryClient.invalidateQueries({ queryKey: ["session", selectedSessionId] });
        void queryClient.invalidateQueries({ queryKey: ["session", selectedSessionId, "runtime"] });
        void queryClient.invalidateQueries({
          queryKey: ["session", selectedSessionId, "tool.pending.list"],
        });
      }
    });
    return unsubscribe;
  }, [appendRunEvent, bridge, queryClient, selectedSessionId]);

  useEffect(() => {
    if (!selectedSessionId && sessionsQuery.data?.[0]) {
      setSelectedSessionId(sessionsQuery.data[0].id);
    }
  }, [selectedSessionId, sessionsQuery.data]);

  const sessionDetailQuery = useQuery({
    queryKey: ["session", selectedSessionId],
    enabled: bridge !== null && Boolean(selectedSessionId),
    queryFn: () =>
      requireBridge(bridge).invoke<SessionDetailResponse>("session.get", {
        sessionId: selectedSessionId,
      }),
  });
  const sessionRuntimeQuery = useQuery({
    queryKey: ["session", selectedSessionId, "runtime"],
    enabled: bridge !== null && Boolean(selectedSessionId),
    queryFn: () => {
      if (!selectedSessionId) {
        throw new Error("No session selected");
      }

      return requireBridge(bridge).invoke<SessionRuntimeGetResult>("session.runtime.get", {
        sessionId: selectedSessionId,
      });
    },
  });

  const pendingApprovalsQuery = useQuery({
    queryKey: ["session", selectedSessionId, "tool.pending.list"],
    enabled: bridge !== null && Boolean(selectedSessionId),
    queryFn: () =>
      requireBridge(bridge).invoke<ToolPendingListResult>("tool.pending.list", {
        sessionId: selectedSessionId,
      }),
  });

  const tasks = tasksQuery.data ?? [];
  const sessions = sessionsQuery.data ?? [];
  const taskCountBySession = useMemo(() => {
    return tasks.reduce<Record<string, number>>((accumulator, task) => {
      if (task.status === "dismissed" || task.status === "done") {
        return accumulator;
      }
      accumulator[task.originSessionId] = (accumulator[task.originSessionId] ?? 0) + 1;
      return accumulator;
    }, {});
  }, [tasks]);

  const selectedSession =
    sessionDetailQuery.data?.session ??
    sessions.find((session) => session.id === selectedSessionId) ??
    null;
  const selectedProviderConfig = resolveSessionModel(
    modelListQuery.data,
    sessionRuntimeQuery.data,
  );
  const selectedModelOptions = buildSessionModelOptions(
    modelListQuery.data,
    sessionRuntimeQuery.data,
  );
  const selectedTasks =
    sessionDetailQuery.data?.tasks ??
    tasks.filter((task) => task.originSessionId === selectedSessionId);
  const selectedPendingApprovals = pendingApprovalsQuery.data?.pendingToolCalls ?? [];
  const hasWorkspaceContent =
    (sessionDetailQuery.data?.messages.length ?? 0) > 0 ||
    selectedTasks.length > 0 ||
    selectedPendingApprovals.length > 0;

  const runningTaskCount = tasks.filter((task) => task.status === "active").length;
  const blockedSessionCount = sessions.filter((session) => session.status === "blocked").length;
  const statLossCount = blockedSessionCount + selectedPendingApprovals.length;
  const gitRepoState = gitStatusQuery.data;
  const selectedModelLabel = formatProviderConfigLabel(selectedProviderConfig);

  async function createSession(title = "新线程") {
    const activeBridge = requireBridge(bridge);
    const session = await activeBridge.invoke<Session>("session.create", { title });
    setSelectedSessionId(session.id);
    setViewMode("workspace");
    await queryClient.invalidateQueries({ queryKey: ["sessions"] });
    return session;
  }

  async function sendPrompt() {
    const draft = prompt.trim();
    if (!draft || !bridge) {
      return;
    }

    const session = selectedSession ?? (await createSession(deriveSessionTitleFromPrompt(draft)));
    await requireBridge(bridge).invoke("run.start", {
      sessionId: session.id,
      taskId: null,
      prompt: draft,
    });
    setPrompt("");
    setViewMode("workspace");
    await queryClient.invalidateQueries({ queryKey: ["sessions"] });
    await queryClient.invalidateQueries({ queryKey: ["session", session.id] });
    await queryClient.invalidateQueries({ queryKey: ["session", session.id, "tool.pending.list"] });
  }

  async function switchSessionModel(providerConfigId: string) {
    if (
      !bridge ||
      !selectedSessionId ||
      !providerConfigId ||
      providerConfigId === selectedProviderConfig?.id
    ) {
      return;
    }

    setSwitchingModelId(providerConfigId);
    try {
      await requireBridge(bridge).invoke<SessionModelSwitchResult>("session.model.switch", {
        sessionId: selectedSessionId,
        providerConfigId,
      });
      await queryClient.invalidateQueries({ queryKey: ["session", selectedSessionId, "runtime"] });
    } finally {
      setSwitchingModelId(null);
    }
  }

  async function saveProviderConfig(input: SettingsSaveInput): Promise<ProviderConfig> {
    const activeBridge = requireBridge(bridge);
    const savingKey = input.id ?? `new:${input.type}`;
    setSavingProviderConfigKey(savingKey);
    try {
      const saved = await activeBridge.invoke<ProviderConfig>("provider.config.save", input);
      await queryClient.invalidateQueries({ queryKey: ["models"] });
      if (selectedSessionId) {
        await queryClient.invalidateQueries({ queryKey: ["session", selectedSessionId, "runtime"] });
      }
      return saved;
    } finally {
      setSavingProviderConfigKey(null);
    }
  }

  async function approveTool(toolCallId: string) {
    if (!bridge) {
      return;
    }
    await bridge.invoke("tool.approve", { toolCallId, decision: "approved" });
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void sendPrompt();
    }
  }

  const title =
    viewMode === "skills"
      ? "技能"
      : viewMode === "settings"
        ? "设置"
        : selectedSession?.title ?? "新线程";

  return (
    <div className="h-screen overflow-hidden bg-[linear-gradient(180deg,_color-mix(in_oklab,var(--background)_94%,black)_0%,_var(--background)_100%)] text-foreground">
      <div className="app-drag pointer-events-none absolute inset-x-0 top-0 z-20 h-12" />
      <div className="flex h-full">
        <aside
          className={cn(
            "flex w-[304px] shrink-0 flex-col border-r border-white/6 backdrop-blur-2xl",
            resolvedMode === "dark"
              ? "bg-[linear-gradient(180deg,rgba(42,41,40,0.96)_0%,rgba(42,41,40,0.88)_100%)]"
              : "bg-[linear-gradient(180deg,color-mix(in_oklab,var(--foreground)_12%,transparent)_0%,color-mix(in_oklab,var(--foreground)_8%,transparent)_100%)]",
          )}
        >
          <div className="px-3 pt-[3.25rem]">
            <div className="grid gap-[5px]">
              <QuickAction
                icon={PenLine}
                label="新线程"
                active={viewMode === "workspace"}
                onClick={() => void createSession()}
              />
              <QuickAction
                icon={Clock3}
                label="自动化"
                active={false}
                onClick={() => setViewMode("workspace")}
              />
              <QuickAction
                icon={Grid2x2}
                label="技能"
                active={viewMode === "skills"}
                onClick={() => setViewMode("skills")}
              />
            </div>
          </div>

          <div className="mt-9 flex items-center justify-between px-5 text-[12.5px] tracking-[-0.01em] text-white/33">
            <span>线程</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void createSession()}
                className="app-no-drag rounded-full p-1 text-white/50 transition-colors hover:bg-white/[0.04] hover:text-white/76"
                aria-label="创建线程"
              >
                <Plus className="size-[15px]" />
              </button>
              <button
                type="button"
                className="app-no-drag rounded-full p-1 text-white/50 transition-colors hover:bg-white/[0.04] hover:text-white/76"
                aria-label="折叠列表"
              >
                <ChevronDown className="size-[15px] -rotate-90" />
              </button>
            </div>
          </div>

          <div className="mt-3.5 flex items-center gap-3 px-5 text-white/86">
            <Folder className="size-[17px] shrink-0 text-white/80" strokeWidth={1.65} />
            <span className="text-[14px] font-medium tracking-[-0.016em] text-white/86">omi</span>
          </div>

          <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            <div className="grid gap-1.5">
              {sessions.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-foreground/12 px-4 py-5 text-sm text-foreground/50">
                  还没有线程，先创建一个开始构建。
                </div>
              ) : (
                sessions.map((session) => (
                  <SidebarSessionItem
                    key={session.id}
                    session={session}
                    active={session.id === selectedSessionId && viewMode === "workspace"}
                    pendingTaskCount={taskCountBySession[session.id] ?? 0}
                    onClick={() => {
                      setSelectedSessionId(session.id);
                      setViewMode("workspace");
                    }}
                  />
                ))
              )}
            </div>
          </div>

          <div className="border-t border-foreground/8 p-3">
            <button
              type="button"
              onClick={() => setViewMode("settings")}
              className="app-no-drag flex w-full items-center gap-3.5 rounded-[17px] px-4 py-[0.78rem] text-[14px] leading-5 tracking-[-0.012em] text-white/78 transition-colors hover:bg-white/[0.04] hover:text-white/90"
            >
              <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center">
                <Settings2
                  className={cn(
                    "size-[17px]",
                    viewMode === "settings" ? "text-white/90" : "text-white/72",
                  )}
                  strokeWidth={1.65}
                />
              </span>
              <span className={cn(viewMode === "settings" ? "text-white/92" : undefined)}>设置</span>
            </button>
          </div>
        </aside>

        <main className="relative min-w-0 flex-1 overflow-hidden bg-[radial-gradient(circle_at_center,_color-mix(in_oklab,var(--foreground)_2%,transparent)_0%,_transparent_55%),linear-gradient(180deg,_color-mix(in_oklab,var(--background)_96%,black)_0%,_var(--background)_100%)]">
          <div className="absolute left-5 top-6 z-10">
            <div className="text-sm font-semibold">{title}</div>
            {viewMode === "workspace" ? (
              <div className="app-no-drag mt-2 inline-flex items-center gap-2 rounded-full border border-foreground/10 bg-background/78 px-3 py-2 text-xs text-foreground/62 shadow-[0_10px_30px_color-mix(in_oklab,var(--foreground)_4%,transparent)] backdrop-blur-xl">
                <span className="text-foreground/46">当前模型</span>
                <select
                  value={selectedProviderConfig?.id ?? ""}
                  onChange={(event) => void switchSessionModel(event.target.value)}
                  disabled={!bridge || selectedModelOptions.length === 0 || Boolean(switchingModelId)}
                  className="appearance-none border-0 bg-transparent p-0 pr-5 text-xs font-medium text-foreground outline-none ring-0 focus:ring-0"
                >
                  {selectedModelOptions.length === 0 ? (
                    <option value="">未配置模型</option>
                  ) : (
                    selectedModelOptions.map((providerConfig) => (
                      <option key={providerConfig.id} value={providerConfig.id}>
                        {formatProviderConfigLabel(providerConfig)}
                      </option>
                    ))
                  )}
                </select>
                <ChevronDown className="size-3.5 text-foreground/35" />
              </div>
            ) : null}
          </div>

          <div className="app-no-drag absolute right-5 top-4 z-10 flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setMode(resolvedMode === "dark" ? "light" : "dark")}
              className="h-9 rounded-xl px-3"
            >
              {resolvedMode === "dark" ? (
                <SunMedium className="size-4" />
              ) : (
                <MoonStar className="size-4" />
              )}
              <ChevronDown className="size-3.5 text-foreground/45" />
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-9 rounded-xl px-4">
              <CircleDot className="size-[16px]" strokeWidth={1.75} />
              提交
              <ChevronDown className="size-3.5 text-foreground/45" />
            </Button>
            <div className="h-5 w-px bg-foreground/10" />
            <button
              type="button"
              className="inline-flex size-8 items-center justify-center rounded-lg text-foreground/45 transition-colors hover:bg-foreground/5 hover:text-foreground/72"
              aria-label="复制"
            >
              <FileText className="size-4" strokeWidth={1.75} />
            </button>
            <button
              type="button"
              className="inline-flex size-8 items-center justify-center rounded-lg text-foreground/45 transition-colors hover:bg-foreground/5 hover:text-foreground/72"
              aria-label="新建"
              onClick={() => void createSession()}
            >
              <Plus className="size-4" strokeWidth={1.75} />
            </button>
            <div className="flex items-center gap-1 text-sm tabular-nums">
              <span className="text-success">+{runningTaskCount}</span>
              <span className="text-destructive">-{statLossCount}</span>
            </div>
          </div>

          <div className="relative z-10 flex h-full min-h-0 px-12 pb-4 pt-16">
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="min-h-0 flex-1">
                {viewMode === "skills" ? (
                  <SkillsPage skills={skillsQuery.data ?? []} loading={skillsQuery.isLoading} />
                ) : viewMode === "settings" ? (
                  <SettingsPage
                    modelList={modelListQuery.data}
                    loading={modelListQuery.isLoading}
                    saving={savingProviderConfigKey !== null}
                    onBack={() => setViewMode("workspace")}
                    onSaveProvider={saveProviderConfig}
                  />
                ) : sessionDetailQuery.isLoading && selectedSessionId ? (
                  <div className="flex h-full items-center justify-center text-sm text-foreground/45">
                    正在加载线程内容...
                  </div>
                ) : !bridge ? (
                  <BridgeUnavailable />
                ) : hasWorkspaceContent ? (
                  <WorkspaceContent
                    session={selectedSession}
                    detail={sessionDetailQuery.data}
                    tasks={selectedTasks}
                    pendingApprovals={selectedPendingApprovals}
                    onApproveTool={approveTool}
                  />
                ) : (
                  <EmptyWorkspace
                    title="开始构建"
                    subtitle="omi"
                    onSelectPrompt={(value) => setPrompt(value)}
                  />
                )}
              </div>

              {viewMode === "workspace" ? (
                <Composer
                  prompt={prompt}
                  branchLabel={gitRepoState?.branch}
                  modelLabel={selectedModelLabel}
                  onPromptChange={setPrompt}
                  onKeyDown={handleComposerKeyDown}
                  onCreateSession={() => void createSession()}
                  onSend={() => void sendPrompt()}
                  disabled={!prompt.trim() || !bridge}
                />
              ) : null}
            </div>

            {viewMode === "workspace" && gitRepoState?.hasRepository ? (
              <GitSidebar
                repoState={gitRepoState}
                selectedPath={selectedDiffPath}
                onOpenDiff={setSelectedDiffPath}
              />
            ) : null}
          </div>
        </main>
      </div>

      <GitDiffModal
        preview={gitDiffQuery.data ?? null}
        loading={gitDiffQuery.isLoading}
        onClose={() => setSelectedDiffPath(null)}
      />
    </div>
  );
}

function QuickAction(props: {
  icon: typeof PenLine;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={cn(
        "app-no-drag flex items-center gap-3.5 rounded-[10px] px-4 py-[0.52rem] text-[14px] leading-5 tracking-[-0.012em] transition-colors",
        props.active
          ? "bg-white/[0.065] text-white/92 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]"
          : "text-white/82 hover:bg-white/[0.04] hover:text-white/92",
      )}
    >
      <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center">
        <props.icon
          className={cn("size-[17px] shrink-0", props.active ? "text-white/88" : "text-white/76")}
          strokeWidth={1.8}
        />
      </span>
      <span className={cn(props.active ? "font-medium text-white/92" : "font-normal text-white/82")}>
        {props.label}
      </span>
    </button>
  );
}

function SidebarSessionItem(props: {
  session: Session;
  active: boolean;
  pendingTaskCount: number;
  onClick: () => void;
}) {
  const preview = props.session.latestUserMessage ?? props.session.latestAssistantMessage ?? "等待新的输入...";

  return (
    <button
      type="button"
      onClick={props.onClick}
      className={cn(
        "w-full rounded-3xl px-4 py-3 text-left transition-colors",
        props.active ? "bg-foreground/8" : "hover:bg-foreground/5",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-medium text-foreground">
            {props.session.title}
          </div>
          <div className="mt-1 line-clamp-2 text-sm leading-5 text-foreground/56">{preview}</div>
        </div>
        <div className="shrink-0 text-xs text-foreground/42">
          {formatRelativeTime(props.session.updatedAt)}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between text-xs">
        <span className={cn("rounded-full px-2 py-1", statusClasses(props.session.status))}>
          {statusLabel(props.session.status)}
        </span>
        {props.pendingTaskCount > 0 ? (
          <span className="tabular-nums text-success">+{props.pendingTaskCount}</span>
        ) : (
          <span className="text-foreground/34">空</span>
        )}
      </div>
    </button>
  );
}

function formatRelativeTime(input: string) {
  const timestamp = new Date(input).getTime();
  const delta = Date.now() - timestamp;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (delta < hour) {
    return `${Math.max(1, Math.floor(delta / minute))} 分钟前`;
  }
  if (delta < day) {
    return `${Math.max(1, Math.floor(delta / hour))} 小时前`;
  }
  if (delta < day * 30) {
    return `${Math.max(1, Math.floor(delta / day))} 天前`;
  }
  return `${Math.max(1, Math.floor(delta / (day * 30)))} 个月前`;
}

function deriveSessionTitleFromPrompt(prompt: string) {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  return normalized.slice(0, 24) || "新线程";
}

function getOmiBridge() {
  if (typeof window === "undefined") {
    return null;
  }
  return typeof window.omi === "object" && window.omi !== null ? window.omi : null;
}

function requireBridge(bridge: ReturnType<typeof getOmiBridge>) {
  if (!bridge) {
    throw new Error("Desktop bridge is unavailable.");
  }
  return bridge;
}
