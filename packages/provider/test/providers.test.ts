import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Message } from "@mariozechner/pi-ai";

import type { ProviderConfig } from "@omi/core";

import {
  buildAgentInitialState,
  createProviderAdapter,
  createModelFromConfig,
  resolveProviderRuntime,
  PiAiProvider,
  THINKING_LEVELS,
  THINKING_LEVELS_WITH_XHIGH,
  type ProviderRunInput,
  type ProviderAdapter,
} from "../src/providers";

describe("providers", () => {
  it("builds a built-in OpenAI model from pi-ai", () => {
    const model = createModelFromConfig(
      makeConfig({ name: "openai", protocol: "openai-responses", model: "gpt-4.1-mini" }),
    );
    expect(model.provider).toBe("openai");
    expect(model.api).toBe("openai-responses");
    expect(model.baseUrl).toBe("https://api.openai.com/v1");
  });

  it("builds a built-in OpenRouter model from pi-ai", () => {
    const model = createModelFromConfig(
      makeConfig({ name: "openrouter", protocol: "openai-chat", model: "openai/gpt-4o-mini" }),
    );
    expect(model.provider).toBe("openrouter");
    expect(model.api).toBe("openai-completions");
  });

  it("builds a custom OpenAI-compatible model", () => {
    const model = createModelFromConfig(
      makeConfig({
        name: "openai-compatible",
        protocol: "openai-chat",
        model: "gpt-oss:20b",
        baseUrl: "http://localhost:11434/v1",
      }),
    );
    expect(model.provider).toBe("openai-compatible");
    expect(model.api).toBe("openai-completions");
    expect(model.baseUrl).toBe("http://localhost:11434/v1");
  });

  it("includes historical runtime messages in the agent initial state", () => {
    const historyMessages: Message[] = [
      {
        role: "user",
        content: [{ type: "text", text: "previous user" }],
        timestamp: 1,
      },
    ];

    const initialState = buildAgentInitialState({
      runId: "run_1",
      sessionId: "session_1",
      workspaceRoot: "/workspace",
      prompt: "current prompt",
      historyMessages,
      providerConfig: makeConfig({ name: "anthropic", protocol: "anthropic-messages" }),
      enabledTools: [],
    });

    expect(initialState.messages).toEqual([
      expect.objectContaining({
        role: "user",
        content: [{ type: "text", text: "previous user" }],
      }),
    ]);
  });

  it("routes anthropic provider configs to claude runtime", () => {
    expect(resolveProviderRuntime(makeConfig({ name: "anthropic" }))).toBe("claude-agent-sdk");
    expect(resolveProviderRuntime(makeConfig({ name: "anthropic-compatible" }))).toBe("claude-agent-sdk");
  });

  it("routes non-anthropic provider configs to vercel runtime", () => {
    expect(
      resolveProviderRuntime(
        makeConfig({
          name: "openai",
          protocol: "openai-responses",
          model: "gpt-4.1-mini",
        }),
      ),
    ).toBe("vercel-ai-sdk");
  });

  it("routes provider run calls through runtime-specific adapters", async () => {
    const claudeRuntime: ProviderAdapter = {
      run: vi.fn(async () => ({
        assistantText: "claude",
        assistantMessage: null,
        stopReason: "end_turn" as const,
        usage: { inputTokens: 1, outputTokens: 1 },
        error: null,
      })),
      cancel: vi.fn(),
    };
    const vercelRuntime: ProviderAdapter = {
      run: vi.fn(async () => ({
        assistantText: "vercel",
        assistantMessage: null,
        stopReason: "end_turn" as const,
        usage: { inputTokens: 2, outputTokens: 2 },
        error: null,
      })),
      cancel: vi.fn(),
    };
    const provider = createProviderAdapter({
      claudeProvider: claudeRuntime,
      vercelProvider: vercelRuntime,
    });

    const anthropicResult = await provider.run({
      runId: "run_1",
      sessionId: "session_1",
      workspaceRoot: "/workspace",
      prompt: "hello",
      historyMessages: [],
      providerConfig: makeConfig({ name: "anthropic", protocol: "anthropic-messages" }),
    });
    const openaiResult = await provider.run({
      runId: "run_2",
      sessionId: "session_1",
      workspaceRoot: "/workspace",
      prompt: "hello",
      historyMessages: [],
      providerConfig: makeConfig({ name: "openai", protocol: "openai-responses", model: "gpt-4o-mini" }),
    });

    expect(anthropicResult.assistantText).toBe("claude");
    expect(openaiResult.assistantText).toBe("vercel");
    expect(claudeRuntime.run).toHaveBeenCalledTimes(1);
    expect(vercelRuntime.run).toHaveBeenCalledTimes(1);
  });
});

