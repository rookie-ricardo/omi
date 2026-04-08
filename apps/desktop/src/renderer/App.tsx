/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import Sidebar from './components/Sidebar';
import MainContent from './components/MainContent';
import { useWorkspaceStore } from './store/workspace-store';

export type ViewType = 'new-thread' | 'plugins' | 'automations' | 'settings' | 'config' | 'providers' | 'chat' | 'diagnostics';

export default function App() {
  const [currentView, setCurrentView] = useState<ViewType>('new-thread');
  const [isDarkMode, setIsDarkMode] = useState(false);
  const initializeWorkspace = useWorkspaceStore((state) => state.initialize);

  useEffect(() => {
    void initializeWorkspace();
  }, [initializeWorkspace]);

  useEffect(() => {
    const gateway = window.omi;
    if (!gateway?.onMenuNavigate) return;
    return gateway.onMenuNavigate((view) => {
      if (view === "diagnostics") {
        setCurrentView("diagnostics");
      }
    });
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key === "n") {
        e.preventDefault();
        useWorkspaceStore.getState().beginNewThread();
        setCurrentView("new-thread");
      }

      if (
        e.key === "Escape" ||
        (mod && e.key === "c" && !window.getSelection()?.toString())
      ) {
        const state = useWorkspaceStore.getState();
        const sid = state.selectedSessionId;
        if (sid && state.streamingBySession[sid]) {
          e.preventDefault();
          void state.cancelRun();
        }
      }

      if (mod && e.key === "/") {
        e.preventDefault();
        const textarea = document.querySelector<HTMLTextAreaElement>(
          'textarea[placeholder*="Codex"]',
        );
        textarea?.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className={`${isDarkMode ? 'dark' : ''} h-screen w-screen overflow-hidden bg-transparent font-sans transition-colors`}>
      <div className="flex h-full w-full overflow-hidden rounded-xl border border-gray-200 dark:border-white/10 shadow-sm bg-[#f4f4f4] dark:bg-[#252525] text-gray-900 dark:text-gray-100">
        <Sidebar currentView={currentView} setCurrentView={setCurrentView} isDarkMode={isDarkMode} setIsDarkMode={setIsDarkMode} />
        <MainContent currentView={currentView} setCurrentView={setCurrentView} />
      </div>
    </div>
  );
}
