import { z } from "zod";

export interface CompactionSummaryDocument {
  version: 1;
  goal: string;
  constraints: string[];
  progress: {
    done: string[];
    inProgress: string[];
    blocked: string[];
  };
  keyDecisions: string[];
  nextSteps: string[];
  criticalContext: string[];
}

export const compactionSummaryDocumentSchema: z.ZodType<CompactionSummaryDocument> = z.object({
  version: z.literal(1),
  goal: z.string(),
  constraints: z.array(z.string()),
  progress: z.object({
    done: z.array(z.string()),
    inProgress: z.array(z.string()),
    blocked: z.array(z.string()),
  }),
  keyDecisions: z.array(z.string()),
  nextSteps: z.array(z.string()),
  criticalContext: z.array(z.string()),
});
