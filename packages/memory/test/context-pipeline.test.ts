import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ContextPipeline,
  quickBudgetCheck,
  needsContextAttention,
  getContextHealth,
} from "../src/context-pipeline";
import type { ContextPipelineConfig, RuntimeMessage, Session } from "../src/context-pipeline";

// Mock session factory
function createMockSession(): Session {
  return {
    id: "test-session-id",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "running",
    workspaceRoot: "/test",
    latestUserMessage: null,
    latestAssistantMessage: null,
  };
}

// Mock runtime message factory
function createMockToolResultMessage(content: string): RuntimeMessage {
  return {
    role: "runtimeToolOutput",
    toolCallId: "tool-1",
    toolName: "read",
    content,
    isError: false,
    timestamp: Date.now(),
  };
}

function createMockUserMessage(content: string): RuntimeMessage {
  return {
    role: "user",
    content,
    timestamp: Date.now(),
  };
}

function createMockAssistantMessage(content: string): RuntimeMessage {
  return {
    role: "assistantTranscript",
    content,
    timestamp: Date.now(),
  };
}

describe("ContextPipeline", () => {
  const providerConfig = {
    type: "anthropic" as const,
    model: "claude-3-5-sonnet-20241022",
  };

  describe("constructor", () => {
    it("should create pipeline with config", () => {
      const config: ContextPipelineConfig = {
        providerConfig,
        enableMicroCompact: true,
        enableContextCollapse: true,
      };

      const pipeline = new ContextPipeline(config);

      expect(pipeline).toBeDefined();
    });
  });

  describe("execute", () => {
    it("should return messages unchanged when context is healthy", async () => {
      const config: ContextPipelineConfig = {
        providerConfig,
        enableMicroCompact: true,
        enableContextCollapse: true,
      };

      const pipeline = new ContextPipeline(config);
      const messages = [
        createMockUserMessage("Hello"),
        createMockAssistantMessage("Hi there!"),
      ];
      const session = createMockSession();

      const result = await pipeline.execute({
        messages,
        session,
      });

      expect(result.didCompact).toBe(false);
      expect(result.messages).toHaveLength(2);
      expect(result.warningState).toBeDefined();
      expect(result.budget).toBeDefined();
    });

    it("should run tool result budget stage", async () => {
      const config: ContextPipelineConfig = {
        providerConfig,
        enableMicroCompact: true,
        enableContextCollapse: true,
        maxToolResultTokens: 500,
      };

      const pipeline = new ContextPipeline(config);
      // Create a message that exceeds the max token limit
      const largeContent = "x".repeat(10000);
      const messages = [
        createMockUserMessage("Read file"),
        createMockToolResultMessage(largeContent),
      ];
      const session = createMockSession();

      const result = await pipeline.execute({
        messages,
        session,
      });

      expect(result.messages).toBeDefined();
    });

    it("should run micro compact when above warning threshold", async () => {
      const config: ContextPipelineConfig = {
        providerConfig,
        enableMicroCompact: true,
        enableContextCollapse: true,
        maxToolResultTokens: 2000,
      };

      const pipeline = new ContextPipeline(config);
      // Create large tool results to trigger micro compact
      const messages: RuntimeMessage[] = [];
      for (let i = 0; i < 10; i++) {
        messages.push(createMockToolResultMessage("Large content: " + "x".repeat(5000)));
      }
      const session = createMockSession();

      const result = await pipeline.execute({
        messages,
        session,
      });

      expect(result.messages).toBeDefined();
    });

    it("should include usage estimate in result", async () => {
      const config: ContextPipelineConfig = {
        providerConfig,
      };

      const pipeline = new ContextPipeline(config);
      const messages = [createMockUserMessage("Test")];
      const session = createMockSession();

      const result = await pipeline.execute({
        messages,
        session,
      });

      expect(result.usageEstimate).toBeDefined();
      expect(typeof result.usageEstimate.tokens).toBe("number");
    });
  });

  describe("getReport", () => {
    it("should return pipeline execution report", async () => {
      const config: ContextPipelineConfig = {
        providerConfig,
        enableMicroCompact: true,
        enableContextCollapse: true,
      };

      const pipeline = new ContextPipeline(config);
      const messages = [createMockUserMessage("Hello")];
      const session = createMockSession();

      await pipeline.execute({
        messages,
        session,
      });

      const report = pipeline.getReport();

      expect(report.stages).toBeDefined();
      expect(Array.isArray(report.stages)).toBe(true);
      expect(report.finalBudget).toBeDefined();
      expect(report.finalWarningState).toBeDefined();
    });
  });
});

describe("quickBudgetCheck", () => {
  it("should return warning state for empty messages", () => {
    const config = {
      type: "anthropic" as const,
      model: "claude-3-5-sonnet-20241022",
    };

    const state = quickBudgetCheck([], config);

    expect(state.percentLeft).toBe(100);
    expect(state.isAboveAutoCompactThreshold).toBe(false);
  });

  it("should detect high usage", () => {
    const config = {
      type: "anthropic" as const,
      model: "claude-3-5-sonnet-20241022",
    };

    // Create enough messages to trigger warning
    const messages: RuntimeMessage[] = [];
    for (let i = 0; i < 100; i++) {
      messages.push(createMockToolResultMessage("Content: " + "x".repeat(2000)));
    }

    const state = quickBudgetCheck(messages, config);

    // Should detect some level of usage
    expect(state.percentLeft).toBeLessThan(100);
  });
});

describe("needsContextAttention", () => {
  it("should return false for healthy context", () => {
    const config = {
      type: "anthropic" as const,
      model: "claude-3-5-sonnet-20241022",
    };

    const needsAttention = needsContextAttention([createMockUserMessage("Hi")], config);

    expect(needsAttention).toBe(false);
  });
});

describe("getContextHealth", () => {
  it("should return health percentage", () => {
    const config = {
      type: "anthropic" as const,
      model: "claude-3-5-sonnet-20241022",
    };

    const health = getContextHealth([createMockUserMessage("Hi")], config);

    expect(health).toBeGreaterThan(0);
    expect(health).toBeLessThanOrEqual(100);
  });
});
