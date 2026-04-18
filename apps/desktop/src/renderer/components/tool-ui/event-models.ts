import type { ToolCall } from "@omi/core";

export type RunUiEventKind =
  | "run"
  | "skill"
  | "tool"
  | "approval"
  | "status"
  | "error";

export interface RunUiEvent {
  id: string;
  kind: RunUiEventKind;
  title: string;
  subtitle?: string;
  description?: string;
  createdAt?: string;
  details?: Array<{ label: string; value: string }>;
}

export interface SkillEventViewModel {
  id: string;
  skillName: string;
  score: number;
  source: string;
  enabledToolNames: string[];
  diagnostics: string[];
}

export interface ToolEventViewModel {
  toolCall: ToolCall;
  runId: string;
  isActive: boolean;
  isPendingApproval: boolean;
}

export function buildSkillEventViewModel(input: {
  id: string;
  skillName: string;
  score: number;
  source: string;
  enabledToolNames: string[];
  diagnostics?: string[];
}): SkillEventViewModel {
  return {
    id: input.id,
    skillName: input.skillName,
    score: input.score,
    source: input.source,
    enabledToolNames: input.enabledToolNames,
    diagnostics: input.diagnostics ?? [],
  };
}
