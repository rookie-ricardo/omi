import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SessionRuntime } from "../src/session-manager";
import { AgentSession } from "../src/agent-session";
import { createAppDatabase } from "@omi/store";

describe("AgentSession fork", () => {
  it("copies only the latest summary window into a new session and remaps message ids", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omi-fork-test-"));

    try {
      const db = createAppDatabase(join(dir, "app.db"));
      const sourceSession = db.createSession("Source Session");
      db.updateSession(sourceSession.id, {
        providerConfigId: "provider_1",
        model: "gpt-5.4",
        permissionMode: "yolo",
        thinkLevel: "high",
      });

      db.addMessage({
        id: "msg_old_user",
        sessionId: sourceSession.id,
        taskId: null,
        parentMessageId: null,
        role: "user",
        messageType: "text",
        content: "old user",
        model: null,
        tokens: 1,
        totalTokens: 1,
        compressedFromMessageId: null,
      });
      db.updateMessage("msg_old_user", { createdAt: "2026-04-19T10:00:00.000Z" });
      db.addMessage({
        id: "msg_old_assistant",
        sessionId: sourceSession.id,
        taskId: null,
        parentMessageId: null,
        role: "assistant",
        messageType: "text",
        content: "old assistant",
        model: "gpt-5.4",
        tokens: 1,
        totalTokens: 1,
        compressedFromMessageId: null,
      });
      db.updateMessage("msg_old_assistant", { createdAt: "2026-04-19T10:01:00.000Z" });
      db.addMessage({
        id: "msg_summary",
        sessionId: sourceSession.id,
        taskId: null,
        parentMessageId: null,
        role: "assistant",
        messageType: "summary",
        content: "summary",
        model: "gpt-5.4",
        tokens: 1,
        totalTokens: 1,
        compressedFromMessageId: "msg_old_user",
      });
      db.updateMessage("msg_summary", { createdAt: "2026-04-19T10:02:00.000Z" });
      db.addMessage({
        id: "msg_new_user",
        sessionId: sourceSession.id,
        taskId: null,
        parentMessageId: null,
        role: "user",
        messageType: "text",
        content: "new user",
        model: null,
        tokens: 1,
        totalTokens: 1,
        compressedFromMessageId: null,
      });
      db.updateMessage("msg_new_user", { createdAt: "2026-04-19T10:03:00.000Z" });
      db.addMessage({
        id: "msg_tool_call",
        sessionId: sourceSession.id,
        taskId: null,
        parentMessageId: "msg_new_user",
        role: "tool",
        messageType: "tool_call",
        content: "{\"cmd\":\"rg --files\"}",
        model: null,
        tokens: 1,
        totalTokens: 1,
        compressedFromMessageId: null,
      });
      db.updateMessage("msg_tool_call", { createdAt: "2026-04-19T10:04:00.000Z" });
      db.createToolCall({
        id: "tool_1",
        messageId: "msg_tool_call",
        sessionId: sourceSession.id,
        toolName: "exec_command",
        approvalState: "not_required",
        input: { cmd: "rg --files" },
        output: { stdout: "a.ts" },
        error: null,
      });
      db.updateToolCall("tool_1", { createdAt: "2026-04-19T10:04:30.000Z" });
      db.addMessage({
        id: "msg_tool_result",
        sessionId: sourceSession.id,
        taskId: null,
        parentMessageId: "msg_tool_call",
        role: "tool",
        messageType: "tool_result",
        content: "a.ts",
        model: null,
        tokens: 1,
        totalTokens: 1,
        compressedFromMessageId: null,
      });
      db.updateMessage("msg_tool_result", { createdAt: "2026-04-19T10:04:45.000Z" });
      db.addMessage({
        id: "msg_new_assistant",
        sessionId: sourceSession.id,
        taskId: null,
        parentMessageId: "msg_new_user",
        role: "assistant",
        messageType: "text",
        content: "new assistant",
        model: "gpt-5.4",
        tokens: 1,
        totalTokens: 1,
        compressedFromMessageId: null,
      });
      db.updateMessage("msg_new_assistant", { createdAt: "2026-04-19T10:05:00.000Z" });

      const session = new AgentSession({
        database: db,
        sessionId: sourceSession.id,
        workspaceRoot: process.cwd(),
        emit: () => undefined,
        resources: {} as never,
        runtime: new SessionRuntime(sourceSession.id),
        provider: {
          run: async () => {
            throw new Error("not used");
          },
          cancel: () => undefined,
        },
      });

      const result = await session.fork("");
      const forkedMessages = db.listMessages(result.newSessionId);
      const forkedToolCalls = db.listToolCallsBySession(result.newSessionId);

      expect(forkedMessages).toHaveLength(5);
      expect(forkedToolCalls).toHaveLength(1);
      expect(forkedMessages.map((message) => message.content)).toEqual([
        "summary",
        "new user",
        "{\"cmd\":\"rg --files\"}",
        "a.ts",
        "new assistant",
      ]);
      expect(forkedMessages.some((message) => message.id === "msg_old_user")).toBe(false);
      expect(forkedMessages.some((message) => message.id === "msg_new_user")).toBe(false);

      const summary = forkedMessages[0]!;
      const newUser = forkedMessages[1]!;
      const toolCallMessage = forkedMessages[2]!;
      const toolResultMessage = forkedMessages[3]!;
      const newAssistant = forkedMessages[4]!;

      expect(summary.messageType).toBe("summary");
      expect(summary.compressedFromMessageId).toBe(summary.id);
      expect(toolCallMessage.parentMessageId).toBe(newUser.id);
      expect(toolResultMessage.parentMessageId).toBe(toolCallMessage.id);
      expect(newAssistant.parentMessageId).toBe(newUser.id);
      expect(forkedToolCalls[0]?.messageId).toBe(toolCallMessage.id);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
