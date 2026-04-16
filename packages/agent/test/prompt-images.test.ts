/**
 * prompt-images.test.ts - prompt() images 参数测试
 *
 * 测试覆盖：
 * - 带 images 参数调用 prompt()
 * - 不带 images 参数调用 prompt()
 * - images 为空数组时调用 prompt()
 * - images 与 taskId 组合使用
 * - images 与 historyEntryId 组合使用
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { ImageContent } from "@mariozechner/pi-ai";

import {
	AgentSession,
	SessionManager,
	type ResourceLoader,
	type RunnerEventEnvelope,
} from "../src/index";
import type { AppStore } from "@omi/store";
import type {
	ProviderConfig,
	Run,
	Session,
	SessionMessage,
	EventRecord,
	ToolCall,
	ReviewRequest,
	MemoryRecord,
} from "@omi/core";
import { createId, nowIso } from "@omi/core";

// 创建内存数据库
function createTestDatabase(): AppStore {
	const sessions = new Map<string, Session>();
	const runs = new Map<string, Run>();
	const providerConfigs = new Map<string, ProviderConfig>();

	const session: Session = {
		id: "test-session-id",
		title: "Test Session",
		status: "idle",
		createdAt: nowIso(),
		updatedAt: nowIso(),
		latestUserMessage: null,
		latestAssistantMessage: null,
	};
	sessions.set(session.id, session);

	const providerConfig: ProviderConfig = {
		id: "test-provider-config",
		name: "Test Provider",
		type: "anthropic",
		protocol: "anthropic-messages",
		baseUrl: "https://api.anthropic.com",
		apiKey: "test-key",
		model: "claude-sonnet-4-20250514",
		createdAt: nowIso(),
		updatedAt: nowIso(),
	};
	providerConfigs.set(providerConfig.id, providerConfig);

	return {
		getSession: (id: string) => sessions.get(id) ?? null,
		updateSession(id: string, partial: Partial<Session>) {
			const current = sessions.get(id);
			if (!current) throw new Error(`Session ${id} not found`);
			const next = { ...current, ...partial, updatedAt: nowIso() };
			sessions.set(id, next);
			return next;
		},
		listSessions: () => [...sessions.values()],
		createSession(title: string) {
			const s: Session = {
				id: createId("session"),
				title,
				status: "idle",
				createdAt: nowIso(),
				updatedAt: nowIso(),
				latestUserMessage: null,
				latestAssistantMessage: null,
			};
			sessions.set(s.id, s);
			return s;
		},
		createRun(input: Parameters<AppStore["createRun"]>[0]) {
			const run: Run = {
				id: createId("run"),
				createdAt: nowIso(),
				updatedAt: nowIso(),
				...input,
			};
			runs.set(run.id, run);
			return run;
		},
		getRun: (id: string) => runs.get(id) ?? null,
		updateRun(id: string, partial: Partial<Run>) {
			const current = runs.get(id);
			if (!current) throw new Error(`Run ${id} not found`);
			const next = { ...current, ...partial, updatedAt: nowIso() };
			runs.set(id, next);
			return next;
		},
		listRuns: (sessionId?: string) =>
			[...runs.values()].filter((r) => !sessionId || r.sessionId === sessionId),
		addMessage: (_input: Parameters<AppStore["addMessage"]>[0]) =>
			({ id: "msg-1" } as unknown as SessionMessage),
		listMessages: (_sessionId: string) => [] as SessionMessage[],
		addEvent: (_input: Parameters<AppStore["addEvent"]>[0]) =>
			({ id: "evt-1" } as unknown as EventRecord),
		listEvents: (_runId: string) => [] as EventRecord[],
		createToolCall: (_input: Parameters<AppStore["createToolCall"]>[0]) =>
			({ id: "tool-1" } as unknown as ToolCall),
		updateToolCall: (_toolCallId: string, _partial: Partial<ToolCall>) =>
			({ id: "tool-1" } as unknown as ToolCall),
		listToolCalls: (_runId: string) => [] as ToolCall[],
		listToolCallsBySession: (_sessionId: string) => [] as ToolCall[],
		createReviewRequest: (_input: Parameters<AppStore["createReviewRequest"]>[0]) =>
			({ id: "review-1" } as unknown as ReviewRequest),
		updateReviewRequest: (_reviewId: string, _partial: Partial<ReviewRequest>) =>
			({ id: "review-1" } as unknown as ReviewRequest),
		listReviewRequests: (_taskId?: string | null) => [] as ReviewRequest[],
		writeMemory: (_input: Parameters<AppStore["writeMemory"]>[0]) =>
			({ id: "mem-1" } as unknown as MemoryRecord),
		searchMemories: () => [] as MemoryRecord[],
		listMemories: () => [] as MemoryRecord[],
		listTasks: () => [],
		createTask: (_input: Parameters<AppStore["createTask"]>[0]) =>
			({ id: "task-1" } as any),
		getTask: (_taskId: string) => null,
		updateTask: (_taskId: string, _partial: any) => ({ id: "task-1" } as any),
		getProviderConfig: (id?: string) => {
			if (id) return providerConfigs.get(id) ?? null;
			return providerConfigs.values().next().value ?? null;
		},
		listProviderConfigs: () => [...providerConfigs.values()],
		upsertProviderConfig: (input: Partial<ProviderConfig> & { id?: string }) => {
			const config = { ...providerConfig, ...input, updatedAt: nowIso() };
			providerConfigs.set(config.id, config);
			return config as ProviderConfig;
		},
	} as unknown as AppStore;
}

function createTestResources(): ResourceLoader {
	return {
		workspaceRoot: process.cwd(),
		agentDir: "/tmp/.omi",
		async reload() {},
		getProjectContextFiles: () => [],
		listSkills: async () => [],
		searchSkills: async () => [],
		resolveSkillForPrompt: async () => null,
		buildSystemPrompt: () => "",
		getPrompts: () => ({ items: [], diagnostics: [] }),
		getThemes: () => ({ items: [], diagnostics: [] }),
		getExtensions: () => ({ items: [], diagnostics: [] }),
	};
}

describe("AgentSession.prompt() images 参数", () => {
	let database: AppStore;
	let runtime: InstanceType<typeof SessionManager> extends { getOrCreate: (...args: any) => infer R } ? R : never;
	let events: RunnerEventEnvelope[];
	let providerCalls: Array<{ prompt: string; images?: ImageContent[] }>;

	beforeEach(() => {
		database = createTestDatabase();
		const manager = new SessionManager();
		runtime = manager.getOrCreate("test-session-id");
		runtime.setSelectedProviderConfig("test-provider-config");
		events = [];
		providerCalls = [];
	});

	it("不带 images 参数调用 prompt() 应该正常工作", async () => {
		const provider = {
			async run(): Promise<any> {
				return { assistantText: "response", assistantMessage: null, stopReason: "end_turn" as const, usage: { inputTokens: 0, outputTokens: 0 }, error: null };
			},
			cancel() {},
			approveTool() {},
			rejectTool() {},
		};

		const session = new AgentSession({
			database,
			sessionId: "test-session-id",
			workspaceRoot: process.cwd(),
			emit: (event) => events.push(event),
			resources: createTestResources(),
			runtime,
			provider,
		});

		const run = await session.prompt("hello");
		expect(run).toBeDefined();
		expect(run.id).toBeTruthy();
	});

	it("带 images 参数调用 prompt() 不应该抛错", async () => {
		const testImage: ImageContent = {
			type: "image",
			source: { type: "base64", media_type: "image/png", data: "abc123" },
		} as unknown as ImageContent;

		const provider = {
			async run(): Promise<any> {
				return { assistantText: "response", assistantMessage: null, stopReason: "end_turn" as const, usage: { inputTokens: 0, outputTokens: 0 }, error: null };
			},
			cancel() {},
			approveTool() {},
			rejectTool() {},
		};

		const session = new AgentSession({
			database,
			sessionId: "test-session-id",
			workspaceRoot: process.cwd(),
			emit: (event) => events.push(event),
			resources: createTestResources(),
			runtime,
			provider,
		});

		// 带 images 调用不应抛错
		const run = await session.prompt("describe this image", {
			images: [testImage],
		});
		expect(run).toBeDefined();
		expect(run.id).toBeTruthy();
	});

	it("images 为空数组调用 prompt() 应该正常工作", async () => {
		const provider = {
			async run(): Promise<any> {
				return { assistantText: "response", assistantMessage: null, stopReason: "end_turn" as const, usage: { inputTokens: 0, outputTokens: 0 }, error: null };
			},
			cancel() {},
			approveTool() {},
			rejectTool() {},
		};

		const session = new AgentSession({
			database,
			sessionId: "test-session-id",
			workspaceRoot: process.cwd(),
			emit: (event) => events.push(event),
			resources: createTestResources(),
			runtime,
			provider,
		});

		const run = await session.prompt("hello", { images: [] });
		expect(run).toBeDefined();
	});

	it("images 与 taskId 组合使用不应抛错", async () => {
		const testImage: ImageContent = {
			type: "image",
			source: { type: "base64", media_type: "image/jpeg", data: "xyz789" },
		} as unknown as ImageContent;

		const provider = {
			async run(): Promise<any> {
				return { assistantText: "response", assistantMessage: null, stopReason: "end_turn" as const, usage: { inputTokens: 0, outputTokens: 0 }, error: null };
			},
			cancel() {},
			approveTool() {},
			rejectTool() {},
		};

		const session = new AgentSession({
			database,
			sessionId: "test-session-id",
			workspaceRoot: process.cwd(),
			emit: (event) => events.push(event),
			resources: createTestResources(),
			runtime,
			provider,
		});

		const run = await session.prompt("analyze", {
			images: [testImage],
			taskId: null,
		});
		expect(run).toBeDefined();
	});

	it("带 historyEntryId 和 images 组合不应抛错", async () => {
		const testImage: ImageContent = {
			type: "image",
			source: { type: "base64", media_type: "image/png", data: "data" },
		} as unknown as ImageContent;

		const provider = {
			async run(): Promise<any> {
				return { assistantText: "response", assistantMessage: null, stopReason: "end_turn" as const, usage: { inputTokens: 0, outputTokens: 0 }, error: null };
			},
			cancel() {},
			approveTool() {},
			rejectTool() {},
		};

		const session = new AgentSession({
			database,
			sessionId: "test-session-id",
			workspaceRoot: process.cwd(),
			emit: (event) => events.push(event),
			resources: createTestResources(),
			runtime,
			provider,
		});

		// historyEntryId 为 null 时走 startRun 分支
		const run = await session.prompt("with images and history", {
			images: [testImage],
			historyEntryId: null,
		});
		expect(run).toBeDefined();
	});

	it("多次带不同 images 调用 prompt() 应该各自独立", async () => {
		const image1: ImageContent = {
			type: "image",
			source: { type: "base64", media_type: "image/png", data: "img1" },
		} as unknown as ImageContent;

		const image2: ImageContent = {
			type: "image",
			source: { type: "base64", media_type: "image/jpeg", data: "img2" },
		} as unknown as ImageContent;

		const provider = {
			async run(): Promise<any> {
				return { assistantText: "response", assistantMessage: null, stopReason: "end_turn" as const, usage: { inputTokens: 0, outputTokens: 0 }, error: null };
			},
			cancel() {},
			approveTool() {},
			rejectTool() {},
		};

		const session = new AgentSession({
			database,
			sessionId: "test-session-id",
			workspaceRoot: process.cwd(),
			emit: (event) => events.push(event),
			resources: createTestResources(),
			runtime,
			provider,
		});

		const run1 = await session.prompt("first", { images: [image1] });
		const run2 = await session.prompt("second", { images: [image2] });

		expect(run1.id).not.toBe(run2.id);
		expect(run1.id).toBeTruthy();
		expect(run2.id).toBeTruthy();
	});
});
