import type { OmiTool } from "@omi/core";
import { Type } from "@mariozechner/pi-ai";
import { parseToolInput } from "./input-parse";
import { getCronRuntime, type CronJob } from "./runtime";

// ============================================================================
// Schemas
// ============================================================================

export const cronCreateSchema = Type.Object({
  cron: Type.String({ description: 'Standard 5-field cron expression in local time: "M H DoM Mon DoW"' }),
  prompt: Type.String({ description: "The prompt to enqueue at each fire time." }),
  recurring: Type.Optional(Type.Boolean({ description: "true (default) = fire on every cron match. false = fire once then auto-delete." })),
  durable: Type.Optional(Type.Boolean({ description: "true = persist to disk and survive restarts. false (default) = session-only." })),
});

export interface CronCreateInput {
  cron: string;
  prompt: string;
  recurring?: boolean;
  durable?: boolean;
}

export const cronDeleteSchema = Type.Object({
  id: Type.String({ description: "Job ID returned by cron.create." }),
});

export interface CronDeleteInput {
  id: string;
}

export const cronListSchema = Type.Object({});

// ============================================================================
// Tool Factories
// ============================================================================

export function createCronCreateTool(): OmiTool<typeof cronCreateSchema, { job: CronJob }> {
  return {
    name: "cron.create",
    label: "cron.create",
    description: `Schedule a prompt to be enqueued at a future time. Use for both recurring schedules and one-shot reminders.

Uses standard 5-field cron in the user's local timezone: minute hour day-of-month month day-of-week. "0 9 * * *" means 9am local.

One-shot tasks (recurring: false):
For "remind me at X" or "at <time>, do Y" — fire once then auto-delete.
Pin minute/hour/day-of-month/month to specific values.

Recurring jobs (recurring: true, the default):
For "every N minutes" / "every hour" / "weekdays at 9am".

Avoid the :00 and :30 minute marks when the task allows it — pick off-minutes to spread load.
Only use minute 0 or 30 when the user names that exact time.

Session-only by default. Jobs live only in this session unless durable: true.

Recurring tasks auto-expire after 7 days. Tell the user about the 7-day limit when scheduling recurring jobs.

Returns a job ID you can pass to cron.delete.`,
    parameters: cronCreateSchema,
    execute: async (_toolCallId: string, params: unknown) => {
      const { cron, prompt, recurring, durable } = parseToolInput("cron.create", cronCreateSchema, params);
      const runtime = getCronRuntime();
      if (!runtime) {
        throw new Error("Cron runtime is not configured");
      }
      const job = await runtime.create(cron, prompt, { recurring, durable });
      return {
        content: [{ type: "text" as const, text: `Created cron job ${job.id} (cron: "${job.cron}", recurring: ${job.recurring}, durable: ${job.durable})` }],
        details: { job },
      };
    },
  };
}

export function createCronDeleteTool(): OmiTool<typeof cronDeleteSchema, { id: string; deleted: boolean }> {
  return {
    name: "cron.delete",
    label: "cron.delete",
    description: "Cancel a cron job previously scheduled with cron.create. Removes it from the session store.",
    parameters: cronDeleteSchema,
    execute: async (_toolCallId: string, params: unknown) => {
      const { id } = parseToolInput("cron.delete", cronDeleteSchema, params);
      const runtime = getCronRuntime();
      if (!runtime) {
        throw new Error("Cron runtime is not configured");
      }
      const deleted = await runtime.delete(id);
      return {
        content: [{ type: "text" as const, text: deleted ? `Deleted cron job ${id}` : `Cron job ${id} not found` }],
        details: { id, deleted },
      };
    },
  };
}

export function createCronListTool(): OmiTool<typeof cronListSchema, { jobs: CronJob[] }> {
  return {
    name: "cron.list",
    label: "cron.list",
    description: "List all cron jobs scheduled via cron.create in this session.",
    parameters: cronListSchema,
    execute: async (_toolCallId: string, params: unknown) => {
      parseToolInput("cron.list", cronListSchema, params);
      const runtime = getCronRuntime();
      if (!runtime) {
        throw new Error("Cron runtime is not configured");
      }
      const jobs = await runtime.list();
      if (jobs.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No cron jobs scheduled" }],
          details: { jobs: [] },
        };
      }
      const text = jobs
        .map((job) => `- ${job.id}: cron="${job.cron}" prompt="${job.prompt}" recurring=${job.recurring} durable=${job.durable} nextFireAt=${job.nextFireAt ?? "unknown"}`)
        .join("\n");
      return {
        content: [{ type: "text" as const, text: `Scheduled cron jobs:\n${text}` }],
        details: { jobs },
      };
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createCronTools(): OmiTool<any>[] {
  return [
    createCronCreateTool(),
    createCronDeleteTool(),
    createCronListTool(),
  ];
}
