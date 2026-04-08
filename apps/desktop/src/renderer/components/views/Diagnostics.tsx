import React, { useRef, useEffect, useState, useMemo, useCallback } from "react";
import { Activity, Trash2, Search, ArrowDown, X } from "lucide-react";
import {
	useDiagnosticsStore,
	type DiagnosticLogEntry,
	type DiagnosticLogLevel,
} from "../../store/diagnostics-store";

const LEVEL_COLORS: Record<DiagnosticLogLevel, string> = {
	debug: "text-gray-500 bg-gray-100 dark:bg-gray-800 dark:text-gray-400",
	info: "text-blue-600 bg-blue-50 dark:bg-blue-900/30 dark:text-blue-400",
	warn: "text-yellow-700 bg-yellow-50 dark:bg-yellow-900/30 dark:text-yellow-400",
	error: "text-red-600 bg-red-50 dark:bg-red-900/30 dark:text-red-400",
};

const ALL_LEVELS: DiagnosticLogLevel[] = ["debug", "info", "warn", "error"];

function formatTime(iso: string): string {
	try {
		const d = new Date(iso);
		const h = String(d.getHours()).padStart(2, "0");
		const m = String(d.getMinutes()).padStart(2, "0");
		const s = String(d.getSeconds()).padStart(2, "0");
		const ms = String(d.getMilliseconds()).padStart(3, "0");
		return `${h}:${m}:${s}.${ms}`;
	} catch {
		return iso;
	}
}

const LogRow = React.memo(function LogRow({ entry }: { entry: DiagnosticLogEntry }) {
	const [expanded, setExpanded] = useState(false);
	const hasContext = entry.context && Object.keys(entry.context).length > 0;

	return (
		<div
			className="flex items-start gap-2 px-3 py-1 border-b border-gray-100 dark:border-white/5 hover:bg-gray-50 dark:hover:bg-white/[0.03] transition-colors font-mono text-xs leading-relaxed cursor-default"
			onClick={() => hasContext && setExpanded((v) => !v)}
		>
			<span className="text-gray-400 dark:text-gray-500 whitespace-nowrap w-[84px] flex-shrink-0 select-none">
				{formatTime(entry.timestamp)}
			</span>
			<span className={`px-1.5 py-0 rounded text-[10px] font-semibold whitespace-nowrap flex-shrink-0 ${LEVEL_COLORS[entry.level]}`}>
				{entry.level.toUpperCase().padEnd(5)}
			</span>
			<span className="text-purple-600 dark:text-purple-400 whitespace-nowrap max-w-[140px] truncate flex-shrink-0 select-none">
				[{entry.component}]
			</span>
			<span className="text-gray-800 dark:text-gray-200 flex-1 break-all">
				{entry.message}
			</span>
			{hasContext && !expanded && (
				<span className="text-gray-400 dark:text-gray-500 flex-shrink-0 select-none">...</span>
			)}
			{hasContext && expanded && (
				<pre className="text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800/50 rounded px-1.5 py-0.5 text-[10px] mt-0.5 whitespace-pre-wrap break-all w-full">
					{JSON.stringify(entry.context, null, 2)}
				</pre>
			)}
		</div>
	);
});

