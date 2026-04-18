import { ShieldAlert } from "lucide-react";

interface BlockedToolCardProps {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}

function previewInput(input: Record<string, unknown>): string {
  try {
    const text = JSON.stringify(input, null, 2);
    return text.length > 520 ? `${text.slice(0, 520)}\n...` : text;
  } catch {
    return String(input);
  }
}

export default function BlockedToolCard({ toolCallId, toolName, input }: BlockedToolCardProps) {
  return (
    <div className="space-y-2 rounded-xl border border-orange-200/70 dark:border-orange-400/20 bg-orange-50/70 dark:bg-orange-500/10 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-orange-700 dark:text-orange-300">
        <ShieldAlert size={14} />
        工具调用已阻塞
      </div>
      <div className="rounded-xl border border-orange-100 dark:border-white/10 bg-white/90 dark:bg-[#1e1e1e] p-3 space-y-2">
        <div className="text-sm font-medium text-gray-800 dark:text-gray-200">{toolName}</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">Tool Call ID: {toolCallId}</div>
        <pre className="m-0 text-[12px] leading-5 text-gray-700 dark:text-gray-200 whitespace-pre-wrap overflow-auto custom-scrollbar">
          {previewInput(input)}
        </pre>
      </div>
    </div>
  );
}
