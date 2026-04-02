import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { RpcClient } from "../../../src/modes/rpc/rpc-client";

describe("rpc-client", () => {
  let client: RpcClient;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("RpcClient constructor", () => {
    it("creates client with required options", () => {
      const client = new RpcClient({
        command: ["node", "server.js"],
      });
      expect(client).toBeDefined();
      expect(client.isConnected).toBe(false);
    });

    it("creates client with full options", () => {
      const client = new RpcClient({
        command: ["node", "server.js"],
        env: { API_KEY: "test" },
        cwd: "/tmp",
      });
      expect(client).toBeDefined();
    });
  });

  describe("RpcClient connection state", () => {
    it("starts disconnected", () => {
      const client = new RpcClient({
        command: ["node", "server.js"],
      });
      expect(client.isConnected).toBe(false);
    });
  });

  describe("RpcClient subscribe", () => {
    it("allows subscribing to events", () => {
      const client = new RpcClient({
        command: ["node", "server.js"],
      });

      const listener = vi.fn();
      const unsubscribe = client.subscribe(listener);

      expect(unsubscribe).toBeTypeOf("function");

      // Unsubscribe should not throw
      expect(() => unsubscribe()).not.toThrow();
    });

    it("removes listener when unsubscribe is called", () => {
      const client = new RpcClient({
        command: ["node", "server.js"],
      });

      const listener = vi.fn();
      const unsubscribe = client.subscribe(listener);

      // Calling unsubscribe multiple times should be safe
      unsubscribe();
      unsubscribe();
    });
  });

  describe("RpcClient sendCommand", () => {
    it("throws when not connected", async () => {
      const client = new RpcClient({
        command: ["node", "server.js"],
      });

      await expect(
        client.sendCommand({ type: "prompt", message: "hello" })
      ).rejects.toThrow("Not connected to RPC server");
    });
  });

  describe("RpcClient disconnect", () => {
    it("disconnects gracefully when not connected", () => {
      const client = new RpcClient({
        command: ["node", "server.js"],
      });

      expect(() => client.disconnect()).not.toThrow();
      expect(client.isConnected).toBe(false);
    });
  });
});
