import { create } from "zustand";

export interface RunnerEventState {
  eventsByRun: Record<string, unknown[]>;
  appendRunEvent(runId: string, event: unknown): void;
}

export const useRunnerEvents = create<RunnerEventState>((set) => ({
  eventsByRun: {},
  appendRunEvent(runId, event) {
    set((state) => ({
      eventsByRun: {
        ...state.eventsByRun,
        [runId]: [...(state.eventsByRun[runId] ?? []), event],
      },
    }));
  },
}));
