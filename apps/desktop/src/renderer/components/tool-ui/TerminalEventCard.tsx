import { Terminal } from "lucide-react";

interface TerminalEventCardProps {
  title: string;
  command: string | null;
  stdout: string;
  stderr: string;
}

export default function TerminalEventCard({ title, command, stdout, stderr }: TerminalEventCardProps) {
  return (
    <div className="space-y-2 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1e1e1e] p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200">
        <Terminal size={14} />
        {title}
      </div>
      {command ? <div className="text-xs text-gray-500 dark:text-gray-400">{command}</div> : null}
      {stdout ? <pre className="m-0 text-[12px] leading-5 text-gray-700 dark:text-gray-200 whitespace-pre-wrap">{stdout}</pre> : null}
      {stderr ? (
        <pre className="m-0 text-[12px] leading-5 text-red-600 dark:text-red-300 whitespace-pre-wrap">{stderr}</pre>
      ) : null}
    </div>
  );
}
