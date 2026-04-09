import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowLeft,
  Box,
  Clock,
  Cog,
  Cpu,
  Edit,
  Filter,
  Copy,
  Folder,
  FolderClosed,
  FolderOpen,
  FolderPlus,
  LayoutGrid,
  Maximize2,
  Moon,
  PanelLeft,
  Pencil,
  Pin,
  Plus,
  Sun,
  X,
} from "lucide-react";

import type { Session } from "@omi/core";

import { type ViewType } from "../App";
import { getRunnerGateway } from "../lib/runner-gateway";
import {
  deriveThreadTitle,
  formatRelativeTime,
  useWorkspaceStore,
} from "../store/workspace-store";

interface SidebarProps {
  currentView: ViewType;
  setCurrentView: (view: ViewType) => void;
  isDarkMode: boolean;
  setIsDarkMode: (isDark: boolean) => void;
}

export default function Sidebar({
  currentView,
  setCurrentView,
  isDarkMode,
  setIsDarkMode,
}: SidebarProps) {
  const isSettings = currentView === "settings" || currentView === "config" || currentView === "providers";
  const bridgeAvailable = useWorkspaceStore((state) => state.bridgeAvailable);
  const sessions = useWorkspaceStore((state) => state.sessions);
  const selectedSessionId = useWorkspaceStore((state) => state.selectedSessionId);
  const folders = useWorkspaceStore((state) => state.folders);
  const folderAssignments = useWorkspaceStore((state) => state.folderAssignments);
  const openFolderIds = useWorkspaceStore((state) => state.openFolderIds);
  const activeFolderId = useWorkspaceStore((state) => state.activeFolderId);
  const firstUserMessageBySession = useWorkspaceStore(
    (state) => state.firstUserMessageBySession,
  );
  const renamedSessionIds = useWorkspaceStore((state) => state.renamedSessionIds);
  const editingSessionId = useWorkspaceStore((state) => state.editingSessionId);
  const editingSessionDraft = useWorkspaceStore((state) => state.editingSessionDraft);
  const beginNewThread = useWorkspaceStore((state) => state.beginNewThread);
  const selectSession = useWorkspaceStore((state) => state.selectSession);
  const addFolderFromDialog = useWorkspaceStore((state) => state.addFolderFromDialog);
  const toggleFolder = useWorkspaceStore((state) => state.toggleFolder);
  const removeFolder = useWorkspaceStore((state) => state.removeFolder);
  const setActiveFolder = useWorkspaceStore((state) => state.setActiveFolder);
  const startRenameSession = useWorkspaceStore((state) => state.startRenameSession);
  const setEditingSessionDraft = useWorkspaceStore((state) => state.setEditingSessionDraft);
  const cancelRenameSession = useWorkspaceStore((state) => state.cancelRenameSession);
  const commitRenameSession = useWorkspaceStore((state) => state.commitRenameSession);
  const openFolderInFinder = (folderPath: string | null) => {
    if (!folderPath) {
      return;
    }
    const gateway = getRunnerGateway();
    if (!gateway) {
      return;
    }
    void gateway.openInFinder(folderPath).catch(() => undefined);
  };

  const groupedSessions = useMemo(() => {
    const sessionMap = new Map<string, Session[]>();
    for (const folder of folders) {
      sessionMap.set(folder.id, []);
    }
    for (const session of sessions) {
      const folderId = folderAssignments[session.id] ?? activeFolderId ?? folders[0]?.id;
      if (!folderId) {
        continue;
      }
      const group = sessionMap.get(folderId) ?? [];
      group.push(session);
      sessionMap.set(folderId, group);
    }
    for (const [folderId, items] of sessionMap.entries()) {
      sessionMap.set(
        folderId,
        [...items].sort(
          (left, right) =>
            new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
        ),
      );
    }
    return sessionMap;
  }, [activeFolderId, folderAssignments, folders, sessions]);

  if (isSettings) {
    return (
      <div className="w-[260px] flex-shrink-0 bg-[#f4f4f4] dark:bg-[#252525] flex flex-col h-full transition-colors">
        <div className="h-14 flex items-center px-4 gap-2 justify-end" style={{ WebkitAppRegion: "drag" } as React.CSSProperties}>
          <div style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <button
            onClick={() => setIsDarkMode(!isDarkMode)}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            {isDarkMode ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          </div>
        </div>

        <div className="px-3 py-2">
          <div
            className="flex items-center gap-2 px-2 py-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 cursor-pointer mb-4 text-base transition-colors"
            onClick={() => setCurrentView("new-thread")}
          >
            <ArrowLeft size={16} />
            <span>返回应用</span>
          </div>

          <div className="flex flex-col gap-0.5">
            <NavItem
              icon={<Cog size={16} />}
              label="常规"
              active={currentView === "settings"}
              onClick={() => setCurrentView("settings")}
            />
            <NavItem icon={<Box size={16} />} label="Appearance" />
            <NavItem
              icon={<Box size={16} />}
              label="配置"
              active={currentView === "config"}
              onClick={() => setCurrentView("config")}
            />
            <NavItem
              icon={<Cpu size={16} />}
              label="模型提供商"
              active={currentView === "providers"}
              onClick={() => setCurrentView("providers")}
            />
            <NavItem icon={<Edit size={16} />} label="个性化" />
            <NavItem icon={<Box size={16} />} label="MCP 服务器" />
            <NavItem icon={<Box size={16} />} label="Git" />
            <NavItem icon={<LayoutGrid size={16} />} label="环境" />
            <NavItem icon={<Folder size={16} />} label="工作树" />
            <NavItem icon={<Box size={16} />} label="已归档线程" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-[260px] flex-shrink-0 bg-[#f4f4f4] dark:bg-[#252525] flex flex-col h-full transition-colors">
      <div className="h-14 flex items-center px-4 justify-end gap-2" style={{ WebkitAppRegion: "drag" } as React.CSSProperties}>
        <div className="flex items-center gap-2" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
        <PanelLeft
          size={16}
          className="cursor-pointer text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
        />
        <button
          onClick={() => setIsDarkMode(!isDarkMode)}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
        >
          {isDarkMode ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        </div>
      </div>

      <div className="px-3 py-2 flex flex-col gap-0.5">
        <NavItem
          icon={<Edit size={16} />}
          label="新线程"
          active={currentView === "new-thread"}
          onClick={() => {
            beginNewThread();
            setCurrentView("new-thread");
          }}
        />
        <NavItem
          icon={<Box size={16} />}
          label="Plugins"
          active={currentView === "plugins"}
          onClick={() => setCurrentView("plugins")}
        />
        <NavItem
          icon={<Clock size={16} />}
          label="自动化"
          active={currentView === "automations"}
          onClick={() => setCurrentView("automations")}
        />
      </div>

      <div className="flex-1 overflow-y-auto mt-4 custom-scrollbar">
        <div className="px-4 flex items-center justify-between text-gray-500 dark:text-gray-400 mb-2">
          <span className="text-sm font-medium">线程</span>
          <div className="flex items-center gap-2">
            <Maximize2
              size={14}
              className="cursor-pointer hover:text-gray-800 dark:hover:text-gray-200"
            />
            <Filter
              size={14}
              className="cursor-pointer hover:text-gray-800 dark:hover:text-gray-200"
            />
            <FolderPlus
              size={14}
              className="cursor-pointer hover:text-gray-800 dark:hover:text-gray-200"
              onClick={() => void addFolderFromDialog()}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1 px-2">
          {folders.map((folder) => {
            const folderSessions = groupedSessions.get(folder.id) ?? [];
            const open = Boolean(openFolderIds[folder.id]);
            return (
              <FolderGroup
                key={folder.id}
                folder={folder}
                open={open}
                active={activeFolderId === folder.id}
                onToggleOpen={() => toggleFolder(folder.id)}
                onActivate={() => setActiveFolder(folder.id)}
                onOpenInFinder={() => openFolderInFinder(folder.path)}
                onNewThread={() => {
                  setActiveFolder(folder.id);
                  beginNewThread();
                  setCurrentView("chat");
                }}
                onRemove={() => removeFolder(folder.id)}
              >
                {folderSessions.length === 0 ? (
                  <div className="pl-8 py-1 text-sm text-gray-400 dark:text-gray-500">无线程</div>
                ) : (
                  folderSessions.map((session) => {
                    const renamed = Boolean(renamedSessionIds[session.id]);
                    const title = deriveThreadTitle(
                      session.title,
                      firstUserMessageBySession[session.id],
                      renamed,
                    );
                    const isEditing = editingSessionId === session.id;
                    return (
                      <ThreadItem
                        key={session.id}
                        title={title}
                        time={formatRelativeTime(session.updatedAt)}
                        active={selectedSessionId === session.id && currentView === "chat"}
                        editing={isEditing}
                        editValue={editingSessionDraft}
                        onEditValueChange={setEditingSessionDraft}
                        onStartEdit={() => startRenameSession(session.id)}
                        onCancelEdit={cancelRenameSession}
                        onCommitEdit={() => void commitRenameSession()}
                        onCopySessionId={() => {
                          void navigator.clipboard.writeText(session.id);
                        }}
                        onClick={() => {
                          void selectSession(session.id);
                          setCurrentView("chat");
                        }}
                      />
                    );
                  })
                )}
              </FolderGroup>
            );
          })}
        </div>
      </div>

      <div className="p-3 transition-colors">
        <NavItem
          icon={<Cog size={16} />}
          label="设置"
          active={false}
          onClick={() => setCurrentView("settings")}
        />
      </div>
    </div>
  );
}

function NavItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer text-sm transition-colors ${
        active
          ? "bg-gray-200/80 dark:bg-gray-700/80 text-gray-900 dark:text-gray-100 font-medium"
          : "text-gray-700 dark:text-gray-300 hover:bg-gray-200/50 dark:hover:bg-gray-700/50"
      }`}
    >
      <span className={active ? "text-gray-900 dark:text-gray-100" : "text-gray-500 dark:text-gray-400"}>{icon}</span>
      <span>{label}</span>
    </div>
  );
}

function FolderGroup({
  folder,
  open,
  active,
  onToggleOpen,
  onActivate,
  onOpenInFinder,
  onNewThread,
  onRemove,
  children,
}: {
  folder: { id: string; name: string; path: string | null; kind: "mock" | "real" };
  open: boolean;
  active: boolean;
  onToggleOpen: () => void;
  onActivate: () => void;
  onOpenInFinder: () => void;
  onNewThread: () => void;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [menuOpen]);

  return (
    <div className="flex flex-col relative">
      <div
        className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer text-gray-700 dark:text-gray-300 group transition-colors hover:bg-gray-200/50 dark:hover:bg-gray-700/50"
        onClick={() => {
          onActivate();
          onToggleOpen();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          onActivate();
          setMenuOpen(true);
        }}
      >
        {open ? (
          <FolderOpen size={14} className="text-gray-600 dark:text-gray-300" />
        ) : (
          <FolderClosed size={14} className="text-gray-600 dark:text-gray-300" />
        )}
        <span className="text-sm truncate flex-1">{folder.name}</span>

        <div
          className={`flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity ${
            menuOpen ? "opacity-100" : ""
          }`}
        >
          <div
            className="p-1 hover:bg-gray-300/50 dark:hover:bg-gray-600/50 rounded text-gray-500 dark:text-gray-400"
            onClick={(event) => {
              event.stopPropagation();
              onNewThread();
            }}
          >
            <Plus size={14} />
          </div>
        </div>
      </div>

      {menuOpen ? (
        <div
          ref={menuRef}
          className="absolute left-9 top-8 z-50 w-[148px] bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-white/10 rounded-xl shadow-xl p-1.5 text-sm text-gray-700 dark:text-gray-200"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            disabled={!folder.path}
            className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left ${
              folder.path
                ? "hover:bg-gray-100 dark:hover:bg-white/10"
                : "opacity-45 cursor-not-allowed"
            }`}
            onClick={() => {
              setMenuOpen(false);
              onOpenInFinder();
            }}
          >
            <FolderOpen size={14} className="text-gray-500 dark:text-gray-400" />
            <span className="text-xs">Open In Finder</span>
          </button>
          <button
            type="button"
            disabled={folder.kind !== "real"}
            className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left ${
              folder.kind === "real"
                ? "hover:bg-gray-100 dark:hover:bg-white/10 text-red-500 dark:text-red-400"
                : "opacity-45 cursor-not-allowed text-gray-500 dark:text-gray-400"
            }`}
            onClick={() => {
              setMenuOpen(false);
              onRemove();
            }}
          >
            <X size={14} />
            <span className="text-xs">移除</span>
          </button>
        </div>
      ) : null}

      {open ? <div className="flex flex-col mt-0.5">{children}</div> : null}
    </div>
  );
}

function ThreadItem({
  title,
  time,
  active,
  editing,
  editValue,
  onEditValueChange,
  onStartEdit,
  onCancelEdit,
  onCommitEdit,
  onCopySessionId,
  onClick,
}: {
  title: string;
  time: string;
  active?: boolean;
  editing?: boolean;
  editValue: string;
  onEditValueChange: (value: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onCommitEdit: () => void;
  onCopySessionId: () => void;
  onClick?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [menuOpen]);

  return (
    <div
      onClick={() => {
        if (!editing) {
          if (menuOpen) {
            setMenuOpen(false);
            return;
          }
          onClick?.();
        }
      }}
      onContextMenu={(event) => {
        if (editing) {
          return;
        }
        event.preventDefault();
        setMenuOpen(true);
      }}
      className={`group relative flex items-center justify-between pl-8 pr-3 py-1.5 rounded-lg cursor-pointer text-sm transition-colors ${
        active
          ? "bg-gray-200/80 dark:bg-gray-700/80 text-gray-900 dark:text-gray-100"
          : "text-gray-600 dark:text-gray-400 hover:bg-gray-200/50 dark:hover:bg-gray-700/50"
      }`}
    >
      <div className="absolute left-2.5 opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">
        <Pin size={14} className="-rotate-45" />
      </div>

      {editing ? (
        <input
          className="flex-1 bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-white/10 rounded px-2 py-1 text-sm text-gray-800 dark:text-gray-200 outline-none"
          value={editValue}
          onChange={(event) => onEditValueChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onCommitEdit();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              onCancelEdit();
            }
          }}
          onBlur={() => onCommitEdit()}
          autoFocus
        />
      ) : (
        <span className="truncate flex-1 text-sm">{title}</span>
      )}

      {!editing ? (
        <>
          <span className="text-sm text-gray-400 dark:text-gray-500 ml-2 whitespace-nowrap group-hover:hidden">
            {time}
          </span>
          <div className="hidden group-hover:flex items-center ml-2 gap-1 text-gray-400 dark:text-gray-500">
            <button
              type="button"
              className="hover:text-gray-600 dark:hover:text-gray-300"
              onClick={(event) => {
                event.stopPropagation();
                onStartEdit();
              }}
            >
              <Pencil size={14} />
            </button>
            <button
              type="button"
              className={`hover:text-gray-600 dark:hover:text-gray-300 ${menuOpen ? "text-gray-600 dark:text-gray-300" : ""}`}
              onClick={(event) => {
                event.stopPropagation();
                setMenuOpen((value) => !value);
              }}
            >
              <Archive size={14} />
            </button>
          </div>
        </>
      ) : null}

      {!editing && menuOpen ? (
        <div
          ref={menuRef}
          className="absolute right-2 top-8 z-50 w-[190px] bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-white/10 rounded-xl shadow-xl p-1.5 text-sm text-gray-700 dark:text-gray-200"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-white/10 text-left"
            onClick={() => {
              setMenuOpen(false);
              onClick?.();
            }}
          >
            <Pin size={14} className="-rotate-45 text-gray-500 dark:text-gray-400" />
            <span>打开线程</span>
          </button>
          <button
            type="button"
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-white/10 text-left"
            onClick={() => {
              setMenuOpen(false);
              onStartEdit();
            }}
          >
            <Pencil size={14} className="text-gray-500 dark:text-gray-400" />
            <span>重命名线程</span>
          </button>
          <button
            type="button"
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-white/10 text-left"
            onClick={() => {
              setMenuOpen(false);
              onCopySessionId();
            }}
          >
            <Copy size={14} className="text-gray-500 dark:text-gray-400" />
            <span>复制 Session ID</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