export default function Diagnostics() {
	const logs = useDiagnosticsStore((s) => s.logs);
	const enableDebug = useDiagnosticsStore((s) => s.enableDebug);
	const clearLogs = useDiagnosticsStore((s) => s.clearLogs);
	const setEnableDebug = useDiagnosticsStore((s) => s.setEnableDebug);

	const [levelFilter, setLevelFilter] = useState<Set<DiagnosticLogLevel>>(
		() => new Set(["info", "warn", "error"]),
	);
	const [search, setSearch] = useState("");
	const [autoScroll, setAutoScroll] = useState(true);
	const scrollRef = useRef<HTMLDivElement>(null);

	const filteredLogs = useMemo(() => {
		const lower = search.toLowerCase();
		return logs.filter((entry) => {
			if (!levelFilter.has(entry.level)) return false;
			if (lower) {
				const haystack = `${entry.component} ${entry.message} ${JSON.stringify(entry.context)}`.toLowerCase();
				if (!haystack.includes(lower)) return false;
			}
			return true;
		});
	}, [logs, levelFilter, search]);

	// Auto-scroll
	useEffect(() => {
		if (!autoScroll) return;
		const el = scrollRef.current;
		if (!el) return;
		el.scrollTop = el.scrollHeight;
	}, [filteredLogs, autoScroll]);

	const handleScroll = useCallback(() => {
		const el = scrollRef.current;
		if (!el) return;
		const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
		if (atBottom !== autoScroll) {
			setAutoScroll(atBottom);
		}
	}, [autoScroll]);

	const scrollToBottom = useCallback(() => {
		const el = scrollRef.current;
		if (!el) return;
		el.scrollTop = el.scrollHeight;
		setAutoScroll(true);
	}, []);

	const toggleLevel = useCallback((level: DiagnosticLogLevel) => {
		setLevelFilter((prev) => {
			const next = new Set(prev);
			if (next.has(level)) next.delete(level);
			else next.add(level);
			return next;
		});
	}, []);

	return (
		<div className="flex-1 flex flex-col h-full overflow-hidden">
			{/* Toolbar */}
			<div className="h-12 flex items-center gap-3 px-4 border-b border-gray-200 dark:border-white/10 flex-shrink-0 bg-white dark:bg-[#1e1e1e]">
				<div className="flex items-center gap-1.5 text-gray-700 dark:text-gray-300 font-medium text-sm">
					<Activity size={15} />
					<span>诊断日志</span>
				</div>

				{/* Level filters */}
				<div className="flex items-center gap-1 ml-2">
					{ALL_LEVELS.map((level) => (
						<button
							key={level}
							onClick={() => toggleLevel(level)}
							className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
								levelFilter.has(level)
									? LEVEL_COLORS[level]
									: "text-gray-400 dark:text-gray-600 bg-transparent"
							}`}
						>
							{level.toUpperCase()}
						</button>
					))}
				</div>

				{/* Debug toggle */}
				<button
					onClick={() => setEnableDebug(!enableDebug)}
					className={`ml-1 px-2 py-0.5 rounded text-xs font-medium transition-colors ${
						enableDebug
							? "text-green-600 bg-green-50 dark:text-green-400 dark:bg-green-900/30"
							: "text-gray-400 dark:text-gray-600"
					}`}
				>
					DEBUG {enableDebug ? "ON" : "OFF"}
				</button>

				<div className="flex-1" />

				{/* Search */}
				<div className="relative">
					<Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
					<input
						type="text"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						placeholder="搜索..."
						className="w-40 pl-7 pr-2 py-1 text-xs rounded-md border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#2a2a2a] text-gray-800 dark:text-gray-200 outline-none focus:ring-1 focus:ring-blue-400"
					/>
					{search && (
						<button onClick={() => setSearch("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
							<X size={12} />
						</button>
					)}
				</div>

				{/* Log count */}
				<span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">
					{filteredLogs.length}/{logs.length}
				</span>

				{/* Clear */}
				<button
					onClick={clearLogs}
					className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
					title="清除日志"
				>
					<Trash2 size={14} />
				</button>
			</div>

			{/* Log list */}
			<div
				ref={scrollRef}
				onScroll={handleScroll}
				className="flex-1 overflow-y-auto bg-white dark:bg-[#1e1e1e]"
			>
				{filteredLogs.length === 0 ? (
					<div className="flex items-center justify-center h-full text-gray-400 dark:text-gray-500 text-sm">
						暂无日志
					</div>
				) : (
					filteredLogs.map((entry) => (
						<LogRow key={entry.seq} entry={entry} />
					))
				)}
			</div>

			{/* Scroll to bottom button */}
			{!autoScroll && (
				<button
					onClick={scrollToBottom}
					className="absolute bottom-4 right-4 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-white/10 shadow-lg text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#333] transition-colors"
				>
					<ArrowDown size={13} />
					回到底部
				</button>
			)}
		</div>
	);
}
