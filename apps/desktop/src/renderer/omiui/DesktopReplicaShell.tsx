import { cn } from "@/ui";
import type { Session } from "@omi/core";
import {
  ArrowUp,
  ChevronDown,
  CircleDot,
  Clock3,
  CopyPlus,
  FolderOpen,
  Grid2x2,
  Mic,
  PenLine,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Workflow,
  X,
} from "lucide-react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { useMemo, useState } from "react";

export type OmiViewMode = "workspace" | "skills" | "settings";

export interface OmiModelOption {
  id: string;
  label: string;
}

export interface DesktopReplicaShellProps {
  title: string;
  workspaceName: string;
  viewMode: OmiViewMode;
  sessions: Session[];
  selectedSessionId: string | null;
  taskCountBySession: Record<string, number>;
  runningTaskCount: number;
  statLossCount: number;
  modeLabel: string;
  modelOptions: OmiModelOption[];
  selectedModelId: string | null;
  modelSwitchDisabled: boolean;
  prompt: string;
  sendDisabled: boolean;
  composerModelLabel: string;
  branchLabel?: string | null;
  mainContent: ReactNode;
  showWorkspaceComposer: boolean;
  onSelectSession: (sessionId: string) => void;
  onNewThread: () => void;
  onOpenSkills: () => void;
  onOpenAutomations: () => void;
  onOpenSettings: () => void;
  onToggleTheme: () => void;
  onSwitchModel: (providerConfigId: string) => void;
  onPromptChange: (value: string) => void;
  onPromptKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
}

