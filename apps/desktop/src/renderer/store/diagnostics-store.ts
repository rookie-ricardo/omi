import { create } from "zustand";

export type DiagnosticLogLevel = "debug" | "info" | "warn" | "error";

export interface DiagnosticLogEntry {
	seq: number;
	timestamp: string;
	level: DiagnosticLogLevel;
	component: string;
	message: string;
	context: Record<string, unknown>;
}

const MAX_LOG_ENTRIES = 1000;

interface DiagnosticsStoreData {
	logs: DiagnosticLogEntry[];
	enableDebug: boolean;
}

interface DiagnosticsStoreActions {
	addLog: (entry: Omit<DiagnosticLogEntry, "seq">) => void;
	clearLogs: () => void;
	setEnableDebug: (enable: boolean) => void;
}

export type DiagnosticsStore = DiagnosticsStoreData & DiagnosticsStoreActions;

let logSequence = 0;

export const useDiagnosticsStore = create<DiagnosticsStore>((set) => ({
	logs: [],
	enableDebug: false,

	addLog(entry) {
		set((state) => {
			const nextLogs = [...state.logs, { ...entry, seq: logSequence++ }];
			if (nextLogs.length > MAX_LOG_ENTRIES) {
				return { logs: nextLogs.slice(nextLogs.length - MAX_LOG_ENTRIES) };
			}
			return { logs: nextLogs };
		});
	},

	clearLogs() {
		set({ logs: [] });
	},

	setEnableDebug(enable) {
		set({ enableDebug: enable });
	},
}));
