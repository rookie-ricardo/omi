import { useTheme } from "@/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type KeyboardEvent, useEffect, useMemo, useState } from "react";
import {
  DesktopReplicaShell,
  type OmiModelOption,
  WorkspaceStart,
} from "../../omiui";

import type {
  GitRepoState,
  ProviderConfig,
  Session,
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
import { SkillsPage } from "../skills/SkillsPage";
import { SettingsPage } from "../settings/SettingsPage";
import { BridgeUnavailable, WorkspaceContent } from "../workspace/WorkspaceContent";
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

  const workspaceName = deriveWorkspaceName(gitRepoState?.root);
  const modelOptions: OmiModelOption[] = selectedModelOptions.map((providerConfig) => ({
    id: providerConfig.id,
    label: formatProviderConfigLabel(providerConfig),
  }));

  const title =
    viewMode === "skills"
      ? "技能"
      : viewMode === "settings"
        ? "设置"
        : selectedSession?.title ?? "新线程";

  const workspaceContent =
    sessionDetailQuery.isLoading && selectedSessionId ? (
      <div className="omiui-panel-center">正在加载线程内容...</div>
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
      <WorkspaceStart
        title="开始构建"
        workspaceName={workspaceName}
        onSelectPrompt={() => setPrompt("接下来只处理桌面端 UI 问题，我需要你复刻")}
      />
    );

  const mainContent =
    viewMode === "skills" ? (
      <SkillsPage skills={skillsQuery.data ?? []} loading={skillsQuery.isLoading} />
    ) : viewMode === "settings" ? (
      <SettingsPage
        modelList={modelListQuery.data}
        loading={modelListQuery.isLoading}
        saving={savingProviderConfigKey !== null}
        onBack={() => setViewMode("workspace")}
        onSaveProvider={saveProviderConfig}
      />
    ) : (
      workspaceContent
    );

  return (
    <DesktopReplicaShell
      title={title}
      workspaceName={workspaceName}
      viewMode={viewMode}
      sessions={sessions}
      selectedSessionId={selectedSessionId}
      taskCountBySession={taskCountBySession}
      runningTaskCount={runningTaskCount}
      statLossCount={statLossCount}
      modeLabel={resolvedMode === "dark" ? "深色" : "浅色"}
      modelOptions={modelOptions}
      selectedModelId={selectedProviderConfig?.id ?? null}
      modelSwitchDisabled={!bridge || selectedModelOptions.length === 0 || Boolean(switchingModelId)}
      prompt={prompt}
      sendDisabled={!prompt.trim() || !bridge}
      composerModelLabel={selectedModelLabel}
      branchLabel={gitRepoState?.branch}
      mainContent={mainContent}
      showWorkspaceComposer={viewMode === "workspace"}
      onSelectSession={(sessionId) => {
        setSelectedSessionId(sessionId);
        setViewMode("workspace");
      }}
      onNewThread={() => void createSession()}
      onOpenSkills={() => setViewMode("skills")}
      onOpenAutomations={() => setViewMode("workspace")}
      onOpenSettings={() => setViewMode("settings")}
      onToggleTheme={() => setMode(resolvedMode === "dark" ? "light" : "dark")}
      onSwitchModel={(providerConfigId) => void switchSessionModel(providerConfigId)}
      onPromptChange={setPrompt}
      onPromptKeyDown={handleComposerKeyDown}
      onSend={() => void sendPrompt()}
    />
  );
}

function deriveSessionTitleFromPrompt(prompt: string) {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  return normalized.slice(0, 24) || "新线程";
}

function deriveWorkspaceName(rootPath: string | null | undefined) {
  if (!rootPath) {
    return "omi-codex-ui";
  }
  const normalized = rootPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const segments = normalized.split("/").filter(Boolean);
  return segments.at(-1) ?? "workspace";
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
