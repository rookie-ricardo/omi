import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  PermissionEvaluator,
  createPermissionEvaluator,
  type PermissionEvaluatorConfig,
  type PermissionContext,
  type PermissionRule,
} from "../../src/permissions/evaluator";
import type { DenialTracker } from "../../src/permissions/tracking";
import { MemoryDenialTracker } from "../../src/permissions/tracking";

describe("permissions/evaluator", () => {
  // ============================================================================
  // 测试辅助
  // ============================================================================
  const createContext = (overrides: Partial<PermissionContext> = {}): PermissionContext => ({
    toolName: "bash",
    input: { command: "ls -la" },
    planMode: false,
    sessionId: "test-session",
    ...overrides,
  });

  const createRule = (overrides: Partial<PermissionRule> = {}): PermissionRule => ({
    id: "test-rule",
    source: "default",
    decision: "ask",
    matchers: [{ type: "tool_name", pattern: "bash" }],
    description: "test rule",
    active: true,
    ...overrides,
  });

  // Mock DenialTracker
  const createMockTracker = (): DenialTracker & {
    records: Map<string, number>;
  } => {
    const records = new Map<string, number>();
    return {
      records,
      recordDenial: (key: string) => {
        records.set(key, (records.get(key) ?? 0) + 1);
      },
      getDenialCount: (key: string) => records.get(key) ?? 0,
      getDenialRecord: vi.fn(),
      recordRetry: vi.fn(),
      clear: vi.fn(),
      clearAll: vi.fn(),
      getAllRecords: vi.fn(() => []),
      hasExceededThreshold: vi.fn((key: string, threshold: number) => (records.get(key) ?? 0) >= threshold),
    };
  };

  // ============================================================================
  // PermissionEvaluator 基础功能
  // ============================================================================
  describe("PermissionEvaluator", () => {
    let evaluator: PermissionEvaluator;

    describe("构造函数", () => {
      it("应该使用默认配置", () => {
        evaluator = new PermissionEvaluator({});
        expect(evaluator).toBeDefined();
      });

      it("应该接受自定义配置", () => {
        evaluator = new PermissionEvaluator({
          sessionRules: [createRule()],
          maxConsecutiveDenials: 10,
          enforcePlanMode: false,
        });
        expect(evaluator).toBeDefined();
      });
    });

    describe("evaluate - 基础决策", () => {
      beforeEach(() => {
        evaluator = new PermissionEvaluator({});
      });

      it("没有匹配规则时应该返回 ask", () => {
        const result = evaluator.evaluate(createContext({ toolName: "unknown-tool" }));
        expect(result.decision).toBe("ask");
        expect(result.matchedRule).toBeNull();
        expect(result.matchedRules).toEqual([]);
      });

      it("应该正确匹配 allow 规则", () => {
        const rule = createRule({ decision: "allow", matchers: [{ type: "tool_name", pattern: "bash" }] });
        evaluator = new PermissionEvaluator({ extraDefaultRules: [rule] });

        const result = evaluator.evaluate(createContext({ toolName: "bash" }));
        expect(result.decision).toBe("allow");
        expect(result.matchedRule?.id).toBe("test-rule");
      });

      it("应该正确匹配 ask 规则", () => {
        const rule = createRule({ decision: "ask", matchers: [{ type: "tool_name", pattern: "bash" }] });
        evaluator = new PermissionEvaluator({ extraDefaultRules: [rule] });

        const result = evaluator.evaluate(createContext({ toolName: "bash" }));
        expect(result.decision).toBe("ask");
      });

      it("应该正确匹配 deny 规则", () => {
        const rule = createRule({ decision: "deny", matchers: [{ type: "tool_name", pattern: "bash" }] });
        evaluator = new PermissionEvaluator({ extraDefaultRules: [rule] });

        const result = evaluator.evaluate(createContext({ toolName: "bash" }));
        expect(result.decision).toBe("deny");
      });
    });

    describe("evaluate - 优先级", () => {
      it("session 规则应该有最高优先级", () => {
        const sessionRule = createRule({ id: "session-rule", source: "session", decision: "allow" });
        const defaultRule = createRule({ id: "default-rule", source: "default", decision: "deny" });

        evaluator = new PermissionEvaluator({
          sessionRules: [sessionRule],
          extraDefaultRules: [defaultRule],
        });

        const result = evaluator.evaluate(createContext());
        expect(result.decision).toBe("allow");
        expect(result.matchedRule?.id).toBe("session-rule");
      });

      it("project 规则应该优先于 user 规则", () => {
        const projectRule = createRule({ id: "project-rule", source: "project", decision: "allow" });
        const userRule = createRule({ id: "user-rule", source: "user", decision: "deny" });

        evaluator = new PermissionEvaluator({
          projectRules: [projectRule],
          userRules: [userRule],
        });

        const result = evaluator.evaluate(createContext());
        expect(result.decision).toBe("allow");
        expect(result.matchedRule?.id).toBe("project-rule");
      });

      it("应该返回所有匹配的规则", () => {
        const rule1 = createRule({ id: "rule-1", source: "default", decision: "allow" });
        const rule2 = createRule({ id: "rule-2", source: "session", decision: "ask" });

        evaluator = new PermissionEvaluator({
          sessionRules: [rule2],
          extraDefaultRules: [rule1],
        });

        const result = evaluator.evaluate(createContext());
        expect(result.matchedRules.length).toBe(3);
        // 按优先级降序排列
        expect(result.matchedRules[0].id).toBe("rule-2");
        expect(result.matchedRules[1].id).toBe("rule-1");
      });
    });

    describe("evaluate - deny-first 逻辑", () => {
      beforeEach(() => {
        const allowRule = createRule({ id: "allow", decision: "allow" });
        const askRule = createRule({ id: "ask", decision: "ask" });
        const denyRule = createRule({ id: "deny", decision: "deny" });

        evaluator = new PermissionEvaluator({ extraDefaultRules: [allowRule, askRule, denyRule] });
      });

      it("存在 deny 规则时应该优先 deny", () => {
        const result = evaluator.evaluate(createContext());
        expect(result.decision).toBe("deny");
      });

      it("没有 deny 但有 ask 时应该返回 ask", () => {
        const allowRule = createRule({ id: "allow", decision: "allow" });
        const askRule = createRule({ id: "ask", decision: "ask" });
        evaluator = new PermissionEvaluator({ extraDefaultRules: [allowRule, askRule] });

        const result = evaluator.evaluate(createContext());
        expect(result.decision).toBe("ask");
      });
    });

    describe("evaluate - Denial Tracker 集成", () => {
      it("连续拒绝超限应该escalate到deny", () => {
        const tracker = new MemoryDenialTracker(3);
        // 记录3次拒绝
        tracker.recordDenial("test-session:bash");
        tracker.recordDenial("test-session:bash");
        tracker.recordDenial("test-session:bash");

        evaluator = new PermissionEvaluator({ maxConsecutiveDenials: 3 }, tracker);

        const result = evaluator.evaluate(createContext());
        expect(result.decision).toBe("deny");
      });

      it("拒绝计数未超限时不应escalate", () => {
        const tracker = new MemoryDenialTracker(5);
        tracker.recordDenial("test-session:bash");
        tracker.recordDenial("test-session:bash");

        evaluator = new PermissionEvaluator(
          {
            maxConsecutiveDenials: 3,
            extraDefaultRules: [createRule({ decision: "allow" })],
          },
          tracker,
        );

        const result = evaluator.evaluate(createContext());
        expect(result.decision).toBe("allow");
      });
    });

    describe("evaluate - Plan Mode", () => {
      it("应该阻止 plan mode 下的写操作", () => {
        evaluator = new PermissionEvaluator({ enforcePlanMode: true });

        const result = evaluator.evaluate(createContext({
          toolName: "bash",
          planMode: true,
        }));

        expect(result.decision).toBe("deny");
        expect(result.matchedRule?.id).toBe("plan-mode:write-blocked");
      });

      it("应该允许 plan mode 下的只读操作", () => {
        evaluator = new PermissionEvaluator({ enforcePlanMode: true });

        const result = evaluator.evaluate(createContext({
          toolName: "read",
          planMode: true,
        }));

        expect(result.decision).toBe("allow");
      });

      it("不强制 plan mode 时应该使用正常规则", () => {
        evaluator = new PermissionEvaluator({ enforcePlanMode: false });

        const result = evaluator.evaluate(createContext({
          toolName: "bash",
          planMode: true,
        }));

        expect(result.decision).toBe("ask"); // 默认规则
      });
    });

    describe("filterVisibleTools", () => {
      it("应该隐藏被拒绝的工具", () => {
        const denyRule = createRule({ id: "deny-all", decision: "deny", matchers: [{ type: "tool_name", pattern: "bash" }] });
        evaluator = new PermissionEvaluator({ extraDefaultRules: [denyRule] });

        const visible = evaluator.filterVisibleTools(["bash", "read", "ls"], {
          toolName: "root",
          planMode: false,
          sessionId: "test",
        });

        expect(visible).toEqual(["read", "ls"]);
      });

      it("应该保留被允许和询问的工具", () => {
        evaluator = new PermissionEvaluator({});

        const visible = evaluator.filterVisibleTools(["bash", "read", "ls"], {
          toolName: "root",
          planMode: false,
          sessionId: "test",
        });

        expect(visible).toContain("bash");
        expect(visible).toContain("read");
        expect(visible).toContain("ls");
      });
    });

    describe("preflightCheck", () => {
      it("应该返回 null 当工具被允许时", () => {
        evaluator = new PermissionEvaluator({
          extraDefaultRules: [createRule({ decision: "allow" })],
        });

        const result = evaluator.preflightCheck(createContext());
        expect(result).toBeNull();
      });

      it("应该返回错误消息当工具被拒绝时", () => {
        evaluator = new PermissionEvaluator({
          extraDefaultRules: [createRule({ decision: "deny", description: "denied by policy" })],
        });

        const result = evaluator.preflightCheck(createContext());
        expect(result).toContain("denied by policy");
      });

      it("plan mode 下写工具应该被阻止", () => {
        evaluator = new PermissionEvaluator({ enforcePlanMode: true });

        const result = evaluator.preflightCheck(createContext({
          toolName: "bash",
          planMode: true,
        }));

        expect(result).toContain("not allowed in plan mode");
      });
    });

    describe("Rule Management", () => {
      beforeEach(() => {
        evaluator = new PermissionEvaluator({});
      });

      describe("addSessionRule", () => {
        it("应该添加 session 规则", () => {
          evaluator.addSessionRule(createRule({ decision: "allow" }));

          const result = evaluator.evaluate(createContext());
          expect(result.decision).toBe("allow");
        });

        it("添加的规则应该标记为 session 源", () => {
          evaluator.addSessionRule(createRule({ source: "project", decision: "allow" }));

          const result = evaluator.evaluate(createContext());
          expect(result.matchedRule?.source).toBe("session");
        });
      });

      describe("clearSessionRules", () => {
        it("应该清除所有 session 规则", () => {
          evaluator.addSessionRule(createRule({ decision: "allow" }));
          evaluator.clearSessionRules();

          const result = evaluator.evaluate(createContext());
          expect(result.decision).toBe("ask"); // 回到默认
        });

        it("应该按工具名清除特定规则", () => {
          evaluator.addSessionRule(createRule({ id: "rule-bash", matchers: [{ type: "tool_name", pattern: "bash" }], decision: "allow" }));
          evaluator.addSessionRule(createRule({ id: "rule-read", matchers: [{ type: "tool_name", pattern: "read" }], decision: "deny" }));

          evaluator.clearSessionRules("bash");

          // bash 应该回到默认 (ask)
          const bashResult = evaluator.evaluate(createContext({ toolName: "bash" }));
          expect(bashResult.decision).toBe("ask");

          // read 应该仍然被拒绝
          const readResult = evaluator.evaluate(createContext({ toolName: "read" }));
          expect(readResult.decision).toBe("deny");
        });
      });
    });
  });

  // ============================================================================
  // createPermissionEvaluator Builder
  // ============================================================================
  describe("createPermissionEvaluator", () => {
    it("应该创建 evaluator", () => {
      const evaluator = createPermissionEvaluator().build();
      expect(evaluator).toBeInstanceOf(PermissionEvaluator);
    });

    it("应该支持链式调用", () => {
      const evaluator = createPermissionEvaluator()
        .withSessionRules([createRule({ decision: "allow" })])
        .withProjectRules([createRule({ decision: "ask" })])
        .withDenialTracker(new MemoryDenialTracker())
        .build();

      const result = evaluator.evaluate(createContext());
      expect(result.decision).toBe("allow");
    });

    it("应该支持所有规则类型", () => {
      const sessionRule = createRule({ id: "s", decision: "allow" });
      const projectRule = createRule({ id: "p", decision: "ask" });
      const userRule = createRule({ id: "u", decision: "deny" });
      const managedRule = createRule({ id: "m", decision: "ask" });

      const evaluator = createPermissionEvaluator()
        .withSessionRules([sessionRule])
        .withProjectRules([projectRule])
        .withUserRules([userRule])
        .withManagedRules([managedRule])
        .build();

      const result = evaluator.evaluate(createContext());
      // session 规则优先
      expect(result.decision).toBe("allow");
      expect(result.matchedRule?.id).toBe("s");
    });
  });

  // ============================================================================
  // 边界情况与错误处理
  // ============================================================================
  describe("边界情况", () => {
    it("应该处理空的 input", () => {
      const evaluator = new PermissionEvaluator({});
      const result = evaluator.evaluate(createContext({ input: {} }));
      expect(result.decision).toBe("ask"); // 默认行为
    });

    it("应该处理没有 sessionId", () => {
      const evaluator = new PermissionEvaluator({});
      const result = evaluator.evaluate(createContext({ sessionId: "" }));
      expect(result.decision).toBe("ask");
    });

    it("应该处理没有 toolName", () => {
      const evaluator = new PermissionEvaluator({});
      const result = evaluator.evaluate(createContext({ toolName: "" }));
      expect(result.decision).toBe("ask");
    });

    it("应该处理带有特殊字符的 toolName", () => {
      const specialRule = createRule({ id: "special", matchers: [{ type: "tool_name", pattern: "mcp__github__*"}], decision: "allow" });
      const evaluator = new PermissionEvaluator({ extraDefaultRules: [specialRule] });

      const result = evaluator.evaluate(createContext({ toolName: "mcp__github__repo" }));
      expect(result.decision).toBe("allow");
    });

    it("command 匹配器应该在 input 为空时返回 false", () => {
      const rule = createRule({
        matchers: [{ type: "command", pattern: "test" }],
      });
      const evaluator = new PermissionEvaluator({ extraDefaultRules: [rule] });

      const result = evaluator.evaluate(createContext({ input: {} }));
      expect(result.decision).toBe("ask"); // 匹配失败，使用下一个规则
    });

    it("path_prefix 匹配器应该在 input 为空时返回 false", () => {
      const rule = createRule({
        matchers: [{ type: "path_prefix", prefix: "/etc" }],
      });
      const evaluator = new PermissionEvaluator({ extraDefaultRules: [rule] });

      const result = evaluator.evaluate(createContext({ input: {} }));
      expect(result.decision).toBe("ask"); // 匹配失败
    });
  });
});
