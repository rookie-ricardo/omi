import React from "react";
import { ChevronDown, FileText, Gamepad2, Pencil } from "lucide-react";

import ThreadLayout from "../ThreadLayout";
import { useWorkspaceStore } from "../../store/workspace-store";

interface NewThreadProps {
  onRunStarted: () => void;
}

export default function NewThread({ onRunStarted }: NewThreadProps) {
  const applyStarterPrompt = useWorkspaceStore((state) => state.applyStarterPrompt);
  const activeFolderId = useWorkspaceStore((state) => state.activeFolderId);
  const folders = useWorkspaceStore((state) => state.folders);
  const activeFolder = folders.find((f) => f.id === activeFolderId);

  return (
    <ThreadLayout title="新线程" onSendSuccess={onRunStarted}>
      <div className="flex-1 flex flex-col items-center justify-center pb-32 pt-20">
        <div className="mb-6">
          <div className="w-16 h-16 mx-auto mb-4 relative">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-full h-full text-gray-800 dark:text-gray-200"
            >
              <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
              <path d="M7.5 12h9" />
              <path d="M12 7.5v9" />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center bg-white dark:bg-[#1e1e1e] rounded-full">
              <svg
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
                <path d="M10 14l2-2-2-2" />
                <path d="M14 14h2" />
              </svg>
            </div>
          </div>
          <h1 className="text-3xl font-semibold text-center mb-2">开始构建</h1>
          <div className="flex items-center justify-center gap-1 text-gray-500 dark:text-gray-400 text-xl cursor-pointer hover:text-gray-800 dark:hover:text-gray-200">
            <span>{activeFolder?.name ?? "未选择文件夹"}</span>
            <ChevronDown size={20} />
          </div>
        </div>

        <div className="flex gap-4 max-w-3xl w-full px-8 mb-8">
          <Card
            icon={<Gamepad2 size={18} className="text-blue-500 dark:text-blue-400" />}
            text="Build a classic Snake game in this repo."
            onClick={() => applyStarterPrompt("Build a classic Snake game in this repo.")}
          />
          <Card
            icon={<FileText size={18} className="text-red-500 dark:text-red-400" />}
            text="Create a one-page $pdf that summarizes this app."
            onClick={() =>
              applyStarterPrompt("Create a one-page $pdf that summarizes this app.")
            }
          />
          <Card
            icon={<Pencil size={18} className="text-yellow-500 dark:text-yellow-400" />}
            text="Create a plan to..."
            onClick={() => applyStarterPrompt("Create a plan to improve this desktop app UI.")}
          />
        </div>
      </div>
    </ThreadLayout>
  );
}

function Card({
  icon,
  text,
  onClick,
}: {
  icon: React.ReactNode;
  text: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 bg-white dark:bg-[#252525] border border-gray-100 dark:border-white/10 shadow-sm hover:shadow-md transition-shadow rounded-xl p-4 cursor-pointer flex flex-col gap-2 h-28 text-left"
    >
      <div className="w-6 h-6 bg-gray-50 dark:bg-gray-800 rounded-md flex items-center justify-center">
        {icon}
      </div>
      <p className="text-sm text-gray-700 dark:text-gray-300 leading-snug">{text}</p>
    </button>
  );
}
