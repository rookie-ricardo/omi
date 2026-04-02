import { describe, expect, it } from "vitest";

describe("rpc-types", () => {
  describe("RpcCommand type structure", () => {
    it("validates prompt command structure", () => {
      const cmd = { type: "prompt", message: "hello", id: "123" };
      expect(cmd).toHaveProperty("type", "prompt");
      expect(cmd).toHaveProperty("message", "hello");
      expect(cmd).toHaveProperty("id", "123");
    });

    it("validates steer command structure", () => {
      const cmd = { type: "steer", message: "continue", id: "456" };
      expect(cmd).toHaveProperty("type", "steer");
      expect(cmd).toHaveProperty("message", "continue");
    });

    it("validates abort command structure", () => {
      const cmd = { type: "abort", id: "789" };
      expect(cmd).toHaveProperty("type", "abort");
    });

    it("validates new_session command structure", () => {
      const cmd = { type: "new_session", parentSession: "parent123", id: "001" };
      expect(cmd).toHaveProperty("type", "new_session");
      expect(cmd).toHaveProperty("parentSession", "parent123");
    });

    it("validates get_state command structure", () => {
      const cmd = { type: "get_state", id: "state1" };
      expect(cmd).toHaveProperty("type", "get_state");
    });

    it("validates set_model command structure", () => {
      const cmd = { type: "set_model", modelId: "gpt-4", id: "model1" };
      expect(cmd).toHaveProperty("type", "set_model");
      expect(cmd).toHaveProperty("modelId", "gpt-4");
    });

    it("validates cycle_model command structure", () => {
      const cmd = { type: "cycle_model", id: "cycle1" };
      expect(cmd).toHaveProperty("type", "cycle_model");
    });

    it("validates get_available_models command structure", () => {
      const cmd = { type: "get_available_models", id: "list1" };
      expect(cmd).toHaveProperty("type", "get_available_models");
    });

    it("validates bash command structure", () => {
      const cmd = { type: "bash", command: "ls -la", id: "bash1" };
      expect(cmd).toHaveProperty("type", "bash");
      expect(cmd).toHaveProperty("command", "ls -la");
    });

    it("validates abort_bash command structure", () => {
      const cmd = { type: "abort_bash", id: "abort1" };
      expect(cmd).toHaveProperty("type", "abort_bash");
    });

    it("validates get_session_stats command structure", () => {
      const cmd = { type: "get_session_stats", id: "stats1" };
      expect(cmd).toHaveProperty("type", "get_session_stats");
    });

    it("validates switch_session command structure", () => {
      const cmd = { type: "switch_session", sessionPath: "/path/to/session", id: "switch1" };
      expect(cmd).toHaveProperty("type", "switch_session");
      expect(cmd).toHaveProperty("sessionPath", "/path/to/session");
    });

    it("validates fork command structure", () => {
      const cmd = { type: "fork", historyEntryId: "entry123", id: "fork1" };
      expect(cmd).toHaveProperty("type", "fork");
      expect(cmd).toHaveProperty("historyEntryId", "entry123");
    });

    it("validates get_fork_messages command structure", () => {
      const cmd = { type: "get_fork_messages", id: "fork_msgs1" };
      expect(cmd).toHaveProperty("type", "get_fork_messages");
    });
  });

  describe("RpcResponse type structure", () => {
    it("validates success response structure", () => {
      const response = { type: "response", command: "prompt", success: true, id: "123" };
      expect(response).toHaveProperty("type", "response");
      expect(response).toHaveProperty("command", "prompt");
      expect(response).toHaveProperty("success", true);
    });

    it("validates error response structure", () => {
      const response = { type: "response", command: "prompt", success: false, error: "failed", id: "123" };
      expect(response).toHaveProperty("success", false);
      expect(response).toHaveProperty("error", "failed");
    });

    it("validates response with data", () => {
      const response = {
        type: "response",
        command: "get_state",
        success: true,
        data: { sessionId: "s1", messageCount: 5 },
        id: "123"
      };
      expect(response).toHaveProperty("data");
      expect(response.data).toEqual({ sessionId: "s1", messageCount: 5 });
    });
  });

  describe("RpcSessionState type structure", () => {
    it("validates session state structure", () => {
      const state = {
        sessionId: "session123",
        isStreaming: false,
        isCompacting: true,
        sessionFile: "/path/to/session.json",
        messageCount: 42,
        pendingMessageCount: 3,
      };
      expect(state).toHaveProperty("sessionId", "session123");
      expect(state).toHaveProperty("isStreaming", false);
      expect(state).toHaveProperty("isCompacting", true);
      expect(state).toHaveProperty("sessionFile", "/path/to/session.json");
      expect(state).toHaveProperty("messageCount", 42);
      expect(state).toHaveProperty("pendingMessageCount", 3);
    });
  });

  describe("RpcExtensionUIRequest type structure", () => {
    it("validates select request structure", () => {
      const req = { type: "extension_ui_request", id: "sel1", method: "select", title: "Choose", options: ["a", "b"] };
      expect(req).toHaveProperty("method", "select");
      expect(req).toHaveProperty("options", ["a", "b"]);
    });

    it("validates confirm request structure", () => {
      const req = { type: "extension_ui_request", id: "conf1", method: "confirm", title: "Confirm", message: "Are you sure?" };
      expect(req).toHaveProperty("method", "confirm");
      expect(req).toHaveProperty("message", "Are you sure?");
    });

    it("validates input request structure", () => {
      const req = { type: "extension_ui_request", id: "inp1", method: "input", title: "Input", placeholder: "Type here" };
      expect(req).toHaveProperty("method", "input");
      expect(req).toHaveProperty("placeholder", "Type here");
    });

    it("validates notify request structure", () => {
      const req = { type: "extension_ui_request", id: "not1", method: "notify", message: "Done", notifyType: "info" };
      expect(req).toHaveProperty("method", "notify");
      expect(req).toHaveProperty("notifyType", "info");
    });
  });

  describe("RpcExtensionUIResponse type structure", () => {
    it("validates value response structure", () => {
      const resp = { type: "extension_ui_response", id: "resp1", value: "selected" };
      expect(resp).toHaveProperty("value", "selected");
    });

    it("validates confirmed response structure", () => {
      const resp = { type: "extension_ui_response", id: "resp2", confirmed: true };
      expect(resp).toHaveProperty("confirmed", true);
    });

    it("validates cancelled response structure", () => {
      const resp = { type: "extension_ui_response", id: "resp3", cancelled: true };
      expect(resp).toHaveProperty("cancelled", true);
    });
  });
});
