import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  McpCapabilities,
  McpClient,
  McpClientOptions,
  McpConnectionState,
  McpResource,
  McpResourceContent,
  McpServerInfo,
  McpTool,
  McpToolResult,
} from "../src/mcp-client";

const fakeClients = new Map<string, FakeMcpClient>();

interface FakeMcpClient extends McpClient {
  emitState(state: McpConnectionState): void;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}

function createFakeClient(options: McpClientOptions): FakeMcpClient {
  let state: McpConnectionState = "disconnected";

  const client: FakeMcpClient = {
    getState: () => state,
    getServerInfo: (): McpServerInfo | null => null,
    getCapabilities: (): McpCapabilities | null => null,
    getTools: (): McpTool[] => [],
    getResources: (): McpResource[] => [],
    connect: vi.fn(async () => {
      client.emitState("connected");
    }),
    disconnect: vi.fn(async () => {
      client.emitState("disconnected");
    }),
    callTool: vi.fn(async (): Promise<McpToolResult> => ({ content: [] })),
    readResource: vi.fn(async (): Promise<McpResourceContent> => ({ uri: "file:///mock" })),
    listResources: vi.fn(async (): Promise<McpResource[]> => []),
    dispose: vi.fn(async () => {
      await client.disconnect();
    }),
    emitState: (nextState: McpConnectionState) => {
      if (state === nextState) {
        return;
      }
      const prevState = state;
      state = nextState;
      options.onStateChange?.(nextState, prevState);
    },
  };

  return client;
}

vi.mock("../src/mcp-client", () => {
  return {
    createMcpClient: vi.fn((options: McpClientOptions) => {
      const client = createFakeClient(options);
      fakeClients.set(options.server.id, client);
      return client;
    }),
  };
});

import { McpRegistry } from "../src/mcp-registry";

function getFakeClient(serverId: string): FakeMcpClient {
  const client = fakeClients.get(serverId);
  if (!client) {
    throw new Error(`Missing fake MCP client for ${serverId}`);
  }
  return client;
}

describe("mcp-registry reconnect control plane", () => {
  beforeEach(() => {
    fakeClients.clear();
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    fakeClients.clear();
  });

  it("reconnects with exponential backoff when attempts fail", async () => {
    const registry = new McpRegistry({
      autoReconnect: true,
      reconnectDelayMs: 1000,
    });

    registry.register({
      id: "server1",
      name: "Server 1",
      transport: "stdio",
      command: "echo",
    });

    const client = getFakeClient("server1");
    client.connect.mockImplementation(async () => {
      client.emitState("disconnected");
      throw new Error("temporary network failure");
    });

    client.emitState("degraded");

    await vi.advanceTimersByTimeAsync(999);
    expect(client.connect).toHaveBeenCalledTimes(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(client.connect).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1999);
    expect(client.connect).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(client.connect).toHaveBeenCalledTimes(2);
  });

  it("does not run overlapping reconnect attempts while one is in flight", async () => {
    const registry = new McpRegistry({
      autoReconnect: true,
      reconnectDelayMs: 1000,
    });

    registry.register({
      id: "server1",
      name: "Server 1",
      transport: "stdio",
      command: "echo",
    });

    const client = getFakeClient("server1");
    let resolveConnect: undefined | (() => void);

    client.connect.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveConnect = () => {
            client.emitState("connected");
            resolve();
          };
        })
    );

    client.emitState("degraded");

    await vi.advanceTimersByTimeAsync(1000);
    expect(client.connect).toHaveBeenCalledTimes(1);

    client.emitState("degraded");
    await vi.advanceTimersByTimeAsync(2000);
    expect(client.connect).toHaveBeenCalledTimes(1);

    if (resolveConnect) {
      resolveConnect();
    }
    await Promise.resolve();
  });

  it("does not auto-reconnect when server needs auth", async () => {
    const registry = new McpRegistry({
      autoReconnect: true,
      reconnectDelayMs: 1000,
    });

    registry.register({
      id: "server1",
      name: "Server 1",
      transport: "stdio",
      command: "echo",
    });

    const client = getFakeClient("server1");
    client.emitState("needs_auth");

    await vi.advanceTimersByTimeAsync(60000);
    expect(client.connect).toHaveBeenCalledTimes(0);
  });

  it("suppresses auto-reconnect after explicit disconnect", async () => {
    const registry = new McpRegistry({
      autoReconnect: true,
      reconnectDelayMs: 1000,
    });

    registry.register({
      id: "server1",
      name: "Server 1",
      transport: "stdio",
      command: "echo",
    });

    const client = getFakeClient("server1");

    await registry.disconnect("server1");
    await vi.advanceTimersByTimeAsync(60000);

    expect(client.connect).toHaveBeenCalledTimes(0);
  });
});
