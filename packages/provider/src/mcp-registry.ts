/**
 * MCP Registry - Manages MCP server configurations and client instances
 *
 * Provides a central registry for MCP servers with:
 * - Server configuration management
 * - Connection state tracking
 * - Tool and resource aggregation
 * - Connection pooling and caching
 */

import type {
  McpClient,
  McpConnectionState,
  McpResource,
  McpResourceContent,
  McpServerConfig,
  McpTool,
  McpPrompt,
  McpPromptMessage,
  McpGetPromptResult,
  McpToolResult,
} from "./mcp-client";
import { createMcpClient } from "./mcp-client";

// ============================================================================
// Types
// ============================================================================

/**
 * Registered MCP server entry.
 */
export interface McpServerEntry {
  /** Server configuration */
  config: McpServerConfig;
  /** Client instance */
  client: McpClient;
  /** Connection state */
  state: McpConnectionState;
  /** Last error if any */
  lastError?: string;
  /** Last connected timestamp */
  lastConnectedAt?: string;
}

/**
 * MCP Registry options.
 */
export interface McpRegistryOptions {
  /** Default timeout for operations */
  defaultTimeoutMs?: number;
  /** Enable automatic reconnection */
  autoReconnect?: boolean;
  /** Reconnection delay in milliseconds */
  reconnectDelayMs?: number;
  /** On server state change callback */
  onStateChange?: ((serverId: string, state: McpConnectionState) => void) | undefined;
  /** On error callback */
  onError?: ((serverId: string, error: Error) => void) | undefined;
}

/**
 * Aggregated MCP tools and resources across all servers.
 */
export interface McpAggregatedCatalog {
  tools: Array<{ serverId: string; serverName: string; tool: McpTool }>;
  resources: Array<{ serverId: string; serverName: string; resource: McpResource }>;
  prompts: Array<{ serverId: string; serverName: string; prompt: McpPrompt }>;
}

// ============================================================================
// MCP Registry
// ============================================================================

/**
 * MCP Registry manages MCP server connections and provides unified access.
 */
export class McpRegistry {
  private readonly servers = new Map<string, McpServerEntry>();
  private readonly options: McpRegistryOptions;
  private readonly reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly reconnectAttempts = new Map<string, number>();
  private readonly reconnectLocks = new Set<string>();
  private readonly reconnectSuppressed = new Set<string>();

  constructor(options: McpRegistryOptions = {}) {
    this.options = {
      defaultTimeoutMs: options.defaultTimeoutMs ?? 30000,
      autoReconnect: options.autoReconnect ?? true,
      reconnectDelayMs: options.reconnectDelayMs ?? 5000,
      onStateChange: options.onStateChange,
      onError: options.onError,
    };
  }

  // --------------------------------------------------------------------------
  // Server Management
  // --------------------------------------------------------------------------

  /**
   * Register an MCP server.
   */
  register(config: McpServerConfig): void {
    if (this.servers.has(config.id)) {
      throw new Error(`MCP server ${config.id} is already registered`);
    }

    const client = createMcpClient({
      server: config,
      onStateChange: (state: McpConnectionState) => {
        this.handleStateChange(config.id, state);
        if (state === "connected") {
          this.servers.get(config.id)!.lastConnectedAt = new Date().toISOString();
        }
      },
      onError: (error: Error) => {
        this.handleError(config.id, error);
      },
    });

    this.servers.set(config.id, {
      config,
      client,
      state: "disconnected",
    });
  }

  /**
   * Unregister an MCP server.
   */
  async unregister(serverId: string): Promise<void> {
    const entry = this.servers.get(serverId);
    if (!entry) {
      return;
    }

    this.reconnectSuppressed.add(serverId);
    this.clearReconnectTimer(serverId);
    this.reconnectAttempts.delete(serverId);
    await entry.client.dispose();
    this.servers.delete(serverId);
    this.reconnectLocks.delete(serverId);
    this.reconnectSuppressed.delete(serverId);
  }

  /**
   * Get a registered server.
   */
  getServer(serverId: string): McpServerEntry | undefined {
    return this.servers.get(serverId);
  }

  /**
   * Get all registered servers.
   */
  getAllServers(): Map<string, McpServerEntry> {
    return new Map(this.servers);
  }

  /**
   * Check if a server is registered.
   */
  hasServer(serverId: string): boolean {
    return this.servers.has(serverId);
  }

