import { Plus } from 'lucide-react';
import ThreadLayout from '../ThreadLayout';

export default function Automations() {
  return (
    <ThreadLayout title="自动化">
      <div className="p-12 relative flex-1">
        <div className="absolute top-6 right-6">
          <button className="flex items-center gap-1 bg-black dark:bg-white text-white dark:text-black px-3 py-1.5 rounded-md text-sm font-medium hover:bg-gray-800 dark:hover:bg-gray-200 transition-colors">
            <Plus size={16} /> 新
          </button>
        </div>
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-semibold mb-2">自动化</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mb-10">Automate work by setting up scheduled threads. <span className="text-blue-500 dark:text-blue-400 cursor-pointer">Learn more</span></p>
          
          <div className="flex gap-12">
            {/* Sidebar */}
            <div className="w-48 flex-shrink-0 flex flex-col gap-3 text-sm">
              <div className="font-medium text-gray-900 dark:text-gray-100">Status reports</div>
              <div className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 cursor-pointer transition-colors">Release prep</div>
              <div className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 cursor-pointer transition-colors">Incidents & triage</div>
              <div className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 cursor-pointer transition-colors">Code quality</div>
              <div className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 cursor-pointer transition-colors">Repo maintenance</div>
              <div className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 cursor-pointer transition-colors">Growth &<br/>exploration</div>
            </div>
            
            {/* Content */}
            <div className="flex-1 space-y-10">
              <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">Status reports</h2>
                <div className="grid grid-cols-2 gap-4">
                  <AutoCard icon="💭" text="Summarize yesterday's git activity for standup." />
                  <AutoCard icon="📄" text="Synthesize this week's PRs, rollouts, incidents, and reviews into a weekly update." />
                  <AutoCard icon="📰" text="Summarize last week's PRs by teammate and theme; highlight risks." />
                </div>
              </div>
              
              <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">Release prep</h2>
                <div className="grid grid-cols-2 gap-4">
                  <AutoCard icon="📖" text="Draft weekly release notes from merged PRs (include links when available)." />
                  <AutoCard icon="✅" text="Before tagging, verify changelog, migrations, feature flags, and tests." />
                  <AutoCard icon="✏️" text="Update the changelog with this week's highlights and key PR links." />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ThreadLayout>
  );
}

function AutoCard({ icon, text }: { icon: string, text: string }) {
  return (
    <div className="bg-gray-50 dark:bg-[#252525] border border-gray-100 dark:border-white/10 rounded-xl p-5 hover:shadow-sm transition-shadow cursor-pointer flex flex-col gap-3 min-h-[120px]">
      <div className="w-8 h-8 rounded-lg bg-white dark:bg-gray-800 shadow-sm flex items-center justify-center text-lg">
        {icon}
      </div>
      <p className="text-sm text-gray-700 dark:text-gray-300 leading-snug">{text}</p>
    </div>
  );
}
