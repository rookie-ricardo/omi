export interface RunnerEvent {
  type: string;
  payload: Record<string, unknown>;
}

const resolvedApprovalEventTypes = new Set([
  "run.tool_decided",
  "run.tool_started",
  "run.tool_finished",
]);

export function collectPendingApprovalEvents(
  eventsByRun: Record<string, unknown[]>,
): RunnerEvent[] {
  const events = Object.values(eventsByRun)
    .flat()
    .map((event) => event as RunnerEvent);
  const resolvedToolCallIds = new Set(
    events
      .filter((event) => resolvedApprovalEventTypes.has(event.type))
      .map((event) => String(event.payload.toolCallId)),
  );

  return events.filter(
    (event) =>
      event.type === "run.tool_requested" &&
      event.payload.requiresApproval &&
      !resolvedToolCallIds.has(String(event.payload.toolCallId)),
  );
}
