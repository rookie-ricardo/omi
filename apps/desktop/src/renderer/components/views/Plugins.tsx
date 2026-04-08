import React from 'react';
import { Search, ChevronDown, Plus } from 'lucide-react';

export default function Plugins() {
  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-white dark:bg-[#1e1e1e] text-gray-900 dark:text-gray-100">
      <div className="h-14 flex items-center px-6 border-b border-gray-100 dark:border-white/10 flex-shrink-0">
        <div className="font-medium text-base">Plugins</div>
      </div>
      <div className="flex-1 overflow-y-auto p-10 custom-scrollbar">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-semibold text-center mb-8">Make Codex work your way</h1>
          
          <div className="flex items-center gap-3 mb-10">
            <div className="flex-1 relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
              <input 
                type="text" 
                placeholder="Search plugins" 
                className="w-full pl-9 pr-4 py-2 bg-gray-50 dark:bg-[#252525] border border-gray-200 dark:border-white/10 rounded-lg text-sm outline-none focus:border-gray-300 dark:focus:border-gray-500 focus:bg-white dark:focus:bg-[#2a2a2a] transition-colors dark:text-gray-100 dark:placeholder-gray-500"
              />
            </div>
            <div className="flex items-center gap-2 bg-white dark:bg-[#252525] border border-gray-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm cursor-pointer transition-colors">
              <span>Built by OpenAI</span>
              <ChevronDown size={14} className="text-gray-400 dark:text-gray-500" />
            </div>
            <div className="flex items-center gap-2 bg-white dark:bg-[#252525] border border-gray-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm cursor-pointer transition-colors">
              <span>All</span>
              <ChevronDown size={14} className="text-gray-400 dark:text-gray-500" />
            </div>
          </div>

          <div className="space-y-8">
            <PluginSection title="Coding">
              <PluginCard icon="🤗" name="Hugging Face" desc="Inspect models, datasets, Spaces, and..." />
              <PluginCard icon="N" name="Netlify" desc="Deploy projects and manage releases" />
              <PluginCard icon="▲" name="Vercel" desc="Vercel ecosystem guidance for Codex" />
              <PluginCard icon="🎮" name="Game Studio" desc="Design, prototype, and ship browser..." />
              <PluginCard icon="🐙" name="GitHub" desc="Triage PRs, issues, CI, and publish flows" />
              <PluginCard icon="☁️" name="Cloudflare" desc="Cloudflare platform guidance with official..." />
              <PluginCard icon="S" name="Sentry" desc="Inspect recent Sentry issues and events" />
              <PluginCard icon="📱" name="Build iOS Apps" desc="Build, refine, and debug iOS apps with..." />
              <PluginCard icon="💻" name="Build Web Apps" desc="Build, review, ship, and scale web apps..." />
              <PluginCard icon="🤖" name="Test Android Apps" desc="Reproduce issues, inspect UI, and captur..." />
            </PluginSection>
            
            <PluginSection title="Design">
              <PluginCard icon="C" name="Canva" desc="Search, create, edit designs" />
              <PluginCard icon="F" name="Figma" desc="Design-to-code workflows powered by th..." />
            </PluginSection>
            
            <PluginSection title="Productivity">
              <PluginCard icon="T" name="Todoist" desc="Manage your tasks and projects" />
            </PluginSection>
          </div>
        </div>
      </div>
    </div>
  );
}

function PluginSection({ title, children }: { title: string, children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">{title}</h2>
      <div className="grid grid-cols-2 gap-4">
        {children}
      </div>
    </div>
  );
}

function PluginCard({ icon, name, desc }: { icon: string, name: string, desc: string }) {
  return (
    <div className="flex items-center justify-between p-4 bg-white dark:bg-[#252525] border border-gray-200 dark:border-white/10 rounded-xl hover:shadow-sm transition-shadow cursor-pointer">
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-xl font-bold dark:text-gray-200">
          {icon}
        </div>
        <div>
          <div className="font-medium text-sm text-gray-900 dark:text-gray-100">{name}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[200px]">{desc}</div>
        </div>
      </div>
      <button className="w-8 h-8 rounded-full border border-gray-200 dark:border-white/10 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
        <Plus size={16} />
      </button>
    </div>
  );
}
