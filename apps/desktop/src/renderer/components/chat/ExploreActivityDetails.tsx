import type { ToolCall } from "@omi/core";

import { getExploreActionType, getExplorePathOrPattern } from "./tool-utils";

interface ExploreActivityDetailsProps {
  toolCalls: ToolCall[];
}

function shortPath(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  return segments.at(-1) ?? value;
}

function toDetailLine(toolCall: ToolCall): string | null {
  const action = getExploreActionType(toolCall.toolName);
  const raw = getExplorePathOrPattern(toolCall);

  if (!action) {
    return null;
  }

  const target = raw ? shortPath(raw) : toolCall.toolName;

  if (action === "read") {
    return `Read ${target}`;
  }

  if (action === "search") {
    return `Searched for ${target}`;
  }

  return `Listed ${target}`;
}

export default function ExploreActivityDetails({ toolCalls }: ExploreActivityDetailsProps) {
  const lines: string[] = [];
  for (const toolCall of toolCalls) {
    const line = toDetailLine(toolCall);
    if (!line) {
      continue;
    }
    if (lines.at(-1) === line) {
      continue;
    }
    lines.push(line);
  }

  if (lines.length === 0) {
    return null;
  }

  return (
    <div className="space-y-1">
      {lines.map((line, index) => (
        <div
          key={`${line}-${index}`}
          className="text-[15px] leading-6 text-gray-500 dark:text-gray-400 truncate"
          title={line}
        >
          {line}
        </div>
      ))}
    </div>
  );
}
