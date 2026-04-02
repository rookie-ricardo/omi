/**
 * MCP Client - Model Context Protocol Client Implementation
 *
 * Provides a unified interface for connecting to MCP servers via different transports.
 * Implements the connection state machine: connecting/connected/degraded/disconnected/needs_auth
 */

// ============================================================================
// Types
// ============================================================================

/**
 * MCP connection state machine states.
 */
export type McpConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "degraded"
  | "needs_auth";

/**
 * MCP server configuration.
 */
export interface McpServerConfig {
  /** Unique identifier for this server */
  id: string;
  /** Display name */
  name: string;
  /** Transport type */
  transport: "stdio" | "http" | "sse" | "websocket";
  /** Command for stdio transport (e.g., "npx", "/path/to/server") */
  command?: string;
  /** Arguments for stdio transport */
  args?: string[];
  /** URL for http/sse/websocket transports */
  url?: string;
  /** Environment variables for stdio transport */
  env?: Record<string, string>;
  /** Request headers for http/sse/websocket transports */
  headers?: Record<string, string>;
  /** Whether to enable automatic reconnection */
  autoReconnect?: boolean;
  /** Reconnection delay in milliseconds */
  reconnectDelayMs?: number;
  /** Timeout for requests in milliseconds */
  timeoutMs?: number;
}

/**
 * MCP tool definition.
 */
export interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

/**
 * MCP resource definition.
 */
export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

/**
 * MCP resource content.
 */
export interface McpResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string; // base64 encoded
}

/**
 * MCP tool call result.
 */
export interface McpToolResult {
  content: McpResourceContent[];
  isError?: boolean;
}

/**
 * MCP server info.
 */
export interface McpServerInfo {
  id: string;
  name: string;
  version?: string;
  protocolVersion?: string;
}

/**
 * MCP client options.
 */
export interface McpClientOptions {
  /** Server configuration */
  server: McpServerConfig;
  /** On state change callback */
  onStateChange?: (state: McpConnectionState, prevState: McpConnectionState) => void;
  /** On error callback */
  onError?: (error: Error, serverId: string) => void;
  /** On tools changed callback */
  onToolsChanged?: (tools: McpTool[], serverId: string) => void;
  /** On resources changed callback */
  onResourcesChanged?: (resources: McpResource[], serverId: string) => void;
}

// ============================================================================
// MCP Client Interface
// ============================================================================

/**
 * MCP Client interface for interacting with MCP servers.
 */
export interface McpClient {
  /** Get current connection state */
  getState(): McpConnectionState;
  /** Get server info */
  getServerInfo(): McpServerInfo | null;
  /** Get available tools */
  getTools(): McpTool[];
  /** Get available resources */
  getResources(): McpResource[];
  /** Connect to the server */
  connect(): Promise<void>;
  /** Disconnect from the server */
  disconnect(): Promise<void>;
  /** Call a tool */
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult>;
  /** Read a resource */
  readResource(uri: string): Promise<McpResourceContent>;
  /** List resources with optional filter */
  listResources(uriPattern?: string): Promise<McpResource[]>;
  /** Dispose of the client */
  dispose(): void;
}

// ============================================================================
// MCP Client Events
// ============================================================================

export interface McpClientConnectedEvent {
  type: "mcp.connected";
  serverId: string;
  serverInfo: McpServerInfo;
}

export interface McpClientDisconnectedEvent {
  type: "mcp.disconnected";
  serverId: string;
  reason?: string;
}

export interface McpClientErrorEvent {
  type: "mcp.error";
  serverId: string;
  error: string;
}

export interface McpClientToolsChangedEvent {
  type: "mcp.tools_changed";
  serverId: string;
  tools: McpTool[];
}

export interface McpClientResourcesChangedEvent {
  type: "mcp.resources_changed";
  serverId: string;
  resources: McpResource[];
}

export type McpClientEvent =
  | McpClientConnectedEvent
  | McpClientDisconnectedEvent
  | McpClientErrorEvent
  | McpClientToolsChangedEvent
  | McpClientResourcesChangedEvent;

// ============================================================================
// MCP Client Implementation
// ============================================================================

/**
 * MCP Client implementation using the JSON-RPC protocol over stdio.
 *
 * This is a simplified implementation that wraps the MCP protocol.
 * For production use, consider using @modelcontextprotocol/sdk.
 */
