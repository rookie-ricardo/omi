/**
 * MCP Client - Model Context Protocol Client Implementation
 *
 * Provides a unified interface for connecting to MCP servers via different transports.
 * Implements the connection state machine: connecting/connected/degraded/disconnected/needs_auth
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  SSEClientTransport,
  type SSEClientTransportOptions,
} from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  StreamableHTTPClientTransport,
  type StreamableHTTPClientTransportOptions,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  ListResourcesResultSchema,
  ListToolsResultSchema,
  type ListToolsResult,
  type ListResourcesResult,
  type ListPromptsResult,
  ListPromptsResultSchema,
  ResourceListChangedNotificationSchema,
  ToolListChangedNotificationSchema,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";

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

export const SUPPORTED_MCP_TRANSPORTS = ["stdio", "http", "sse"] as const;
export type McpTransport = (typeof SUPPORTED_MCP_TRANSPORTS)[number];

/**
 * MCP server configuration.
 */
export interface McpServerConfig {
  /** Unique identifier for this server */
  id: string;
  /** Display name */
  name: string;
  /** Transport type */
  transport: McpTransport;
  /** Command for stdio transport (e.g., "npx", "/path/to/server") */
  command?: string;
  /** Arguments for stdio transport */
  args?: string[];
  /** URL for http/sse transports */
  url?: string;
  /** Environment variables for stdio transport */
  env?: Record<string, string>;
  /** Request headers for http/sse transports */
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
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    openWorldHint?: boolean;
  };
}

/**
 * MCP resource definition.
 */
export interface McpResource {
  uri: string;
  name?: string;
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
  _meta?: Record<string, unknown>;
  structuredContent?: unknown;
}

/**
 * MCP server capabilities.
 */
export interface McpCapabilities {
  tools?: Record<string, unknown>;
  resources?: {
    subscribe?: boolean;
    listChanged?: boolean;
  };
  prompts?: Record<string, unknown>;
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
  /** Client display name for MCP protocol */
  clientName?: string;
  /** Client version for MCP protocol */
  clientVersion?: string;
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
  /** Get server capabilities */
  getCapabilities(): McpCapabilities | null;
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
  dispose(): Promise<void>;
}

// ============================================================================
// MCP Client Implementation
// ============================================================================

/**
 * MCP Client implementation supporting multiple transports.
 *
 * Supports:
 * - stdio: Local subprocess communication
 * - http: Streamable HTTP transport
 * - sse: Server-Sent Events transport
 */
export class McpClientImpl implements McpClient {
  private state: McpConnectionState = "disconnected";
  private client: Client | null = null;
  private transport: Transport | null = null;
  private serverInfo: McpServerInfo | null = null;
  private capabilities: McpCapabilities | null = null;
  private tools: McpTool[] = [];
  private resources: McpResource[] = [];
  private instructions: string | null = null;

  private readonly config: McpServerConfig;
  private readonly clientName: string;
  private readonly clientVersion: string;
  private readonly onStateChange?: (state: McpConnectionState, prevState: McpConnectionState) => void;
  private readonly onError?: (error: Error, serverId: string) => void;
  private readonly onToolsChanged?: (tools: McpTool[], serverId: string) => void;
  private readonly onResourcesChanged?: (resources: McpResource[], serverId: string) => void;
  private disconnectPromise: Promise<void> | null = null;