  // --------------------------------------------------------------------------
  // Connection Management
  // --------------------------------------------------------------------------

  /**
   * Connect to a specific server.
   */
  async connect(serverId: string): Promise<void> {
    const entry = this.servers.get(serverId);
    if (!entry) {
      throw new Error(`MCP server ${serverId} is not registered`);
    }

    this.reconnectSuppressed.delete(serverId);
    this.clearReconnectTimer(serverId);
    await entry.client.connect();
  }

  /**
   * Connect to all registered servers.
   */
  async connectAll(): Promise<void> {
    const promises = Array.from(this.servers.entries()).map(([serverId, entry]) => {
      this.reconnectSuppressed.delete(serverId);
      this.clearReconnectTimer(serverId);
      return entry.client.connect().catch((error) => {
        console.error(`Failed to connect to MCP server ${entry.config.id}:`, error);
      });
    });
    await Promise.all(promises);
  }

  /**
   * Disconnect from a specific server.
   */
  async disconnect(serverId: string): Promise<void> {
    const entry = this.servers.get(serverId);
    if (!entry) {
      return;
    }

    this.reconnectSuppressed.add(serverId);
    this.clearReconnectTimer(serverId);
    this.reconnectAttempts.delete(serverId);
    await entry.client.disconnect();
  }

  /**
   * Disconnect from all servers.
   */
  async disconnectAll(): Promise<void> {
    const promises = Array.from(this.servers.entries()).map(([serverId, entry]) => {
      this.reconnectSuppressed.add(serverId);
      this.clearReconnectTimer(serverId);
      this.reconnectAttempts.delete(serverId);
      return entry.client.disconnect().catch((error) => {
        console.error(`Failed to disconnect from MCP server ${entry.config.id}:`, error);
      });
    });
    await Promise.all(promises);
  }

  /**
   * Reconnect to a specific server.
   */
  async reconnect(serverId: string): Promise<void> {
    const entry = this.servers.get(serverId);
    if (!entry) {
      throw new Error(`MCP server ${serverId} is not registered`);
    }

    this.reconnectSuppressed.delete(serverId);
    this.clearReconnectTimer(serverId);
    this.reconnectAttempts.delete(serverId);
    await entry.client.disconnect();
    await entry.client.connect();
  }

  // --------------------------------------------------------------------------
  // Tool Access
  // --------------------------------------------------------------------------

  /**
   * Get tools from a specific server.
   */
  getTools(serverId: string): McpTool[] {
    const entry = this.servers.get(serverId);
    if (!entry || entry.state !== "connected") {
      return [];
    }

    return entry.client.getTools();
  }

  /**
   * Get tools from all connected servers.
   */
  getAllTools(): Array<{ serverId: string; serverName: string; tool: McpTool }> {
    const tools: Array<{ serverId: string; serverName: string; tool: McpTool }> = [];

    for (const [serverId, entry] of this.servers) {
      if (entry.state !== "connected") continue;

      const serverTools = entry.client.getTools();
      for (const tool of serverTools) {
        tools.push({
          serverId,
          serverName: entry.config.name,
          tool,
        });
      }
    }

    return tools;
  }

  /**
   * Call a tool on a specific server.
   */
  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<McpToolResult> {
    const entry = this.servers.get(serverId);
    if (!entry) {
      throw new Error(`MCP server ${serverId} is not registered`);
    }

    if (entry.state !== "connected") {
      throw new Error(`MCP server ${serverId} is not connected`);
    }

    return entry.client.callTool(toolName, args);
  }

  // --------------------------------------------------------------------------
  // Resource Access
  // --------------------------------------------------------------------------

  /**
   * Get resources from a specific server.
   */
  getResources(serverId: string): McpResource[] {
    const entry = this.servers.get(serverId);
    if (!entry || entry.state !== "connected") {
      return [];
    }

    return entry.client.getResources();
  }

  /**
   * Get resources from all connected servers.
   */
  getAllResources(): Array<{ serverId: string; serverName: string; resource: McpResource }> {
    const resources: Array<{ serverId: string; serverName: string; resource: McpResource }> = [];

    for (const [serverId, entry] of this.servers) {
      if (entry.state !== "connected") continue;

      const serverResources = entry.client.getResources();
      for (const resource of serverResources) {
        resources.push({
          serverId,
          serverName: entry.config.name,
          resource,
        });
      }
    }

    return resources;
  }