export class StdioMcpClient implements McpClient {
  private state: McpConnectionState = "disconnected";
  private serverInfo: McpServerInfo | null = null;
  private tools: McpTool[] = [];
  private resources: McpResource[] = [];
  private process: ReturnType<typeof import("child_process").spawn> | null = null;
  private requestId = 0;
  private pendingRequests = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();
  private readonly config: McpServerConfig;
  private readonly onStateChange?: (state: McpConnectionState, prevState: McpConnectionState) => void;
  private readonly onError?: (error: Error, serverId: string) => void;
  private readonly onToolsChanged?: (tools: McpTool[], serverId: string) => void;
  private readonly onResourcesChanged?: (resources: McpResource[], serverId: string) => void;

  constructor(options: McpClientOptions) {
    this.config = options.server;
    this.onStateChange = options.onStateChange;
    this.onError = options.onError;
    this.onToolsChanged = options.onToolsChanged;
    this.onResourcesChanged = options.onResourcesChanged;
  }

  getState(): McpConnectionState {
    return this.state;
  }

  getServerInfo(): McpServerInfo | null {
    return this.serverInfo;
  }

  getTools(): McpTool[] {
    return [...this.tools];
  }

  getResources(): McpResource[] {
    return [...this.resources];
  }

  async connect(): Promise<void> {
    if (this.state === "connected" || this.state === "connecting") {
      return;
    }

    const prevState = this.state;
    this.setState("connecting");

    try {
      // Dynamic import to avoid requiring child_process on non-node platforms
      const { spawn } = await import("child_process");

      if (!this.config.command) {
        throw new Error(`MCP server ${this.config.id}: command is required for stdio transport`);
      }

      this.process = spawn(this.config.command, this.config.args ?? [], {
        env: { ...process.env, ...this.config.env },
        stdio: ["pipe", "pipe", "pipe"],
      });

      let buffer = "";

      this.process.stdout?.on("data", (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.trim()) {
            this.handleMessage(line);
          }
        }
      });

      this.process.stderr?.on("data", (data: Buffer) => {
        console.error(`[MCP ${this.config.id}] stderr:`, data.toString());
      });

      this.process.on("error", (error) => {
        this.handleError(error as Error);
      });

      this.process.on("exit", (code) => {
        if (code !== 0) {
          this.handleError(new Error(`MCP server ${this.config.id} exited with code ${code}`));
        }
        this.setState("disconnected");
      });

