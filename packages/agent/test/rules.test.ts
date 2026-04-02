import { describe, expect, it } from "vitest";
import {
  matchToolName,
  matchCommand,
  matchPathPrefix,
  matchMcpServer,
  ruleMatchesContext,
  SOURCE_PRIORITY,
  DEFAULT_RULES,
  WRITE_TOOLS,
  READ_TOOLS,
  type PermissionContext,
  type PermissionRule,
} from "../../../src/permissions/rules";

describe("permissions/rules", () => {
  // ============================================================================
  // Tool Name Matcher
  // ============================================================================
  describe("matchToolName", () => {
    it("应该精确匹配工具名", () => {
      expect(matchToolName("bash", "bash")).toBe(true);
      expect(matchToolName("read", "read")).toBe(true);
      expect(matchToolName("edit", "edit")).toBe(false);
    });

    it("应该支持尾随通配符匹配", () => {
      expect(matchToolName("mcp__github", "mcp__*")).toBe(true);
      expect(matchToolName("mcp__filesystem", "mcp__*")).toBe(true);
      expect(matchToolName("bash", "mcp__*")).toBe(false);
    });

    it("空模式应该只匹配空字符串", () => {
      expect(matchToolName("bash", "")).toBe(false);
      expect(matchToolName("", "")).toBe(true);
    });
  });

  // ============================================================================
  // Command Pattern Matcher
  // ============================================================================
  describe("matchCommand", () => {
    it("应该匹配简单命令模式", () => {
      expect(matchCommand("rm -rf /tmp/test", "rm")).toBe(true);
      expect(matchCommand("ls -la", "ls")).toBe(true);
      expect(matchCommand("git status", "npm")).toBe(false);
    });

    it("应该支持正则表达式", () => {
      expect(matchCommand("rm -rf /", "\\brm\\s+-rf")).toBe(true);
      expect(matchCommand("rm -r /tmp", "\\brm\\s+-rf")).toBe(false);
    });

    it("应该忽略大小写", () => {
      expect(matchCommand("RM -RF /tmp", "rm")).toBe(true);
      expect(matchCommand("Bash script.sh", "bash")).toBe(true);
    });

    it("无效正则应该返回 false", () => {
      expect(matchCommand("test", "[invalid")).toBe(false);
      expect(matchCommand("test", "(unclosed")).toBe(false);
    });

    it("边界情况", () => {
      expect(matchCommand("", ".*")).toBe(true);
      expect(matchCommand("test", "")).toBe(true);
    });
  });

  // ============================================================================
  // Path Prefix Matcher
  // ============================================================================
  describe("matchPathPrefix", () => {
    it("应该精确匹配路径前缀", () => {
      expect(matchPathPrefix("/home/user/project", "/home/user")).toBe(true);
      expect(matchPathPrefix("/home/user/file.txt", "/home/user")).toBe(true);
      expect(matchPathPrefix("/other/path", "/home/user")).toBe(false);
    });

    it("应该处理 ./ 前缀变体", () => {
      expect(matchPathPrefix("./relative/path", "relative")).toBe(true);
      expect(matchPathPrefix("relative/path", "relative")).toBe(true);
    });

    it("边界情况", () => {
      expect(matchPathPrefix("/home", "/home")).toBe(true);
      expect(matchPathPrefix("/home longer", "/home")).toBe(false);
    });
  });

  // ============================================================================
  // MCP Server Matcher
  // ============================================================================
  describe("matchMcpServer", () => {
    it("应该匹配服务器名前缀", () => {
      expect(matchMcpServer("github", "github")).toBe(true);
      expect(matchMcpServer("github-rest-api", "github")).toBe(true);
      expect(matchMcpServer("filesystem", "github")).toBe(false);
    });

    it("边界情况", () => {
      expect(matchMcpServer("", "github")).toBe(false);
      expect(matchMcpServer("github", "")).toBe(true);
    });
  });

  // ============================================================================
  // Source Priority
  // ============================================================================
  describe("SOURCE_PRIORITY", () => {
    it("session 应该有最高优先级", () => {
      expect(SOURCE_PRIORITY.session).toBeGreaterThan(SOURCE_PRIORITY.project);
      expect(SOURCE_PRIORITY.session).toBeGreaterThan(SOURCE_PRIORITY.user);
    });

    it("project 应该有高于 user 的优先级", () => {
      expect(SOURCE_PRIORITY.project).toBeGreaterThan(SOURCE_PRIORITY.user);
    });

    it("default 应该有最低优先级", () => {
      expect(SOURCE_PRIORITY.default).toBeLessThan(SOURCE_PRIORITY.session);
      expect(SOURCE_PRIORITY.default).toBeLessThan(SOURCE_PRIORITY.managed);
    });
  });

  // ============================================================================
  // Rule Match Context
  // ============================================================================
  describe("ruleMatchesContext", () => {
    const createContext = (overrides: Partial<PermissionContext> = {}): PermissionContext => ({
      toolName: "bash",
      input: { command: "ls -la" },
      planMode: false,
      sessionId: "test-session",
      ...overrides,
    });

    it("应该对非活跃规则返回 false", () => {
      const rule: PermissionRule = {
        id: "test",
        source: "default",
        decision: "allow",
        matchers: [{ type: "tool_name", pattern: "bash" }],
        description: "test",
        active: false,
      };
      expect(ruleMatchesContext(rule, createContext())).toBe(false);
    });

    it("tool_name 匹配器应该正确工作", () => {
      const rule: PermissionRule = {
        id: "test",
        source: "default",
        decision: "allow",
        matchers: [{ type: "tool_name", pattern: "bash" }],
        description: "test",
        active: true,
      };
      expect(ruleMatchesContext(rule, createContext({ toolName: "bash" }))).toBe(true);
      expect(ruleMatchesContext(rule, createContext({ toolName: "read" }))).toBe(false);
    });

    it("command 匹配器应该从 input 中提取命令", () => {
      const rule: PermissionRule = {
        id: "test",
        source: "default",
        decision: "deny",
        matchers: [{ type: "command", pattern: "rm" }],
        description: "test",
        active: true,
      };
      expect(ruleMatchesContext(rule, createContext({ input: { command: "rm -rf /" } }))).toBe(true);
      expect(ruleMatchesContext(rule, createContext({ input: { command: "ls" } }))).toBe(false);
      expect(ruleMatchesContext(rule, createContext({ input: {} }))).toBe(false);
    });

    it("command 匹配器应该支持 cmd 别名", () => {
      const rule: PermissionRule = {
        id: "test",
        source: "default",
        decision: "deny",
        matchers: [{ type: "command", pattern: "npm" }],
        description: "test",
        active: true,
      };
      expect(ruleMatchesContext(rule, createContext({ input: { cmd: "npm install" } }))).toBe(true);
    });

    it("path_prefix 匹配器应该从 input 中提取路径", () => {
      const rule: PermissionRule = {
        id: "test",
        source: "default",
        decision: "deny",
        matchers: [{ type: "path_prefix", prefix: "/etc" }],
        description: "test",
        active: true,
      };
      expect(ruleMatchesContext(rule, createContext({ input: { path: "/etc/passwd" } }))).toBe(true);
      expect(ruleMatchesContext(rule, createContext({ input: { path: "/home/user" } }))).toBe(false);
      expect(ruleMatchesContext(rule, createContext({ input: {} }))).toBe(false);
    });

    it("path_prefix 匹配器应该支持多种路径字段别名", () => {
      const rule: PermissionRule = {
        id: "test",
        source: "default",
        decision: "deny",
        matchers: [{ type: "path_prefix", prefix: "/tmp" }],
        description: "test",
        active: true,
      };
      expect(ruleMatchesContext(rule, createContext({ input: { file_path: "/tmp/file" } }))).toBe(true);
      expect(ruleMatchesContext(rule, createContext({ input: { filePath: "/tmp/file" } }))).toBe(true);
      expect(ruleMatchesContext(rule, createContext({ input: { file: "/tmp/file" } }))).toBe(true);
    });

    it("mcp_server 匹配器应该需要上下文中的 serverName", () => {
      const rule: PermissionRule = {
        id: "test",
        source: "default",
        decision: "allow",
        matchers: [{ type: "mcp_server", prefix: "github" }],
        description: "test",
        active: true,
      };
      expect(ruleMatchesContext(rule, createContext({ mcpServerName: "github" }))).toBe(true);
      expect(ruleMatchesContext(rule, createContext({ mcpServerName: "filesystem" }))).toBe(false);
      expect(ruleMatchesContext(rule, createContext({ mcpServerName: undefined }))).toBe(false);
    });

    it("多匹配器规则应该要求所有匹配器都满足", () => {
      const rule: PermissionRule = {
        id: "test",
        source: "default",
        decision: "deny",
        matchers: [
          { type: "tool_name", pattern: "bash" },
          { type: "command", pattern: "rm" },
        ],
        description: "test",
        active: true,
      };
      // 工具名匹配但命令不匹配
      expect(ruleMatchesContext(rule, createContext({ input: { command: "ls" } }))).toBe(false);
      // 两个都匹配
      expect(ruleMatchesContext(rule, createContext({ input: { command: "rm -rf /" } }))).toBe(true);
    });
  });

  // ============================================================================
  // Default Rules
  // ============================================================================
  describe("DEFAULT_RULES", () => {
    it("应该包含危险的 rm -rf / 拒绝规则", () => {
      const rmRule = DEFAULT_RULES.find((r) => r.id === "default:deny-rm-rf");
      expect(rmRule).toBeDefined();
      expect(rmRule?.decision).toBe("deny");
      expect(rmRule?.active).toBe(true);
    });

    it("应该包含 bash 询问规则", () => {
      const bashRule = DEFAULT_RULES.find((r) => r.id === "default:ask-bash");
      expect(bashRule).toBeDefined();
      expect(bashRule?.decision).toBe("ask");
    });

    it("应该包含只读工具允许规则", () => {
      const readRule = DEFAULT_RULES.find((r) => r.id === "default:allow-read");
      const lsRule = DEFAULT_RULES.find((r) => r.id === "default:allow-ls");
      const grepRule = DEFAULT_RULES.find((r) => r.id === "default:allow-grep");
      const findRule = DEFAULT_RULES.find((r) => r.id === "default:allow-find");

      expect(readRule?.decision).toBe("allow");
      expect(lsRule?.decision).toBe("allow");
      expect(grepRule?.decision).toBe("allow");
      expect(findRule?.decision).toBe("allow");
    });

    it("应该包含 MCP 工具默认询问规则", () => {
      const mcpRule = DEFAULT_RULES.find((r) => r.id === "default:ask-mcp");
      expect(mcpRule).toBeDefined();
      expect(mcpRule?.decision).toBe("ask");
    });

    it("所有默认规则应该都是活跃的", () => {
      DEFAULT_RULES.forEach((rule) => {
        expect(rule.active).toBe(true);
      });
    });

    it("所有默认规则应该有有效来源", () => {
      const validSources = ["session", "project", "user", "managed", "default"];
      DEFAULT_RULES.forEach((rule) => {
        expect(validSources).toContain(rule.source);
      });
    });
  });

  // ============================================================================
  // Tool Sets
  // ============================================================================
  describe("WRITE_TOOLS and READ_TOOLS", () => {
    it("WRITE_TOOLS 应该包含写操作工具", () => {
      expect(WRITE_TOOLS.has("bash")).toBe(true);
      expect(WRITE_TOOLS.has("edit")).toBe(true);
      expect(WRITE_TOOLS.has("write")).toBe(true);
    });

    it("READ_TOOLS 应该包含只读工具", () => {
      expect(READ_TOOLS.has("read")).toBe(true);
      expect(READ_TOOLS.has("ls")).toBe(true);
      expect(READ_TOOLS.has("grep")).toBe(true);
      expect(READ_TOOLS.has("find")).toBe(true);
    });

    it("WRITE_TOOLS 和 READ_TOOLS 应该互斥", () => {
      for (const tool of WRITE_TOOLS) {
        expect(READ_TOOLS.has(tool)).toBe(false);
      }
      for (const tool of READ_TOOLS) {
        expect(WRITE_TOOLS.has(tool)).toBe(false);
      }
    });
  });
});
