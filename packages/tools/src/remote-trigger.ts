import type { OmiTool } from "@omi/core";
import { Type } from "@mariozechner/pi-ai";
import { parseToolInput } from "./input-parse";
import { getRemoteTriggerRuntime } from "./runtime";

// ============================================================================
// Schemas
// ============================================================================

export const remoteTriggerSchema = Type.Object({
  action: Type.Union([
    Type.Literal("list"),
    Type.Literal("get"),
    Type.Literal("create"),
    Type.Literal("update"),
    Type.Literal("run"),
  ], { description: "The action to perform" }),
  trigger_id: Type.Optional(Type.String({ description: "Required for get, update, and run" })),
  body: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "JSON body for create and update" })),
});

export type RemoteTriggerInput = {
  action: "list" | "get" | "create" | "update" | "run";
  trigger_id?: string;
  body?: Record<string, unknown>;
};

// ============================================================================
// Tool Factory
// ============================================================================

export function createRemoteTriggerTool(): OmiTool<typeof remoteTriggerSchema, { action: string; result: unknown }> {
  return {
    name: "remote_trigger",
    label: "remote_trigger",
    description: `Call the remote-trigger API. Use this instead of curl — the auth token is added automatically in-process and never exposed.

Actions:
- list: GET /v1/code/triggers
- get: GET /v1/code/triggers/{trigger_id}
- create: POST /v1/code/triggers (requires body)
- update: POST /v1/code/triggers/{trigger_id} (requires body, partial update)
- run: POST /v1/code/triggers/{trigger_id}/run

The response is the raw JSON from the API.`,
    parameters: remoteTriggerSchema,
    execute: async (_toolCallId: string, params: unknown) => {
      const { action, trigger_id, body } = parseToolInput("remote_trigger", remoteTriggerSchema, params);
      const runtime = getRemoteTriggerRuntime();
      if (!runtime) {
        throw new Error("Remote trigger runtime is not configured");
      }
      const result = await runtime.execute(action, trigger_id, body);
      const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
      return {
        content: [{ type: "text" as const, text }],
        details: { action, result },
      };
    },
  };
}
