import { ChevronDown, ArrowUpRight, Check } from 'lucide-react';

export default function Config() {
  return (
    <div className="flex-1 overflow-y-auto h-full">
      <div className="p-10">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-2xl font-bold mb-2">配置</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mb-8">Configure approval policy and sandbox settings.</p>

          <div className="space-y-8">
            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Custom config.toml settings</h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Advanced settings for fine-tuning control. <span className="text-blue-500 dark:text-blue-400 cursor-pointer">Learn more.</span></p>
                </div>
              </div>
              
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-white/10 rounded-lg px-3 py-1.5 text-sm cursor-pointer min-w-[160px] justify-between">
                  <span>User config</span>
                  <ChevronDown size={14} className="text-gray-400 dark:text-gray-500" />
                </div>
                <div className="flex items-center gap-1 text-sm font-medium cursor-pointer hover:text-gray-600 dark:hover:text-gray-300">
                  Open config.toml <ArrowUpRight size={14} />
                </div>
              </div>

              <div className="bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-white/10 rounded-xl overflow-hidden p-1 transition-colors">
                <div className="bg-white dark:bg-[#252525] rounded-lg p-4 flex items-center justify-between mb-1 shadow-sm border border-gray-100 dark:border-white/10">
                  <div>
                    <div className="font-medium text-sm text-gray-900 dark:text-gray-100">Approval policy</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">Choose when Codex asks for approval</div>
                  </div>
                  <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm cursor-pointer min-w-[200px] justify-between">
                    <div className="flex flex-col">
                      <span className="font-medium">On request</span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">Ask when escalation is requested</span>
                    </div>
                    <ChevronDown size={14} className="text-gray-400 dark:text-gray-500" />
                  </div>
                </div>
                
                <div className="bg-white dark:bg-[#252525] rounded-lg p-4 flex items-center justify-between shadow-sm border border-gray-100 dark:border-white/10">
                  <div>
                    <div className="font-medium text-sm text-gray-900 dark:text-gray-100">Sandbox settings</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">Choose how much Codex can do when running commands</div>
                  </div>
                  <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm cursor-pointer min-w-[200px] justify-between">
                    <div className="flex flex-col">
                      <span className="font-medium">Read only</span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">Can read files, but cannot edit them</span>
                    </div>
                    <ChevronDown size={14} className="text-gray-400 dark:text-gray-500" />
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">Import external agent config</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Detect and import migratable settings from another agent.</p>
              
              <div className="bg-white dark:bg-[#252525] border border-gray-200 dark:border-white/10 rounded-xl overflow-hidden shadow-sm transition-colors">
                <div className="p-4 border-b border-gray-100 dark:border-white/10 flex items-start justify-between">
                  <div>
                    <div className="font-medium text-sm text-gray-900 dark:text-gray-100 mb-1">Config</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">Migrate /Users/rookie/.claude/settings.json into /Users/rookie/.codex/config.toml</div>
                  </div>
                  <div className="w-5 h-5 rounded border border-gray-300 dark:border-white/10 flex items-center justify-center bg-white dark:bg-gray-800 text-black dark:text-white">
                    <Check size={14} />
                  </div>
                </div>
                <div className="p-4 border-b border-gray-100 dark:border-white/10 flex items-start justify-between">
                  <div>
                    <div className="font-medium text-sm text-gray-900 dark:text-gray-100 mb-1">Skills</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">Copy skill folders from /Users/rookie/.claude/skills to /Users/rookie/.agents/skills</div>
                  </div>
                  <div className="w-5 h-5 rounded border border-gray-300 dark:border-white/10 flex items-center justify-center bg-white dark:bg-gray-800 text-black dark:text-white">
                    <Check size={14} />
                  </div>
                </div>
                <div className="p-4 border-b border-gray-100 dark:border-white/10 flex items-start justify-between">
                  <div>
                    <div className="font-medium text-sm text-gray-900 dark:text-gray-100 mb-1">AGENTS.md</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">Import /Users/rookie/.claude/CLAUDE.md to /Users/rookie/.codex/AGENTS.md</div>
                  </div>
                  <div className="w-5 h-5 rounded border border-gray-300 dark:border-white/10 flex items-center justify-center bg-white dark:bg-gray-800 text-black dark:text-white">
                    <Check size={14} />
                  </div>
                </div>
                <div className="p-4 bg-gray-50 dark:bg-gray-800/50 flex items-center justify-between">
                  <div>
                    <div className="font-medium text-sm text-gray-900 dark:text-gray-100">3 selected</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">Import selected config. Restart Codex to apply all changes.</div>
                  </div>
                  <button className="px-4 py-1.5 bg-white dark:bg-gray-700 border border-gray-200 dark:border-white/10 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-600 shadow-sm transition-colors">
                    Apply selected
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
