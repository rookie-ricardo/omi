import { ViewType } from '../App';
import NewThread from './views/NewThread';
import Settings from './views/Settings';
import Config from './views/Config';
import Providers from './views/Providers';
import Plugins from './views/Plugins';
import Chat from './views/Chat';
import Automations from './views/Automations';
import Diagnostics from './views/Diagnostics';

interface MainContentProps {
  currentView: ViewType;
  setCurrentView: (view: ViewType) => void;
}

export default function MainContent({ currentView, setCurrentView }: MainContentProps) {
  return (
    <div className="flex-1 bg-white dark:bg-[#1e1e1e] flex flex-col relative overflow-hidden transition-colors">
      <div className="h-4 flex-shrink-0" style={{ WebkitAppRegion: "drag" } as React.CSSProperties} />
      <div className="flex-1 overflow-hidden">
        {currentView === 'new-thread' && (
          <NewThread onRunStarted={() => setCurrentView('chat')} />
        )}
        {currentView === 'settings' && <Settings />}
        {currentView === 'config' && <Config />}
        {currentView === 'providers' && <Providers />}
        {currentView === 'plugins' && <Plugins />}
        {currentView === 'chat' && <Chat />}
        {currentView === 'automations' && <Automations />}
        {currentView === 'diagnostics' && <Diagnostics />}
      </div>
    </div>
  );
}
