import React from 'react';
import { ChevronDown } from 'lucide-react';
import ThreadLayout from '../ThreadLayout';

export default function Settings() {
  return (
    <ThreadLayout title="设置">
      <div className="p-10">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-2xl font-bold mb-8">常规</h1>

          <div className="space-y-8">
            {/* Section 1 */}
            <div className="bg-white dark:bg-[#252525] border border-gray-200 dark:border-white/10 rounded-xl overflow-hidden shadow-sm transition-colors">
              <SettingRow 
                title="默认打开目标" 
                description="默认打开文件和文件夹的位置"
                control={
                  <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-white/10 rounded-lg px-3 py-1.5 text-sm cursor-pointer">
                    <span className="text-blue-500 dark:text-blue-400">VS Code</span>
                    <ChevronDown size={14} className="text-gray-400 dark:text-gray-500" />
                  </div>
                }
              />
              <SettingRow 
                title="语言" 
                description="应用 UI 语言"
                control={
                  <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-white/10 rounded-lg px-3 py-1.5 text-sm cursor-pointer min-w-[120px] justify-between">
                    <span>自动检测</span>
                    <ChevronDown size={14} className="text-gray-400 dark:text-gray-500" />
                  </div>
                }
              />
              <SettingRow 
                title="线程详细信息" 
                description="选择线程中命令输出的显示量"
                control={
                  <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-white/10 rounded-lg px-3 py-1.5 text-sm cursor-pointer min-w-[160px] justify-between">
                    <span>带代码命令的步骤</span>
                    <ChevronDown size={14} className="text-gray-400 dark:text-gray-500" />
                  </div>
                }
              />
              <SettingRow 
                title="Popout Window hotkey" 
                description="Set a global shortcut for Popout Window. Leave unset to keep it off."
                control={
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-500 dark:text-gray-400">Off</span>
                    <button className="px-3 py-1 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md text-sm font-medium transition-colors">Set</button>
                  </div>
                }
              />
              <SettingRow 
                title="运行时防止系统休眠" 
                description="在 Codex 运行任务线程时，让你的电脑保持唤醒状态。"
                control={<Toggle />}
              />
              <SettingRow 
                title="需按 ⌘ + 回车键发送长文本提示" 
                description="启用后，长文本提示需按 ⌘ + 回车键发送。"
                control={<Toggle />}
              />
              <SettingRow 
                title="跟进行为" 
                description="在 Codex 运行排队跟进任务，或引导当前运行。按 ⇧⌘Enter 可对单条消息执行相反操作。"
                control={
                  <div className="flex bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
                    <div className="px-3 py-1 text-sm bg-white dark:bg-gray-700 shadow-sm rounded-md font-medium">排队</div>
                    <div className="px-3 py-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 cursor-pointer">引导</div>
                  </div>
                }
                isLast
              />
            </div>

            {/* Section 2 */}
            <div>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">通知</h2>
              <div className="bg-white dark:bg-[#252525] border border-gray-200 dark:border-white/10 rounded-xl overflow-hidden shadow-sm transition-colors">
                <SettingRow 
                  title="轮次完成通知" 
                  description="设置 Codex 完成任务时的提醒"
                  control={
                    <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-white/10 rounded-lg px-3 py-1.5 text-sm cursor-pointer min-w-[160px] justify-between">
                      <span>仅当应用失焦时</span>
                      <ChevronDown size={14} className="text-gray-400 dark:text-gray-500" />
                    </div>
                  }
                />
                <SettingRow 
                  title="启用权限通知" 
                  description="在需要通知权限时显示提醒"
                  control={<Toggle checked />}
                />
                <SettingRow 
                  title="Enable question notifications" 
                  description="Show alerts when input is needed to continue"
                  control={<Toggle checked />}
                  isLast
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </ThreadLayout>
  );
}

function SettingRow({ title, description, control, isLast }: { title: string, description: string, control: React.ReactNode, isLast?: boolean }) {
  return (
    <div className={`flex items-center justify-between p-4 ${!isLast ? 'border-b border-gray-100 dark:border-white/10' : ''}`}>
      <div className="pr-8">
        <div className="font-medium text-sm text-gray-900 dark:text-gray-100 mb-1">{title}</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">{description}</div>
      </div>
      <div className="flex-shrink-0">
        {control}
      </div>
    </div>
  );
}

function Toggle({ checked = false }: { checked?: boolean }) {
  return (
    <div className={`w-10 h-6 rounded-full p-1 cursor-pointer transition-colors ${checked ? 'bg-black dark:bg-gray-300' : 'bg-gray-200 dark:bg-gray-600'}`}>
      <div className={`w-4 h-4 rounded-full bg-white shadow-sm transform transition-transform ${checked ? 'translate-x-4' : 'translate-x-0'}`}></div>
    </div>
  );
}