export function DesktopReplicaShell(props: DesktopReplicaShellProps) {
  return (
    <div
      className="desktop-layout"
      style={
        {
          "--layout-columns": "minmax(0, 320px) 1px minmax(0, 1fr)",
        } as CSSProperties
      }
    >
      <aside className="desktop-sidebar app-no-drag">
        <section className="sidebar-root">
          <div className="sidebar-scrollable">
            <nav className="sidebar-primary-nav">
              <SidebarMenuRow
                className={cn("sidebar-nav-item", props.viewMode === "workspace" && "is-active")}
                onClick={props.onNewThread}
                icon={<PenLine className="thread-icon" strokeWidth={1.8} />}
                label="新线程"
              />
              <SidebarMenuRow
                className={cn("sidebar-nav-item", props.viewMode === "skills" && "is-active")}
                onClick={props.onOpenSkills}
                icon={<Grid2x2 className="thread-icon" strokeWidth={1.8} />}
                label="技能和应用"
              />
              <SidebarMenuRow
                className="sidebar-nav-item"
                onClick={props.onOpenAutomations}
                icon={<Workflow className="thread-icon" strokeWidth={1.8} />}
                label="自动化"
              />
            </nav>

            <div className="thread-tree-root">
              <div className="sidebar-menu-row thread-tree-header-row">
                <span className="sidebar-menu-row-main">
                  <span className="thread-tree-header">线程</span>
                </span>
                <span className="sidebar-menu-row-right">
                  <span className="sidebar-menu-row-right-default">
                    <div className="thread-tree-actions">
                      <button type="button" className="thread-tree-action-btn" aria-label="搜索线程">
                        <Search className="thread-icon" />
                      </button>
                      <button type="button" className="thread-tree-action-btn" aria-label="筛选线程">
                        <SlidersHorizontal className="thread-icon" />
                      </button>
                      <button
                        type="button"
                        className="thread-tree-action-btn"
                        aria-label="创建线程"
                        onClick={props.onNewThread}
                      >
                        <Plus className="thread-icon" />
                      </button>
                    </div>
                  </span>
                </span>
              </div>

              <div className="sidebar-menu-row project-header-row">
                <span className="sidebar-menu-row-left">
                  <span className="project-icon-stack">
                    <span className="project-icon-folder">
                      <FolderOpen className="thread-icon" />
                    </span>
                    <span className="project-icon-chevron">
                      <ChevronDown className="thread-icon" />
                    </span>
                  </span>
                </span>
                <span className="sidebar-menu-row-main">
                  <span className="project-main-button">
                    <span className="project-title">{props.workspaceName}</span>
                  </span>
                </span>
              </div>

              {props.sessions.length === 0 ? (
                <div className="sidebar-menu-row project-empty-row">
                  <span className="sidebar-menu-row-left">
                    <span className="project-empty-spacer" />
                  </span>
                  <span className="sidebar-menu-row-main">
                    <span className="project-empty">无线程</span>
                  </span>
                </div>
              ) : (
                <ul className="thread-list">
                  {props.sessions.map((session) => (
                    <li key={session.id} className="thread-row-item">
                      <ThreadRow
                        session={session}
                        active={
                          session.id === props.selectedSessionId && props.viewMode === "workspace"
                        }
                        pendingTaskCount={props.taskCountBySession[session.id] ?? 0}
                        onClick={() => props.onSelectSession(session.id)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="sidebar-settings-area">
            <button className="sidebar-settings-button" type="button" onClick={props.onOpenSettings}>
              <Settings className="sidebar-settings-icon" strokeWidth={2} />
              <span>设置</span>
            </button>
          </div>
        </section>
      </aside>

      <div className="desktop-resize-handle" />

      <section className="desktop-main">
        <section className="content-root">
          <header className="content-header app-drag">
            <div className="content-leading" />
            <h1 className="content-title">{props.title}</h1>
            <div className="content-actions app-no-drag">
              <label className="header-pill-select">
                <CircleDot className="header-pill-icon" strokeWidth={1.8} />
                <select
                  value={props.selectedModelId ?? ""}
                  disabled={props.modelSwitchDisabled}
                  onChange={(event) => props.onSwitchModel(event.target.value)}
                >
                  {props.modelOptions.length === 0 ? (
                    <option value="">未配置模型</option>
                  ) : (
                    props.modelOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))
                  )}
                </select>
                <ChevronDown className="header-pill-chevron" strokeWidth={1.9} />
              </label>

              <button type="button" className="header-pill-button">
                <CircleDot className="header-pill-icon" strokeWidth={1.8} />
                提交
                <ChevronDown className="header-pill-chevron" strokeWidth={1.9} />
              </button>

              <div className="header-divider" />

              <button
                type="button"
                className="header-icon-button"
                title={props.modeLabel}
                onClick={props.onToggleTheme}
              >
                <CircleDot className="header-icon-size" strokeWidth={1.8} />
              </button>
              <button type="button" className="header-icon-button">
                <CopyPlus className="header-icon-size" strokeWidth={1.8} />
              </button>
              <button type="button" className="header-icon-button" onClick={props.onNewThread}>
                <Plus className="header-icon-size" strokeWidth={1.8} />
              </button>

              <div className="header-stats">
                <span className="header-stats-positive">+{props.runningTaskCount}</span>
                <span className="header-stats-negative">-{props.statLossCount}</span>
              </div>
            </div>
          </header>

          <section className="content-body">
            <div className="content-grid-shell">{props.mainContent}</div>

            {props.showWorkspaceComposer ? (
              <WorkspaceComposer
                threadCount={props.sessions.length}
                prompt={props.prompt}
                sendDisabled={props.sendDisabled}
                modelLabel={props.composerModelLabel}
                branchLabel={props.branchLabel}
                onNewThread={props.onNewThread}
                onPromptChange={props.onPromptChange}
                onPromptKeyDown={props.onPromptKeyDown}
                onSend={props.onSend}
              />
            ) : null}
          </section>
        </section>
      </section>
    </div>
  );
}

function SidebarMenuRow(props: {
  icon: ReactNode;
  label: string;
  className?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn("sidebar-menu-row", props.className)}
      onClick={props.onClick}
    >
      <span className="sidebar-menu-row-left">{props.icon}</span>
      <span className="sidebar-menu-row-main">{props.label}</span>
    </button>
  );
}

function ThreadRow(props: {
  session: Session;
  active: boolean;
  pendingTaskCount: number;
  onClick: () => void;
}) {
  return (
    <button type="button" className="sidebar-menu-row thread-row" data-active={props.active} onClick={props.onClick}>
      <span className="sidebar-menu-row-left">
        <span className="thread-left-stack">
          <span className="thread-status-indicator" data-state="idle" />
        </span>
      </span>
      <span className="sidebar-menu-row-main">
        <span className="thread-main-button">
          <span className="thread-row-title-wrap">
            <span className="thread-row-title">{props.session.title}</span>
          </span>
        </span>
      </span>
      <span className="sidebar-menu-row-right">
        <span className="sidebar-menu-row-right-default">
          <span className="thread-row-time">{formatRelativeTime(props.session.updatedAt)}</span>
        </span>
      </span>
      <div className="thread-row-extra" aria-hidden="true">
        {props.pendingTaskCount > 0 ? `待办 ${props.pendingTaskCount}` : ""}
      </div>
    </button>
  );
}

function WorkspaceComposer(props: {
  threadCount: number;
  prompt: string;
  sendDisabled: boolean;
  modelLabel: string;
  branchLabel?: string | null;
  onNewThread: () => void;
  onPromptChange: (value: string) => void;
  onPromptKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
}) {
  const [bannerHidden, setBannerHidden] = useState(false);
  const bannerText = useMemo(() => {
    if (props.threadCount <= 0) {
      return "Fast could save about 10 hours 23 minutes. Uses 2x plan usage.";
    }
    return `Based on your work last week across ${props.threadCount} threads, Fast could have saved about 10 hours 23 minutes. Uses 2x plan usage.`;
  }, [props.threadCount]);

  return (
    <section className="thread-composer">
      {bannerHidden ? null : (
        <div className="fast-banner-card">
          <div className="fast-banner-copy">
            <div className="fast-banner-title">Toggle /Fast</div>
            <div className="fast-banner-text">
              <Sparkles className="fast-banner-bolt" strokeWidth={1.9} />
              <span>{bannerText}</span>
            </div>
          </div>
          <div className="fast-banner-actions">
            <button type="button" className="fast-banner-enable">
              Enable now
            </button>
            <button
              type="button"
              className="fast-banner-close"
              aria-label="关闭 Fast 提示"
              onClick={() => setBannerHidden(true)}
            >
              <X strokeWidth={1.9} size={14} />
            </button>
          </div>
        </div>
      )}

      <div className="thread-composer-shell">
        <div className="thread-composer-input-wrap">
          <textarea
            value={props.prompt}
            onChange={(event) => props.onPromptChange(event.target.value)}
            onKeyDown={props.onPromptKeyDown}
            className="thread-composer-input"
            placeholder="接下来只处理桌面端 UI 问题，我需要你复刻"
            rows={2}
          />
        </div>

        <div className="thread-composer-controls">
          <div className="thread-composer-attach">
            <button
              type="button"
              className="thread-composer-attach-trigger"
              aria-label="创建线程"
              onClick={props.onNewThread}
            >
              +
            </button>
          </div>

          <button type="button" className="composer-dropdown-trigger">
            {props.modelLabel}
            <ChevronDown className="composer-dropdown-chevron" />
          </button>
          <button type="button" className="composer-dropdown-trigger">
            超高
            <ChevronDown className="composer-dropdown-chevron" />
          </button>

          <div className="thread-composer-actions">
            <button type="button" className="thread-composer-mic" aria-label="语音输入">
              <Mic className="thread-composer-mic-icon" strokeWidth={1.9} />
            </button>
            <button
              type="button"
              className="thread-composer-submit"
              aria-label="发送"
              disabled={props.sendDisabled}
              onClick={props.onSend}
            >
              <ArrowUp className="thread-composer-submit-icon" strokeWidth={2.1} />
            </button>
          </div>
        </div>
      </div>

      <div className="thread-composer-rate-limit">
        <div className="thread-composer-rate-limit-row">
          <span>本地</span>
          <span className="thread-composer-safe-text">完全访问权限</span>
          <span className="thread-composer-rate-limit-spacer" />
          <Clock3 className="thread-composer-rate-limit-clock" strokeWidth={1.8} size={12} />
          <span>{props.branchLabel ?? "non-git"}</span>
        </div>
      </div>
    </section>
  );
}

export function WorkspaceStart(props: { title: string; workspaceName: string; onSelectPrompt: () => void }) {
  return (
    <div className="content-grid">
      <div className="new-thread-empty">
        <div className="new-thread-mark">
          <Sparkles className="new-thread-mark-icon" strokeWidth={1.95} />
        </div>
        <h1 className="new-thread-hero">{props.title}</h1>
        <button type="button" className="new-thread-folder-dropdown" onClick={props.onSelectPrompt}>
          <span>{props.workspaceName}</span>
          <ChevronDown className="new-thread-folder-dropdown-chevron" strokeWidth={1.9} />
        </button>
      </div>
    </div>
  );
}

function formatRelativeTime(input: string) {
  const timestamp = new Date(input).getTime();
  const delta = Date.now() - timestamp;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (delta < hour) {
    return `${Math.max(1, Math.floor(delta / minute))} 分`;
  }
  if (delta < day) {
    return `${Math.max(1, Math.floor(delta / hour))} 小时`;
  }
  if (delta < day * 7) {
    return `${Math.max(1, Math.floor(delta / day))} 天`;
  }
  if (delta < day * 30) {
    return `${Math.max(1, Math.floor(delta / (day * 7)))} 周`;
  }
  return `${Math.max(1, Math.floor(delta / (day * 30)))} 月`;
}