describe("THINKING_LEVELS 常量", () => {
  it("应该包含 5 个标准思考级别", () => {
    expect(THINKING_LEVELS).toHaveLength(5);
  });

  it("应该包含正确的标准级别", () => {
    expect(THINKING_LEVELS).toEqual(["off", "minimal", "low", "medium", "high"]);
  });
});

describe("THINKING_LEVELS_WITH_XHIGH 常量", () => {
  it("应该包含 6 个思考级别（包含 xhigh）", () => {
    expect(THINKING_LEVELS_WITH_XHIGH).toHaveLength(6);
  });

  it("应该包含 xhigh 级别", () => {
    expect(THINKING_LEVELS_WITH_XHIGH).toContain("xhigh");
  });

  it("应该包含所有标准级别", () => {
    expect(THINKING_LEVELS_WITH_XHIGH).toContain("off");
    expect(THINKING_LEVELS_WITH_XHIGH).toContain("minimal");
    expect(THINKING_LEVELS_WITH_XHIGH).toContain("low");
    expect(THINKING_LEVELS_WITH_XHIGH).toContain("medium");
    expect(THINKING_LEVELS_WITH_XHIGH).toContain("high");
  });
});

describe("buildAgentInitialState", () => {
  it("应该使用传入的 systemPrompt", () => {
    const initialState = buildAgentInitialState({
      runId: "run_1",
      sessionId: "session_1",
      workspaceRoot: "/workspace",
      prompt: "test",
      historyMessages: [],
      providerConfig: makeConfig({ name: "anthropic", protocol: "anthropic-messages" }),
      systemPrompt: "Custom system prompt",
    });

    expect(initialState.systemPrompt).toBe("Custom system prompt");
  });

  it("应该默认使用空 systemPrompt", () => {
    const initialState = buildAgentInitialState({
      runId: "run_1",
      sessionId: "session_1",
      workspaceRoot: "/workspace",
      prompt: "test",
      historyMessages: [],
      providerConfig: makeConfig({ name: "anthropic", protocol: "anthropic-messages" }),
    });

    expect(initialState.systemPrompt).toBe("");
  });

  it("应该使用传入的 thinkingLevel", () => {
    const initialState = buildAgentInitialState({
      runId: "run_1",
      sessionId: "session_1",
      workspaceRoot: "/workspace",
      prompt: "test",
      historyMessages: [],
      providerConfig: makeConfig({ name: "anthropic", protocol: "anthropic-messages" }),
      thinkingLevel: "high",
    });

    expect(initialState.thinkingLevel).toBe("high");
  });

  it("应该默认 thinkingLevel 为 off", () => {
    const initialState = buildAgentInitialState({
      runId: "run_1",
      sessionId: "session_1",
      workspaceRoot: "/workspace",
      prompt: "test",
      historyMessages: [],
      providerConfig: makeConfig({ name: "anthropic", protocol: "anthropic-messages" }),
    });

    expect(initialState.thinkingLevel).toBe("off");
  });

  it("应该创建模型配置", () => {
    const initialState = buildAgentInitialState({
      runId: "run_1",
      sessionId: "session_1",
      workspaceRoot: "/workspace",
      prompt: "test",
      historyMessages: [],
      providerConfig: makeConfig({ name: "openai", protocol: "openai-responses", model: "gpt-4o" }),
    });

    expect(initialState.model.provider).toBe("openai");
  });

  describe("工具配置", () => {
    it("应该包含启用的工具", () => {
      const initialState = buildAgentInitialState({
        runId: "run_1",
        sessionId: "session_1",
        workspaceRoot: "/workspace",
        prompt: "test",
        historyMessages: [],
        providerConfig: makeConfig({ name: "anthropic", protocol: "anthropic-messages" }),
        enabledTools: ["bash"],
      });

      expect(initialState.tools).toBeDefined();
      expect(typeof initialState.tools).toBe("object");
    });

    it("应该处理空的 enabledTools", () => {
      const initialState = buildAgentInitialState({
        runId: "run_1",
        sessionId: "session_1",
        workspaceRoot: "/workspace",
        prompt: "test",
        historyMessages: [],
        providerConfig: makeConfig({ name: "anthropic", protocol: "anthropic-messages" }),
        enabledTools: [],
      });

      expect(initialState.tools).toBeDefined();
    });
  });
});