  /**
   * Read a resource from a specific server.
   */
  async readResource(serverId: string, uri: string): Promise<McpResourceContent> {
    const entry = this.servers.get(serverId);
    if (!entry) {
      throw new Error(`MCP server ${serverId} is not registered`);
    }

    if (entry.state !== "connected") {
      throw new Error(`MCP server ${serverId} is not connected`);
    }

    return entry.client.readResource(uri);
  }

  /**
   * Read a resource by URI (searches all servers).
   */
  async readResourceByUri(uri: string): Promise<{ serverId: string; content: McpResourceContent }> {
    // Find the server that owns this resource
    for (const [serverId, entry] of this.servers) {
      if (entry.state !== "connected") continue;

      const resources = entry.client.getResources();
      if (resources.some((r) => r.uri === uri)) {
        const content = await entry.client.readResource(uri);
        return { serverId, content };
      }
    }

    throw new Error(`Resource not found: ${uri}`);
  }

  // --------------------------------------------------------------------------
  // Prompt Access
  // --------------------------------------------------------------------------

  /**
   * Get prompts from a specific server.
   */
  getPrompts(serverId: string): McpPrompt[] {
    const entry = this.servers.get(serverId);
    if (!entry || entry.state !== "connected") {
      return [];
    }

    return entry.client.getPrompts();
  }

  /**
   * Get prompts from all connected servers.
   */
  getAllPrompts(): Array<{ serverId: string; serverName: string; prompt: McpPrompt }> {
    const prompts: Array<{ serverId: string; serverName: string; prompt: McpPrompt }> = [];

    for (const [serverId, entry] of this.servers) {
      if (entry.state !== "connected") continue;

      const serverPrompts = entry.client.getPrompts();
      for (const prompt of serverPrompts) {
        prompts.push({
          serverId,
          serverName: entry.config.name,
          prompt,
        });
      }
    }

    return prompts;
  }

  /**
   * Evaluate a prompt on a specific server.
   */
  async getPrompt(
    serverId: string,
    promptName: string,
    args?: Record<string, string>
  ): Promise<McpGetPromptResult> {
    const entry = this.servers.get(serverId);
    if (!entry) {
      throw new Error(`MCP server ${serverId} is not registered`);
    }

    if (entry.state !== "connected") {
      throw new Error(`MCP server ${serverId} is not connected`);
    }

    return entry.client.getPrompt(promptName, args);
  }

  // --------------------------------------------------------------------------
  // Aggregation
  // --------------------------------------------------------------------------

  /**
   * Get aggregated catalog of all tools and resources.
   */
  getAggregatedCatalog(): McpAggregatedCatalog {
    return {
      tools: this.getAllTools(),
      resources: this.getAllResources(),
      prompts: this.getAllPrompts(),
    };
  }

  /**
   * Find a tool by name across all servers.
   */
  findTool(toolName: string): { serverId: string; serverName: string; tool: McpTool } | null {
    const tools = this.getAllTools();
    return tools.find((t) => t.tool.name === toolName) ?? null;
  }

  /**
   * Find a resource by URI across all servers.
   */
  findResource(uri: string): { serverId: string; serverName: string; resource: McpResource } | null {
    const resources = this.getAllResources();
    return resources.find((r) => r.resource.uri === uri) ?? null;
  }

  // --------------------------------------------------------------------------
  // State Management
  // --------------------------------------------------------------------------

  /**
   * Get the state of a specific server.
   */
  getState(serverId: string): McpConnectionState | null {
    const entry = this.servers.get(serverId);
    return entry?.state ?? null;
  }

  /**
   * Get states of all servers.
   */
  getAllStates(): Map<string, McpConnectionState> {
    const states = new Map<string, McpConnectionState>();
    for (const [serverId, entry] of this.servers) {
      states.set(serverId, entry.state);
    }
    return states;
  }