  constructor(options: McpClientOptions) {
    this.config = options.server;
    this.clientName = options.clientName ?? "omi-provider";
    this.clientVersion = options.clientVersion ?? "0.1.0";
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

  getCapabilities(): McpCapabilities | null {
    return this.capabilities;
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

    this.setState("connecting");

    try {
      // Create transport based on type
      this.transport = await this.createTransport();

      // Create MCP client
      this.client = new Client(
        {
          name: this.clientName,
          version: this.clientVersion,
        },
        {
          capabilities: {
            // Enable roots capability
            roots: {
              listChanged: true,
            },
          },
        }
      );

      // Set up roots handler
      this.client.setRequestHandler(
        // @ts-expect-error - ListRootsRequestSchema type mismatch
        { method: "roots/list" },
        async () => {
          return { roots: [] };
        }
      );

      // Set up notification handlers
      this.client.onerror = (error: Error) => {
        this.handleError(error);
      };

      // Connect with timeout
      const timeoutMs = this.config.timeoutMs ?? 30000;
      await Promise.race([
        this.client.connect(this.transport),
        new Promise<void>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Connection timed out after ${timeoutMs}ms`)),
            timeoutMs
          )
        ),
      ]);

      // Get server capabilities and info
      this.capabilities = this.client.getServerCapabilities() ?? {};
      this.serverInfo = {
        id: this.config.id,
        name: this.config.name,
        version: this.client.getServerVersion()?.version,
      };

      // Set up notification handlers for list changes
      this.setupNotificationHandlers();

      this.setState("connected");

      // Fetch initial tools and resources
      await this.refreshTools();
      await this.refreshResources();
    } catch (error) {
      await this.closeClientAndTransport();
      this.applyErrorState(error, "disconnected");
      this.handleError(this.normalizeError(error));
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.disconnectPromise) {
      return this.disconnectPromise;
    }

    this.disconnectPromise = (async () => {
      await this.closeClientAndTransport();
      this.capabilities = null;
      this.serverInfo = null;
      this.instructions = null;
      this.tools = [];
      this.resources = [];
      this.setState("disconnected");
    })();

    try {
      await this.disconnectPromise;
    } finally {
      this.disconnectPromise = null;
    }
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    if (this.state !== "connected" || !this.client) {
      throw new Error(`MCP server ${this.config.id}: not connected`);
    }

    try {
      const result = await this.client.request(
        {
          method: "tools/call",
          params: {
            name,
            arguments: args,
          },
        },
        // @ts-expect-error - CallToolResult schema type
        { method: "tools/call" }
      );

      return {
        content: result.content ?? [],
        isError: result.isError,
        _meta: result._meta,
      };
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: unknown }).code === ErrorCode.ConnectionClosed
      ) {
        this.setState("degraded");
        this.handleError(this.normalizeError(error));
        throw new Error(`MCP server ${this.config.id}: connection closed`);
      }
      this.applyErrorState(error);
      this.handleError(this.normalizeError(error));
      throw error;
    }
  }

  async readResource(uri: string): Promise<McpResourceContent> {
    if (this.state !== "connected" || !this.client) {
      throw new Error(`MCP server ${this.config.id}: not connected`);
    }

    try {
      const result = await this.client.request(
        {
          method: "resources/read",
          params: { uri },
        },
        // @ts-expect-error - ReadResourceResult schema type
        { method: "resources/read" }
      );

      if (!result.contents || result.contents.length === 0) {
        throw new Error(`MCP server ${this.config.id}: resource not found: ${uri}`);
      }

      return result.contents[0];
    } catch (error) {
      this.applyErrorState(error);
      this.handleError(this.normalizeError(error));
      throw error;
    }
  }

  async listResources(uriPattern?: string): Promise<McpResource[]> {
    if (this.state !== "connected" || !this.client) {
      throw new Error(`MCP server ${this.config.id}: not connected`);
    }

    try {
      const result = await this.client.request(
        {
          method: "resources/list",
          params: uriPattern ? { pattern: uriPattern } : {},
        },
        ListResourcesResultSchema
      ) as ListResourcesResult;

      return result.resources ?? [];
    } catch (error) {
      this.applyErrorState(error);
      this.handleError(this.normalizeError(error));
      throw error;
    }
  }

  async dispose(): Promise<void> {
    await this.disconnect();
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
    this.applyErrorState(error);
    console.error(`[MCP ${this.config.id}] Error:`, error.message);
    this.onError?.(error, this.config.id);
  }

  private setupNotificationHandlers(): void {
    if (!this.client) return;

    this.client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
      void this.refreshTools();
    });
    this.client.setNotificationHandler(ResourceListChangedNotificationSchema, () => {
      void this.refreshResources();
    });
  }

  private async createTransport(): Promise<Transport> {
    switch (this.config.transport) {
      case "stdio":
        return this.createStdioTransport();
      case "http":
        return this.createHttpTransport();
      case "sse":
        return this.createSseTransport();
      default:
        throw new Error(
          `Unsupported transport type: ${String(this.config.transport)}. ` +
          `Supported transports: ${SUPPORTED_MCP_TRANSPORTS.join(", ")}`
        );
    }
  }

  private async createStdioTransport(): Promise<Transport> {
    if (!this.config.command) {
      throw new Error(`MCP server ${this.config.id}: command is required for stdio transport`);
    }

    return new StdioClientTransport({
      command: this.config.command,
      args: this.config.args ?? [],
      env: {
        ...process.env,
        ...this.config.env,
      } as Record<string, string>,
      stderr: "pipe",
    });
  }

  private async createHttpTransport(): Promise<Transport> {
    if (!this.config.url) {
      throw new Error(`MCP server ${this.config.id}: url is required for http transport`);
    }

    const transportOptions: StreamableHTTPClientTransportOptions = {
      requestInit: {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...this.config.headers,
        },
      },
    };

    return new StreamableHTTPClientTransport(
      new URL(this.config.url),
      transportOptions
    );
  }

  private async createSseTransport(): Promise<Transport> {
    if (!this.config.url) {
      throw new Error(`MCP server ${this.config.id}: url is required for sse transport`);
    }

    const transportOptions: SSEClientTransportOptions = {
      requestInit: {
        headers: {
          Accept: "text/event-stream",
          ...this.config.headers,
        },
      },
    };

    return new SSEClientTransport(
      new URL(this.config.url),
      transportOptions
    );
  }

  private async refreshTools(): Promise<void> {
    if (this.state !== "connected" || !this.client) return;

    try {
      if (!this.capabilities?.tools) {
        this.tools = [];
        return;
      }

      const result = await this.client.request(
        { method: "tools/list" },
        ListToolsResultSchema
      ) as ListToolsResult;

      const prevTools = this.tools;
      this.tools = result.tools ?? [];

      if (JSON.stringify(prevTools) !== JSON.stringify(this.tools)) {
        this.onToolsChanged?.(this.tools, this.config.id);
      }
    } catch (error) {
      this.applyErrorState(error);
      console.error(`[MCP ${this.config.id}] Failed to refresh tools:`, error);
    }
  }

  private async refreshResources(): Promise<void> {
    if (this.state !== "connected" || !this.client) return;

    try {
      if (!this.capabilities?.resources) {
        this.resources = [];
        return;
      }

      const result = await this.client.request(
        { method: "resources/list" },
        ListResourcesResultSchema
      ) as ListResourcesResult;

      const prevResources = this.resources;
      this.resources = result.resources ?? [];

      if (JSON.stringify(prevResources) !== JSON.stringify(this.resources)) {
        this.onResourcesChanged?.(this.resources, this.config.id);
      }
    } catch (error) {
      this.applyErrorState(error);
      console.error(`[MCP ${this.config.id}] Failed to refresh resources:`, error);
    }
  }

  private async closeClientAndTransport(): Promise<void> {
    const client = this.client;
    const transport = this.transport;

    this.client = null;
    this.transport = null;

    const closeOps: Promise<unknown>[] = [];
    if (client) {
      closeOps.push(client.close());
    }
    if (transport) {
      closeOps.push(transport.close());
    }

    if (closeOps.length === 0) {
      return;
    }

    const results = await Promise.allSettled(closeOps);
    for (const result of results) {
      if (result.status === "rejected") {
        console.error(`[MCP ${this.config.id}] Error during disconnect:`, result.reason);
      }
    }
  }

  private normalizeError(error: unknown): Error {
    if (error instanceof Error) {
      return error;
    }
    if (
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      typeof (error as { message?: unknown }).message === "string"
    ) {
      return new Error((error as { message: string }).message);
    }
    return new Error(String(error));
  }

  private applyErrorState(
    error: unknown,
    fallback: Extract<McpConnectionState, "disconnected" | "degraded"> | null = null
  ): void {
    const inferredState = this.classifyErrorState(error) ?? fallback;
    if (!inferredState) {
      return;
    }
    if (this.state === "disconnected" && inferredState !== "needs_auth") {
      return;
    }
    this.setState(inferredState);
  }

  private classifyErrorState(
    error: unknown
  ): Extract<McpConnectionState, "degraded" | "needs_auth"> | null {
    const message = this.normalizeError(error).message.toLowerCase();
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;

    if (
      code === 401 ||
      code === 403 ||
      message.includes("unauthorized") ||
      message.includes("forbidden") ||
      message.includes("authentication") ||
      message.includes("auth required") ||
      message.includes("needs auth") ||
      message.includes("invalid token")
    ) {
      return "needs_auth";
    }

    if (
      code === ErrorCode.ConnectionClosed ||
      message.includes("connection closed") ||
      message.includes("connection lost") ||
      message.includes("disconnected") ||
      message.includes("timed out") ||
      message.includes("timeout") ||
      message.includes("econnreset") ||
      message.includes("econnrefused") ||
      message.includes("ehostunreach") ||
      message.includes("network") ||
      message.includes("maximum reconnection attempts")
    ) {
      return "degraded";
    }

    return null;
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create an MCP client based on server configuration.
 */
export function createMcpClient(options: McpClientOptions): McpClient {
  return new McpClientImpl(options);
}

// ============================================================================
// Backward Compatibility
// ============================================================================

/**
 * @deprecated Use createMcpClient() instead.
 */
export function createStdioMcpClient(options: McpClientOptions): McpClient {
  if (options.server.transport !== "stdio") {
    throw new Error(`Expected stdio transport, got ${options.server.transport}`);
  }
  return new McpClientImpl(options);
}
