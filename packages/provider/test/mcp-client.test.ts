import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import {
  createMcpClient,
  McpClientImpl,
} from "../src/mcp-client";

describe("mcp-client", () => {
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
      it("calls disconnect", () => {
        const client = new McpClientImpl({
          server: {
            id: "test-server",
            name: "Test Server",
            transport: "stdio",
            command: "echo",
          },
        });
        expect(() => client.dispose()).not.toThrow();
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
