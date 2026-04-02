import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  McpRegistry,
  createRegistryFromStorage,
} from "../src/mcp-registry";

describe("mcp-registry", () => {
  describe("McpRegistry constructor", () => {
    it("creates registry with default options", () => {
      const registry = new McpRegistry();
      expect(registry).toBeDefined();
    });

    it("creates registry with custom options", () => {
      const registry = new McpRegistry({
        defaultTimeoutMs: 60000,
        autoReconnect: false,
        reconnectDelayMs: 10000,
        onStateChange: vi.fn(),
        onError: vi.fn(),
      });
      expect(registry).toBeDefined();
    });
  });

  describe("McpRegistry register", () => {
    it("throws when registering duplicate server id", () => {
      const registry = new McpRegistry();
      const config = {
        id: "server1",
        name: "Server 1",
        transport: "stdio" as const,
        command: "echo",
      };
      registry.register(config);
      expect(() => registry.register(config)).toThrow(
        "already registered"
      );
    });

    it("registers server successfully", () => {
      const registry = new McpRegistry();
      registry.register({
        id: "server1",
        name: "Server 1",
        transport: "stdio",
        command: "echo",
      });
      expect(registry.hasServer("server1")).toBe(true);
    });
  });

  describe("McpRegistry unregister", () => {
    it("removes registered server", async () => {
      const registry = new McpRegistry();
      registry.register({
        id: "server1",
        name: "Server 1",
        transport: "stdio",
        command: "echo",
      });
      await registry.unregister("server1");
      expect(registry.hasServer("server1")).toBe(false);
    });

    it("does not throw for non-existent server", async () => {
      const registry = new McpRegistry();
      await expect(registry.unregister("nonexistent")).resolves.not.toThrow();
    });
  });

  describe("McpRegistry getServer", () => {
    it("returns server entry for registered server", () => {
      const registry = new McpRegistry();
      registry.register({
        id: "server1",
        name: "Server 1",
        transport: "stdio",
        command: "echo",
      });
      const server = registry.getServer("server1");
      expect(server).toBeDefined();
      expect(server?.config.id).toBe("server1");
    });

    it("returns undefined for non-existent server", () => {
      const registry = new McpRegistry();
      expect(registry.getServer("nonexistent")).toBeUndefined();
    });
  });

  describe("McpRegistry getAllServers", () => {
    it("returns empty map for new registry", () => {
      const registry = new McpRegistry();
      const servers = registry.getAllServers();
      expect(servers.size).toBe(0);
    });

    it("returns all registered servers", () => {
      const registry = new McpRegistry();
      registry.register({
        id: "server1",
        name: "Server 1",
        transport: "stdio",
        command: "echo",
      });
      registry.register({
        id: "server2",
        name: "Server 2",
        transport: "stdio",
        command: "cat",
      });
      const servers = registry.getAllServers();
      expect(servers.size).toBe(2);
    });
  });

  describe("McpRegistry hasServer", () => {
    it("returns false for non-existent server", () => {
      const registry = new McpRegistry();
      expect(registry.hasServer("nonexistent")).toBe(false);
    });

    it("returns true for registered server", () => {
      const registry = new McpRegistry();
      registry.register({
        id: "server1",
        name: "Server 1",
        transport: "stdio",
        command: "echo",
      });
      expect(registry.hasServer("server1")).toBe(true);
    });
  });

  describe("McpRegistry connect", () => {
    it("throws for non-existent server", async () => {
      const registry = new McpRegistry();
      await expect(registry.connect("nonexistent")).rejects.toThrow(
        "not registered"
      );
    });
  });

  describe("McpRegistry disconnect", () => {
    it("does not throw for non-existent server", async () => {
      const registry = new McpRegistry();
      await expect(registry.disconnect("nonexistent")).resolves.not.toThrow();
    });
  });

  describe("McpRegistry reconnect", () => {
    it("throws for non-existent server", async () => {
      const registry = new McpRegistry();
      await expect(registry.reconnect("nonexistent")).rejects.toThrow(
        "not registered"
      );
    });
  });

  describe("McpRegistry getTools", () => {
    it("returns empty array for disconnected server", () => {
      const registry = new McpRegistry();
      registry.register({
        id: "server1",
        name: "Server 1",
        transport: "stdio",
        command: "echo",
      });
      expect(registry.getTools("server1")).toEqual([]);
    });

    it("returns empty array for non-existent server", () => {
      const registry = new McpRegistry();
      expect(registry.getTools("nonexistent")).toEqual([]);
    });
  });

  describe("McpRegistry getAllTools", () => {
    it("returns empty array for new registry", () => {
      const registry = new McpRegistry();
      expect(registry.getAllTools()).toEqual([]);
    });
  });

  describe("McpRegistry getResources", () => {
    it("returns empty array for disconnected server", () => {
      const registry = new McpRegistry();
      registry.register({
        id: "server1",
        name: "Server 1",
        transport: "stdio",
        command: "echo",
      });
      expect(registry.getResources("server1")).toEqual([]);
    });
  });

  describe("McpRegistry getAllResources", () => {
    it("returns empty array for new registry", () => {
      const registry = new McpRegistry();
      expect(registry.getAllResources()).toEqual([]);
    });
  });

  describe("McpRegistry callTool", () => {
    it("throws for non-existent server", async () => {
      const registry = new McpRegistry();
      await expect(
        registry.callTool("nonexistent", "tool1", {})
      ).rejects.toThrow("not registered");
    });
  });

  describe("McpRegistry readResource", () => {
    it("throws for non-existent server", async () => {
      const registry = new McpRegistry();
      await expect(
        registry.readResource("nonexistent", "file:///test")
      ).rejects.toThrow("not registered");
    });
  });

  describe("McpRegistry readResourceByUri", () => {
    it("throws when resource not found", async () => {
      const registry = new McpRegistry();
      await expect(
        registry.readResourceByUri("file:///test")
      ).rejects.toThrow("Resource not found");
    });
  });

  describe("McpRegistry getAggregatedCatalog", () => {
    it("returns empty catalog for new registry", () => {
      const registry = new McpRegistry();
      const catalog = registry.getAggregatedCatalog();
      expect(catalog.tools).toEqual([]);
      expect(catalog.resources).toEqual([]);
    });
  });

  describe("McpRegistry findTool", () => {
    it("returns null for non-existent tool", () => {
      const registry = new McpRegistry();
      expect(registry.findTool("nonexistent")).toBeNull();
    });
  });

  describe("McpRegistry findResource", () => {
    it("returns null for non-existent resource", () => {
      const registry = new McpRegistry();
      expect(registry.findResource("file:///test")).toBeNull();
    });
  });

  describe("McpRegistry getState", () => {
    it("returns null for non-existent server", () => {
      const registry = new McpRegistry();
      expect(registry.getState("nonexistent")).toBeNull();
    });

    it("returns disconnected for registered server", () => {
      const registry = new McpRegistry();
      registry.register({
        id: "server1",
        name: "Server 1",
        transport: "stdio",
        command: "echo",
      });
      expect(registry.getState("server1")).toBe("disconnected");
    });
  });

  describe("McpRegistry getAllStates", () => {
    it("returns empty map for new registry", () => {
      const registry = new McpRegistry();
      const states = registry.getAllStates();
      expect(states.size).toBe(0);
    });

    it("returns states for all servers", () => {
      const registry = new McpRegistry();
      registry.register({
        id: "server1",
        name: "Server 1",
        transport: "stdio",
        command: "echo",
      });
      const states = registry.getAllStates();
      expect(states.size).toBe(1);
      expect(states.get("server1")).toBe("disconnected");
    });
  });

  describe("McpRegistry isAnyConnected", () => {
    it("returns false for new registry", () => {
      const registry = new McpRegistry();
      expect(registry.isAnyConnected()).toBe(false);
    });

    it("returns false when all servers are disconnected", () => {
      const registry = new McpRegistry();
      registry.register({
        id: "server1",
        name: "Server 1",
        transport: "stdio",
        command: "echo",
      });
      expect(registry.isAnyConnected()).toBe(false);
    });
  });

  describe("McpRegistry isAllConnected", () => {
    it("returns false for new registry", () => {
      const registry = new McpRegistry();
      expect(registry.isAllConnected()).toBe(false);
    });

    it("returns false when no servers registered", () => {
      const registry = new McpRegistry();
      expect(registry.isAllConnected()).toBe(false);
    });
  });

  describe("McpRegistry dispose", () => {
    it("cleans up all servers", async () => {
      const registry = new McpRegistry();
      registry.register({
        id: "server1",
        name: "Server 1",
        transport: "stdio",
        command: "echo",
      });
      await expect(registry.dispose()).resolves.not.toThrow();
    });
  });

  describe("createRegistryFromStorage", () => {
    it("creates registry from storage", async () => {
      const mockStorage = {
        loadAll: vi.fn().mockResolvedValue([
          {
            id: "server1",
            name: "Server 1",
            transport: "stdio" as const,
            command: "echo",
          },
        ]),
        save: vi.fn(),
        delete: vi.fn(),
      };

      const registry = await createRegistryFromStorage(mockStorage);
      expect(registry.hasServer("server1")).toBe(true);
    });

    it("creates empty registry when storage is empty", async () => {
      const mockStorage = {
        loadAll: vi.fn().mockResolvedValue([]),
        save: vi.fn(),
        delete: vi.fn(),
      };

      const registry = await createRegistryFromStorage(mockStorage);
      expect(registry.getAllServers().size).toBe(0);
    });
  });
});
