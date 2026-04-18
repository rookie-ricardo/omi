import { CircleCheck, CircleX, Clock3 } from "lucide-react";

interface DecisionEventCardProps {
  decision: "approved" | "rejected";
  toolName: string;
  toolCallId: string;
}

export default function DecisionEventCard({ decision, toolName, toolCallId }: DecisionEventCardProps) {
  const isApproved = decision === "approved";
  return (
    <div
      className={`space-y-2 rounded-xl border p-4 ${
        isApproved
          ? "border-green-200/70 dark:border-green-400/20 bg-green-50/70 dark:bg-green-500/10"
          : "border-red-200/70 dark:border-red-400/20 bg-red-50/70 dark:bg-red-500/10"
      }`}
    >
      <div className={`flex items-center gap-2 text-sm font-medium ${isApproved ? "text-green-700 dark:text-green-300" : "text-red-700 dark:text-red-300"}`}>
        {isApproved ? <CircleCheck size={14} /> : <CircleX size={14} />}
        {isApproved ? "工具调用已批准" : "工具调用已拒绝"}
      </div>
      <div className="rounded-xl border border-white/10 bg-white/90 dark:bg-[#1e1e1e] p-3 text-sm text-gray-700 dark:text-gray-200 space-y-1">
        <div>{toolName}</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">Tool Call ID: {toolCallId}</div>
      </div>
    </div>
  );
}