      // Send initialize request
      const result = await this.sendRequest<{
        serverInfo?: { name?: string; version?: string };
        protocolVersion?: string;
        capabilities?: { tools?: unknown; resources?: unknown };
      }>("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {},
          resources: {},
        },
        clientInfo: {
          name: "omi-provider",
          version: "0.1.0",
        },
      });

      this.serverInfo = {
        id: this.config.id,
        name: result.serverInfo?.name ?? this.config.name,
        version: result.serverInfo?.version,
        protocolVersion: result.protocolVersion,
      };

      // Update capabilities based on server response
      if (!result.capabilities?.tools) {
        this.tools = [];
      }
      if (!result.capabilities?.resources) {
        this.resources = [];
      }

      // Send initialized notification
      await this.sendNotification("initialized", {});

      // Fetch tools and resources
      await this.refreshTools();
      await this.refreshResources();

      this.setState("connected");
    } catch (error) {
      this.setState("disconnected");
      this.handleError(error as Error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.setState("disconnected");
    this.clearPendingRequests();
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    if (this.state !== "connected") {
      throw new Error(`MCP server ${this.config.id}: not connected`);
    }

    const result = await this.sendRequest<{ content?: McpResourceContent[]; isError?: boolean }>("tools/call", {
      name,
      arguments: args,
    });

    return {
      content: result.content ?? [],
      isError: result.isError,
    };
  }

  async readResource(uri: string): Promise<McpResourceContent> {
    if (this.state !== "connected") {
      throw new Error(`MCP server ${this.config.id}: not connected`);
    }

    const result = await this.sendRequest<{ contents?: McpResourceContent[] }>("resources/read", { uri });

    if (!result.contents || result.contents.length === 0) {
      throw new Error(`MCP server ${this.config.id}: resource not found: ${uri}`);
    }

    return result.contents[0];
  }

  async listResources(uriPattern?: string): Promise<McpResource[]> {
    if (this.state !== "connected") {
      throw new Error(`MCP server ${this.config.id}: not connected`);
    }

    const result = await this.sendRequest<{ resources?: McpResource[] }>("resources/list", {
      ...(uriPattern ? { pattern: uriPattern } : {}),
    });

    return result.resources ?? [];
  }

  dispose(): void {
    this.disconnect();
    this.clearPendingRequests();
  }

  // --------------------------------------------------------------------------
  // Private Methods
  // --------------------------------------------------------------------------

  private setState(newState: McpConnectionState): void {
    if (this.state === newState) return;

    const prevState = this.state;
    this.state = newState;
    this.onStateChange?.(newState, prevState);
  }

  private handleError(error: Error): void {
    console.error(`[MCP ${this.config.id}] Error:`, error.message);
    this.onError?.(error, this.config.id);
  }

  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);

      // Handle response
      if (message.id) {
        const pending = this.pendingRequests.get(message.id);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(message.id);

          if (message.error) {
            pending.reject(new Error(message.error.message ?? "Unknown error"));
          } else {
            pending.resolve(message.result ?? {});
          }
        }
        return;
      }

      // Handle notification
      if (message.method) {
        this.handleNotification(message);
      }
    } catch {
      console.error(`[MCP ${this.config.id}] Failed to parse message:`, data);
    }
  }

  private handleNotification(message: { method: string; params?: unknown }): void {
    switch (message.method) {
      case "tools/list_changed":
        this.refreshTools();
        break;
      case "resources/list_changed":
        this.refreshResources();
        break;
      default:
        console.debug(`[MCP ${this.config.id}] Unhandled notification:`, message.method);
    }
  }

  private async sendRequest<T = unknown>(method: string, params: unknown): Promise<T> {
    const id = String(++this.requestId);
    const timeout = this.config.timeoutMs ?? 30000;

    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`MCP request ${method} timed out after ${timeout}ms`));
      }, timeout);

      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout: timeoutHandle,
      });

      const request = JSON.stringify({ jsonrpc: "2.0", id, method, params });
      this.process?.stdin?.write(request + "\n");
    });
  }

  private async sendNotification(method: string, params: unknown): Promise<void> {
    const notification = JSON.stringify({ jsonrpc: "2.0", method, params });
    this.process?.stdin?.write(notification + "\n");
  }

  private async refreshTools(): Promise<void> {
    if (this.state !== "connected") return;

    try {
      const result = await this.sendRequest<{ tools: McpTool[] }>("tools/list", {});
      const prevTools = this.tools;
      this.tools = result.tools ?? [];

      if (JSON.stringify(prevTools) !== JSON.stringify(this.tools)) {
        this.onToolsChanged?.(this.tools, this.config.id);
      }
    } catch (error) {
      console.error(`[MCP ${this.config.id}] Failed to refresh tools:`, error);
    }
  }

  private async refreshResources(): Promise<void> {
    if (this.state !== "connected") return;

    try {
      const result = await this.sendRequest<{ resources: McpResource[] }>("resources/list", {});
      const prevResources = this.resources;
      this.resources = result.resources ?? [];

      if (JSON.stringify(prevResources) !== JSON.stringify(this.resources)) {
        this.onResourcesChanged?.(this.resources, this.config.id);
      }
    } catch (error) {
      console.error(`[MCP ${this.config.id}] Failed to refresh resources:`, error);
    }
  }

  private clearPendingRequests(): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("MCP client disposed"));
    }
    this.pendingRequests.clear();
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create an MCP client for stdio transport.
 */
export function createStdioMcpClient(options: McpClientOptions): McpClient {
  if (options.server.transport !== "stdio") {
    throw new Error(`Expected stdio transport, got ${options.server.transport}`);
  }
  return new StdioMcpClient(options);
}

/**
 * Create an MCP client based on server configuration.
 */
export function createMcpClient(options: McpClientOptions): McpClient {
  switch (options.server.transport) {
    case "stdio":
      return createStdioMcpClient(options);
    default:
      throw new Error(`Unsupported transport: ${options.server.transport}`);
  }
}