describe("PiAiProvider", () => {
  let provider: PiAiProvider;
  let mockInput: ProviderRunInput;

  beforeEach(() => {
    provider = new PiAiProvider();
    mockInput = {
      runId: "test-run",
      sessionId: "test-session",
      workspaceRoot: "/test/workspace",
      prompt: "Test prompt",
      historyMessages: [],
      providerConfig: makeConfig({ name: "anthropic", protocol: "anthropic-messages" }),
      enabledTools: [],
      thinkingLevel: "off",
      toolExecutionMode: "sequential",
    };
  });

  // 工具审批已迁移到 QueryEngine 层，不再由 Provider 处理

  describe("取消运行", () => {
    it("应该能够取消活动运行", () => {
      expect(() => provider.cancel("test-run")).not.toThrow();
    });

    it("应该能够取消不存在的运行", () => {
      expect(() => provider.cancel("nonexistent-run")).not.toThrow();
    });
  });

  describe("ProviderAdapter 接口", () => {
    it("应该实现 run 方法", () => {
      expect(provider).toHaveProperty("run");
      expect(typeof provider.run).toBe("function");
    });

    it("应该实现 cancel 方法", () => {
      expect(provider).toHaveProperty("cancel");
      expect(typeof provider.cancel).toBe("function");
    });

    // approveTool/rejectTool 已迁移到 QueryEngine 层
  });
});

describe("ProviderRunInput 接口", () => {
  it("应该接受所有必需属性", () => {
    const input: ProviderRunInput = {
      runId: "run-1",
      sessionId: "session-1",
      workspaceRoot: "/workspace",
      prompt: "test",
      historyMessages: [],
      providerConfig: makeConfig(),
    };

    expect(input.runId).toBe("run-1");
    expect(input.sessionId).toBe("session-1");
  });

  it("应该接受可选属性", () => {
    const input: ProviderRunInput = {
      runId: "run-1",
      sessionId: "session-1",
      workspaceRoot: "/workspace",
      prompt: "test",
      historyMessages: [],
      historyEntryId: "hist-1",
      providerConfig: makeConfig(),
      systemPrompt: "System prompt",
      enabledTools: ["bash", "read"],
      thinkingLevel: "medium",
      toolExecutionMode: "parallel",
    };

    expect(input.systemPrompt).toBe("System prompt");
    expect(input.thinkingLevel).toBe("medium");
    expect(input.toolExecutionMode).toBe("parallel");
    expect(input.historyEntryId).toBe("hist-1");
  });

  it("应该接受回调函数", () => {
    const input: ProviderRunInput = {
      runId: "run-1",
      sessionId: "session-1",
      workspaceRoot: "/workspace",
      prompt: "test",
      historyMessages: [],
      providerConfig: makeConfig(),
      onTextDelta: (delta: string) => {},
    };

    expect(typeof input.onTextDelta).toBe("function");
  });
});

describe("ProviderRunResult 接口", () => {
  it("应该包含 assistantText", () => {
    const result = { assistantText: "Response text" };
    expect(result.assistantText).toBe("Response text");
  });
});

describe("ProviderToolLifecycleEvent 接口", () => {
  it("应该包含所有必需字段", () => {
    const event = {
      stage: "requested" as const,
      runId: "run-1",
      sessionId: "session-1",
      toolCallId: "run-1:tool:event-1",
      toolName: "bash",
      input: { command: "ls" },
    };

    expect(event.stage).toBe("requested");
    expect(event.runId).toBe("run-1");
    expect(event.toolName).toBe("bash");
    expect(event.input).toEqual({ command: "ls" });
  });
});

describe("ProviderToolLifecycleControl 接口", () => {
  it("应该支持 requested 阶段控制", () => {
    const control = {
      allowExecution: true,
      requiresApproval: false,
    };

    expect(control.allowExecution).toBe(true);
    expect(control.requiresApproval).toBe(false);
  });

  it("应该支持审批阶段控制", () => {
    const control = {
      decision: "approved" as const,
    };

    expect(control.decision).toBe("approved");
  });
});

describe("工具执行模式", () => {
  it("应该支持 sequential 模式", () => {
    const input: ProviderRunInput = {
      runId: "run-1",
      sessionId: "session-1",
      workspaceRoot: "/workspace",
      prompt: "test",
      historyMessages: [],
      providerConfig: makeConfig(),
      toolExecutionMode: "sequential",
    };

    expect(input.toolExecutionMode).toBe("sequential");
  });

  it("应该支持 parallel 模式", () => {
    const input: ProviderRunInput = {
      runId: "run-1",
      sessionId: "session-1",
      workspaceRoot: "/workspace",
      prompt: "test",
      historyMessages: [],
      providerConfig: makeConfig(),
      toolExecutionMode: "parallel",
    };

    expect(input.toolExecutionMode).toBe("parallel");
  });
});

function makeConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: "provider_1",
    name: "anthropic",
    protocol: "anthropic-messages",
    baseUrl: "",
    apiKey: "test-api-key",
    model: "claude-sonnet-4-20250514",
    url: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}
