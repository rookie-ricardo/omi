/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import Sidebar from './components/Sidebar';
import MainContent from './components/MainContent';
import { useWorkspaceStore } from './store/workspace-store';

export type ViewType = 'new-thread' | 'skills' | 'plugins' | 'automations' | 'settings' | 'config' | 'chat';

export default function App() {
  const [currentView, setCurrentView] = useState<ViewType>('new-thread');
  const [isDarkMode, setIsDarkMode] = useState(false);
  const initializeWorkspace = useWorkspaceStore((state) => state.initialize);

  useEffect(() => {
    void initializeWorkspace();
  }, [initializeWorkspace]);

  return (
    <div className={`${isDarkMode ? 'dark' : ''} h-screen w-screen overflow-hidden bg-[#f4f4f4] dark:bg-[#1a1a1a] font-sans transition-colors`}>
      <div className="flex h-full w-full overflow-hidden bg-[#f4f4f4] dark:bg-[#252525] text-gray-900 dark:text-gray-100">
        <Sidebar currentView={currentView} setCurrentView={setCurrentView} isDarkMode={isDarkMode} setIsDarkMode={setIsDarkMode} />
        <MainContent currentView={currentView} setCurrentView={setCurrentView} />
      </div>
    </div>
  );
}
