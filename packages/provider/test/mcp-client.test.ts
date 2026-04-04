import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createMcpClient,
  McpClientImpl,
} from "../src/mcp-client";

describe("mcp-client", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("createMcpClient factory", () => {
    it("creates McpClient instance", () => {
      const client = createMcpClient({
        server: {
          id: "test-server",
          name: "Test Server",
          transport: "stdio",
          command: "echo",
        },
      });
      expect(client).toBeDefined();
    });
  });

  describe("McpClientImpl", () => {
    describe("constructor", () => {
      it("initializes with server config", () => {
        const client = new McpClientImpl({
          server: {
            id: "test-server",
            name: "Test Server",
            transport: "stdio",
            command: "echo",
          },
        });
        expect(client.getState()).toBe("disconnected");
      });

      it("initializes with custom client name and version", () => {
        const client = new McpClientImpl({
          server: {
            id: "test-server",
            name: "Test Server",
            transport: "stdio",
            command: "echo",
          },
          clientName: "custom-client",
          clientVersion: "1.0.0",
        });
        expect(client).toBeDefined();
      });

      it("initializes with callbacks", () => {
        const client = new McpClientImpl({
          server: {
            id: "test-server",
            name: "Test Server",
            transport: "stdio",
            command: "echo",
          },
          onStateChange: vi.fn(),
          onError: vi.fn(),
          onToolsChanged: vi.fn(),
          onResourcesChanged: vi.fn(),
        });
        expect(client).toBeDefined();
      });
    });

    describe("getState", () => {
      it("returns disconnected for new client", () => {
        const client = new McpClientImpl({
          server: {
            id: "test-server",
            name: "Test Server",
            transport: "stdio",
            command: "echo",
          },
        });
        expect(client.getState()).toBe("disconnected");
      });
    });

    describe("getServerInfo", () => {
      it("returns null for disconnected client", () => {
        const client = new McpClientImpl({
          server: {
            id: "test-server",
            name: "Test Server",
            transport: "stdio",
            command: "echo",
          },
        });
        expect(client.getServerInfo()).toBeNull();
      });
    });

    describe("getCapabilities", () => {
      it("returns null for disconnected client", () => {
        const client = new McpClientImpl({
          server: {
            id: "test-server",
            name: "Test Server",
            transport: "stdio",
            command: "echo",
          },
        });
        expect(client.getCapabilities()).toBeNull();
      });
    });

    describe("getTools", () => {
      it("returns empty array for disconnected client", () => {
        const client = new McpClientImpl({
          server: {
            id: "test-server",
            name: "Test Server",
            transport: "stdio",
            command: "echo",
          },
        });
        expect(client.getTools()).toEqual([]);
      });
    });

    describe("getResources", () => {
      it("returns empty array for disconnected client", () => {
        const client = new McpClientImpl({
          server: {
            id: "test-server",
            name: "Test Server",
            transport: "stdio",
            command: "echo",
          },
        });
        expect(client.getResources()).toEqual([]);
      });
    });

    describe("disconnect", () => {
      it("does not throw when not connected", async () => {
        const client = new McpClientImpl({
          server: {
            id: "test-server",
            name: "Test Server",
            transport: "stdio",
            command: "echo",
          },
        });
        await expect(client.disconnect()).resolves.not.toThrow();
        expect(client.getState()).toBe("disconnected");
      });
    });

    describe("dispose", () => {
      it("awaits disconnect", async () => {
        const client = new McpClientImpl({
          server: {
            id: "test-server",
            name: "Test Server",
            transport: "stdio",
            command: "echo",
          },
        });

        let disconnected = false;
        vi.spyOn(client, "disconnect").mockImplementation(async () => {
          await Promise.resolve();
          disconnected = true;
        });

        await expect(client.dispose()).resolves.not.toThrow();
        expect(disconnected).toBe(true);
      });
    });

    describe("state transitions", () => {
      it("transitions to needs_auth on auth errors", async () => {
        const client = new McpClientImpl({
          server: {
            id: "test-server",
            name: "Test Server",
            transport: "stdio",
            command: "echo",
          },
        });

        (client as unknown as { state: string }).state = "connected";
        (client as unknown as { client: { request: ReturnType<typeof vi.fn> } }).client = {
          request: vi.fn().mockRejectedValue(new Error("401 Unauthorized")),
        };

        await expect(client.callTool("tool1", {})).rejects.toThrow("Unauthorized");
        expect(client.getState()).toBe("needs_auth");
      });

      it("transitions to degraded when connection is closed", async () => {
        const client = new McpClientImpl({
          server: {
            id: "test-server",
            name: "Test Server",
            transport: "stdio",
            command: "echo",
          },
        });

        (client as unknown as { state: string }).state = "connected";
        (client as unknown as { client: { request: ReturnType<typeof vi.fn> } }).client = {
          request: vi.fn().mockRejectedValue({
            code: ErrorCode.ConnectionClosed,
            message: "Connection closed",
          }),
        };

        await expect(client.callTool("tool1", {})).rejects.toThrow("connection closed");
        expect(client.getState()).toBe("degraded");
      });
    });

    describe("transport support", () => {
      it("rejects unsupported transports at connect time", async () => {
        const client = new McpClientImpl({
          server: {
            id: "test-server",
            name: "Test Server",
            transport: "websocket",
            url: "ws://localhost:3000",
          } as any,
        });

        await expect(client.connect()).rejects.toThrow("Unsupported transport type");
      });
    });

    describe("callTool", () => {
      it("throws when not connected", async () => {
        const client = new McpClientImpl({
          server: {
            id: "test-server",
            name: "Test Server",
            transport: "stdio",
            command: "echo",
          },
        });
        await expect(client.callTool("tool1", {})).rejects.toThrow(
          "not connected"
        );
      });
    });

    describe("readResource", () => {
      it("throws when not connected", async () => {
        const client = new McpClientImpl({
          server: {
            id: "test-server",
            name: "Test Server",
            transport: "stdio",
            command: "echo",
          },
        });
        await expect(client.readResource("file:///test")).rejects.toThrow(
          "not connected"
        );
      });
    });

    describe("listResources", () => {
      it("throws when not connected", async () => {
        const client = new McpClientImpl({
          server: {
            id: "test-server",
            name: "Test Server",
            transport: "stdio",
            command: "echo",
          },
        });
        await expect(client.listResources()).rejects.toThrow("not connected");
      });
    });
  });
});
