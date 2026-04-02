/**
 * slash-command-builtin.test.ts - 内置命令执行测试
 *
 * 测试覆盖：
 * - /model - 查看或切换模型
 * - /compact - 手动触发 compaction
 * - /fork - 分叉当前会话
 * - /new - 创建新会话
 * - /resume - 恢复会话
 * - /settings - 查看或修改设置
 * - /quit - 退出
 * - /help - 显示帮助
 * - /session - 显示会话信息
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { SlashCommandRegistry, createSlashCommandContext } from "../src/slash-commands";
import type { AgentSession } from "../src/agent-session";
import type { AppStore } from "@omi/store";
import type { SessionManager } from "../src/session-manager";
import type { SettingsManager } from "@omi/settings";

// Mock 工厂函数
function createMockSession(): AgentSession {
	return {
		getSessionStats: vi.fn(() => ({
			sessionId: "test-session-123",
			totalMessages: 10,
			userMessages: 5,
			assistantMessages: 5,
			toolCalls: 2,
			runs: 3,
		})),
		setModel: vi.fn(),
		compactSession: vi.fn(async () => ({
			summary: { goal: "Test compaction" },
			removedEntries: [],
		})),
		fork: vi.fn(async (historyEntryId) => ({
			newSessionId: "forked-session-456",
			selectedText: "Selected text",
		})),
		prompt: vi.fn(async () => ({})),
	} as unknown as AgentSession;
}

function createMockDatabase(): AppStore {
	return {
		createSession: vi.fn((title) => ({
			id: "new-session-789",
			title,
			createdAt: new Date().toISOString(),
		})),
		listSessions: vi.fn(() => [
			{ id: "session-1", title: "Session 1", createdAt: new Date().toISOString() },
			{ id: "session-2", title: "Session 2", createdAt: new Date().toISOString() },
		]),
		getSession: vi.fn((id) =>
			id === "session-1"
				? { id: "session-1", title: "Session 1", createdAt: new Date().toISOString() }
				: null,
		),
	} as unknown as AppStore;
}

function createMockSessionManager(): SessionManager {
	return {
		getState: vi.fn(() => ({
			activeRunId: "run-123",
		})),
	} as unknown as SessionManager;
}

function createMockSettingsManager(): SettingsManager {
	return {
		getGlobalSettings: vi.fn(() => ({
			retry: { maxRetries: 3, baseDelayMs: 2000 },
			model: { default: "claude-sonnet-4-20250514" },
		})),
	} as unknown as SettingsManager;
}

function createMockContext(): ReturnType<typeof createSlashCommandContext> {
	return createSlashCommandContext(
		createMockSession(),
		createMockDatabase(),
		createMockSessionManager(),
		vi.fn(),
		createMockSettingsManager(),
	);
}

describe("/model 命令", () => {
	let registry: SlashCommandRegistry;
	let context: ReturnType<typeof createSlashCommandContext>;
	let mockSession: AgentSession;

	beforeEach(() => {
		registry = new SlashCommandRegistry();
		mockSession = createMockSession();
		context = createSlashCommandContext(
			mockSession,
			createMockDatabase(),
			createMockSessionManager(),
			vi.fn(),
			createMockSettingsManager(),
		);
	});

	it("无参数时应该显示当前会话信息", async () => {
		const result = await registry.execute("/model", context);

		expect(result.success).toBe(true);
		expect(result.output).toContain("test-session-123");
		expect(result.output).toContain("Use /model <model-id>");
	});

	it("有参数时应该切换模型", async () => {
		const result = await registry.execute("/model claude-opus-4-20250514", context);

		expect(result.success).toBe(true);
		expect(result.output).toContain("claude-opus-4-20250514");
		expect(mockSession.setModel).toHaveBeenCalledWith("claude-opus-4-20250514");
	});

	it("应该处理模型名称前后的空格", async () => {
		const result = await registry.execute("/model  claude-sonnet-4  ", context);

		expect(result.success).toBe(true);
		expect(mockSession.setModel).toHaveBeenCalledWith("claude-sonnet-4");
	});

	it("setModel 抛出错误时应该返回失败", async () => {
		const errorSession = {
			...mockSession,
			setModel: vi.fn(() => {
				throw new Error("Model not found");
			}),
		} as unknown as AgentSession;

		const errorContext = createSlashCommandContext(
			errorSession,
			createMockDatabase(),
			createMockSessionManager(),
			vi.fn(),
			createMockSettingsManager(),
		);

		const result = await registry.execute("/model invalid-model", errorContext);

		expect(result.success).toBe(false);
		expect(result.error).toContain("Model not found");
	});
});

describe("/compact 命令", () => {
	let registry: SlashCommandRegistry;
	let context: ReturnType<typeof createSlashCommandContext>;
	let mockSession: AgentSession;

	beforeEach(() => {
		registry = new SlashCommandRegistry();
		mockSession = createMockSession();
		context = createSlashCommandContext(
			mockSession,
			createMockDatabase(),
			createMockSessionManager(),
			vi.fn(),
			createMockSettingsManager(),
		);
	});

	it("应该触发会话压缩", async () => {
		const result = await registry.execute("/compact", context);

		expect(result.success).toBe(true);
		expect(result.output).toContain("Test compaction");
		expect(mockSession.compactSession).toHaveBeenCalled();
	});

	it("compactSession 抛出错误时应该返回失败", async () => {
		const errorSession = {
			...mockSession,
			compactSession: vi.fn(() => {
				throw new Error("Compaction failed");
			}),
		} as unknown as AgentSession;

		const errorContext = createSlashCommandContext(
			errorSession,
			createMockDatabase(),
			createMockSessionManager(),
			vi.fn(),
			createMockSettingsManager(),
		);

		const result = await registry.execute("/compact", errorContext);

		expect(result.success).toBe(false);
		expect(result.error).toContain("Compaction failed");
	});
});

describe("/fork 命令", () => {
	let registry: SlashCommandRegistry;
	let context: ReturnType<typeof createSlashCommandContext>;
	let mockSession: AgentSession;

	beforeEach(() => {
		registry = new SlashCommandRegistry();
		mockSession = createMockSession();
		context = createSlashCommandContext(
			mockSession,
			createMockDatabase(),
			createMockSessionManager(),
			vi.fn(),
			createMockSettingsManager(),
		);
	});

	it("应该使用提供的 history entry ID 创建分叉", async () => {
		const result = await registry.execute("/fork msg-123", context);

		expect(result.success).toBe(true);
		expect(result.output).toContain("forked-session-456");
		expect(mockSession.fork).toHaveBeenCalledWith("msg-123");
	});

	it("无参数时应该使用空字符串", async () => {
		const result = await registry.execute("/fork", context);

		expect(result.success).toBe(true);
		expect(mockSession.fork).toHaveBeenCalledWith("");
	});

	it("应该处理空格", async () => {
		const result = await registry.execute("/fork  msg-456  ", context);

		expect(result.success).toBe(true);
		expect(mockSession.fork).toHaveBeenCalledWith("msg-456");
	});

	it("fork 抛出错误时应该返回失败", async () => {
		const errorSession = {
			...mockSession,
			fork: vi.fn(() => {
				throw new Error("Invalid history entry");
			}),
		} as unknown as AgentSession;

		const errorContext = createSlashCommandContext(
			errorSession,
			createMockDatabase(),
			createMockSessionManager(),
			vi.fn(),
			createMockSettingsManager(),
		);

		const result = await registry.execute("/fork invalid", errorContext);

		expect(result.success).toBe(false);
		expect(result.error).toContain("Invalid history entry");
	});
});

describe("/new 命令", () => {
	let registry: SlashCommandRegistry;
	let context: ReturnType<typeof createSlashCommandContext>;
	let mockDatabase: AppStore;

	beforeEach(() => {
		registry = new SlashCommandRegistry();
		mockDatabase = createMockDatabase();
		context = createSlashCommandContext(
			createMockSession(),
			mockDatabase,
			createMockSessionManager(),
			vi.fn(),
			createMockSettingsManager(),
		);
	});

	it("应该使用提供的标题创建新会话", async () => {
		const result = await registry.execute("/new My Custom Session", context);

		expect(result.success).toBe(true);
		expect(result.output).toContain("new-session-789");
		expect(mockDatabase.createSession).toHaveBeenCalledWith("My Custom Session");
	});

	it("无参数时应该使用默认标题", async () => {
		const result = await registry.execute("/new", context);

		expect(result.success).toBe(true);
		expect(mockDatabase.createSession).toHaveBeenCalledWith("New Session");
	});

	it("应该处理空格", async () => {
		const result = await registry.execute("/new  Title with spaces  ", context);

		expect(result.success).toBe(true);
		expect(mockDatabase.createSession).toHaveBeenCalledWith("Title with spaces");
	});

	it("createSession 抛出错误时应该返回失败", async () => {
		const errorDatabase = {
			...mockDatabase,
			createSession: vi.fn(() => {
				throw new Error("Database error");
			}),
		} as unknown as AppStore;

		const errorContext = createSlashCommandContext(
			createMockSession(),
			errorDatabase,
			createMockSessionManager(),
			vi.fn(),
			createMockSettingsManager(),
		);

		const result = await registry.execute("/new Test", errorContext);

		expect(result.success).toBe(false);
		expect(result.error).toContain("Database error");
	});
});

describe("/resume 命令", () => {
	let registry: SlashCommandRegistry;
	let context: ReturnType<typeof createSlashCommandContext>;
	let mockDatabase: AppStore;

	beforeEach(() => {
		registry = new SlashCommandRegistry();
		mockDatabase = createMockDatabase();
		context = createSlashCommandContext(
			createMockSession(),
			mockDatabase,
			createMockSessionManager(),
			vi.fn(),
			createMockSettingsManager(),
		);
	});

	it("无参数时应该列出所有会话", async () => {
		const result = await registry.execute("/resume", context);

		expect(result.success).toBe(true);
		expect(result.output).toContain("Available sessions");
		expect(result.output).toContain("session-1");
		expect(result.output).toContain("Session 1");
		expect(result.output).toContain("session-2");
		expect(result.output).toContain("Session 2");
	});

	it("应该恢复指定的会话", async () => {
		const result = await registry.execute("/resume session-1", context);

		expect(result.success).toBe(true);
		expect(result.output).toContain("Session 1");
		expect(result.output).toContain("session-1");
	});

	it("对于不存在的会话应该返回错误", async () => {
		const result = await registry.execute("/resume nonexistent", context);

		expect(result.success).toBe(false);
		expect(result.error).toContain("Session not found");
		expect(result.error).toContain("nonexistent");
	});

	it("应该处理空格", async () => {
		const result = await registry.execute("/resume  session-1  ", context);

		expect(result.success).toBe(true);
		expect(mockDatabase.getSession).toHaveBeenCalledWith("session-1");
	});
});

describe("/settings 命令", () => {
	let registry: SlashCommandRegistry;
	let context: ReturnType<typeof createSlashCommandContext>;
	let mockSettings: SettingsManager;

	beforeEach(() => {
		registry = new SlashCommandRegistry();
		mockSettings = createMockSettingsManager();
		context = createSlashCommandContext(
			createMockSession(),
			createMockDatabase(),
			createMockSessionManager(),
			vi.fn(),
			mockSettings,
		);
	});

	it("无参数时应该显示所有设置", async () => {
		const result = await registry.execute("/settings", context);

		expect(result.success).toBe(true);
		expect(result.output).toContain("retry");
		expect(result.output).toContain("model");
	});

	it("有参数时应该显示设置信息", async () => {
		const result = await registry.execute("/settings retry.maxRetries", context);

		expect(result.success).toBe(true);
		expect(result.output).toContain("retry.maxRetries");
	});

	it("没有 settingsManager 时应该返回错误", async () => {
		const noSettingsContext = createSlashCommandContext(
			createMockSession(),
			createMockDatabase(),
			createMockSessionManager(),
			vi.fn(),
			undefined,
		);

		const result = await registry.execute("/settings", noSettingsContext);

		expect(result.success).toBe(false);
		expect(result.error).toContain("Settings manager not available");
	});
});

describe("/quit 命令", () => {
	let registry: SlashCommandRegistry;
	let context: ReturnType<typeof createSlashCommandContext>;

	beforeEach(() => {
		registry = new SlashCommandRegistry();
		context = createSlashCommandContext(
			createMockSession(),
			createMockDatabase(),
			createMockSessionManager(),
			vi.fn(),
			createMockSettingsManager(),
		);
	});

	it("应该返回成功和退出消息", async () => {
		const result = await registry.execute("/quit", context);

		expect(result.success).toBe(true);
		expect(result.output).toContain("Exiting");
	});

	it("应该忽略参数", async () => {
		const result = await registry.execute("/quit now", context);

		expect(result.success).toBe(true);
	});
});

describe("/help 命令", () => {
	let registry: SlashCommandRegistry;
	let context: ReturnType<typeof createSlashCommandContext>;

	beforeEach(() => {
		registry = new SlashCommandRegistry();
		context = createSlashCommandContext(
			createMockSession(),
			createMockDatabase(),
			createMockSessionManager(),
			vi.fn(),
			createMockSettingsManager(),
		);
	});

	it("无参数时应该列出所有可用命令", async () => {
		const result = await registry.execute("/help", context);

		expect(result.success).toBe(true);
		expect(result.output).toContain("Available commands");
		// 应该包含一些内置命令
		expect(result.output).toContain("/model");
		expect(result.output).toContain("/help");
		expect(result.output).toContain("/quit");
	});

	it("有参数时应该显示特定命令的帮助", async () => {
		const result = await registry.execute("/help model", context);

		expect(result.success).toBe(true);
		expect(result.output).toContain("model");
	});

	it("对于不存在的命令应该返回错误", async () => {
		const result = await registry.execute("/help nonexistent", context);

		expect(result.success).toBe(false);
		expect(result.error).toContain("Unknown command");
	});

	it("应该显示命令的 usage 信息", async () => {
		const result = await registry.execute("/help model", context);

		expect(result.success).toBe(true);
		expect(result.output).toContain("Usage");
	});
});

describe("/session 命令", () => {
	let registry: SlashCommandRegistry;
	let context: ReturnType<typeof createSlashCommandContext>;
	let mockSession: AgentSession;
	let mockSessionManager: SessionManager;

	beforeEach(() => {
		registry = new SlashCommandRegistry();
		mockSession = createMockSession();
		mockSessionManager = createMockSessionManager();
		context = createSlashCommandContext(
			mockSession,
			createMockDatabase(),
			mockSessionManager,
			vi.fn(),
			createMockSettingsManager(),
		);
	});

	it("应该显示会话统计信息", async () => {
		const result = await registry.execute("/session", context);

		expect(result.success).toBe(true);
		expect(result.output).toContain("Session Stats");
		expect(result.output).toContain("test-session-123");
		expect(result.output).toContain("Messages:");
		expect(result.output).toContain("User messages:");
		expect(result.output).toContain("Assistant messages:");
		expect(result.output).toContain("Tool calls:");
		expect(result.output).toContain("Runs:");
	});

	it("应该显示活跃 run 信息", async () => {
		const result = await registry.execute("/session", context);

		expect(result.success).toBe(true);
		expect(result.output).toContain("run-123");
	});

	it("应该处理无活跃 run 的情况", async () => {
		const noRunManager = {
			getState: vi.fn(() => ({
				activeRunId: undefined,
			})),
		} as unknown as SessionManager;

		const noRunContext = createSlashCommandContext(
			mockSession,
			createMockDatabase(),
			noRunManager,
			vi.fn(),
			createMockSettingsManager(),
		);

		const result = await registry.execute("/session", noRunContext);

		expect(result.success).toBe(true);
		expect(result.output).toContain("none");
	});
});