  /**
   * Check if any server is connected.
   */
  isAnyConnected(): boolean {
    for (const entry of this.servers.values()) {
      if (entry.state === "connected") {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if all servers are connected.
   */
  isAllConnected(): boolean {
    if (this.servers.size === 0) {
      return false;
    }
    for (const entry of this.servers.values()) {
      if (entry.state !== "connected") {
        return false;
      }
    }
    return true;
  }

  // --------------------------------------------------------------------------
  // Cleanup
  // --------------------------------------------------------------------------

  /**
   * Dispose of all servers and cleanup.
   */
  async dispose(): Promise<void> {
    const disposePromises = Array.from(this.servers.entries()).map(async ([serverId, entry]) => {
      this.reconnectSuppressed.add(serverId);
      this.clearReconnectTimer(serverId);
      this.reconnectAttempts.delete(serverId);
      await entry.client.dispose();
      this.reconnectLocks.delete(serverId);
      this.reconnectSuppressed.delete(serverId);
    });
    await Promise.all(disposePromises);

    this.servers.clear();
  }

  // --------------------------------------------------------------------------
  // Private Methods
  // --------------------------------------------------------------------------

  private handleStateChange(serverId: string, state: McpConnectionState): void {
    const entry = this.servers.get(serverId);
    if (entry) {
      entry.state = state;
    }

    this.options.onStateChange?.(serverId, state);

    if (state === "connected") {
      this.clearReconnectTimer(serverId);
      this.reconnectAttempts.delete(serverId);
      return;
    }

    if (state === "needs_auth") {
      this.clearReconnectTimer(serverId);
      return;
    }

    // Handle auto-reconnect for disconnected/degraded states
    if ((state === "disconnected" || state === "degraded") && this.options.autoReconnect) {
      this.scheduleReconnect(serverId);
    }
  }

  private handleError(serverId: string, error: Error): void {
    const entry = this.servers.get(serverId);
    if (entry) {
      entry.lastError = error.message;
    }

    this.options.onError?.(serverId, error);
  }

  private scheduleReconnect(serverId: string): void {
    if (this.reconnectSuppressed.has(serverId)) {
      return;
    }
    if (this.reconnectTimers.has(serverId)) {
      return;
    }
    if (this.reconnectLocks.has(serverId)) {
      return;
    }

    const nextAttempt = (this.reconnectAttempts.get(serverId) ?? 0) + 1;
    this.reconnectAttempts.set(serverId, nextAttempt);

    const baseDelay = this.options.reconnectDelayMs ?? 5000;
    const backoffDelay = Math.min(baseDelay * 2 ** (nextAttempt - 1), 60000);
    const jitter = Math.floor(backoffDelay * 0.2 * Math.random());
    const reconnectDelay = backoffDelay + jitter;

    const timer = setTimeout(() => {
      this.reconnectTimers.delete(serverId);
      void this.runReconnectAttempt(serverId);
    }, reconnectDelay);

    this.reconnectTimers.set(serverId, timer);
  }

  private async runReconnectAttempt(serverId: string): Promise<void> {
    if (this.reconnectSuppressed.has(serverId)) {
      return;
    }
    if (this.reconnectLocks.has(serverId)) {
      return;
    }

    const entry = this.servers.get(serverId);
    if (!entry || entry.state === "connected" || entry.state === "needs_auth") {
      return;
    }

    let shouldRetry = false;
    this.reconnectLocks.add(serverId);
    try {
      await entry.client.connect();
    } catch (error) {
      console.error(`Auto-reconnect failed for MCP server ${serverId}:`, error);

      const latestEntry = this.servers.get(serverId);
      if (
        latestEntry &&
        latestEntry.state !== "connected" &&
        latestEntry.state !== "needs_auth" &&
        !this.reconnectSuppressed.has(serverId)
      ) {
        shouldRetry = true;
      }
    } finally {
      this.reconnectLocks.delete(serverId);
    }

    if (shouldRetry) {
      this.scheduleReconnect(serverId);
    }
  }

  private clearReconnectTimer(serverId: string): void {
    const timer = this.reconnectTimers.get(serverId);
    if (!timer) {
      return;
    }
    clearTimeout(timer);
    this.reconnectTimers.delete(serverId);
  }
}

// ============================================================================
// Registry Storage Interface
// ============================================================================

/**
 * Interface for persisting MCP server configurations.
 */
export interface McpServerConfigStorage {
  /** Load all server configurations */
  loadAll(): Promise<McpServerConfig[]>;
  /** Save a server configuration */
  save(config: McpServerConfig): Promise<void>;
  /** Delete a server configuration */
  delete(serverId: string): Promise<void>;
}

/**
 * Create a registry from stored configurations.
 */
export async function createRegistryFromStorage(
  storage: McpServerConfigStorage,
  options?: McpRegistryOptions
): Promise<McpRegistry> {
  const registry = new McpRegistry(options);
  const configs = await storage.loadAll();

  for (const config of configs) {
    registry.register(config);
  }

  return registry;
}
