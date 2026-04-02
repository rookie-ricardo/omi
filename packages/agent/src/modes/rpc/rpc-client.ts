/**
 * RPC client for connecting to an RPC mode server.
 */

import type { RpcCommand, RpcExtensionUIResponse, RpcResponse, RpcSessionState } from "./rpc-types";
import { serializeJsonLine, parseJsonLine } from "./jsonl";

export interface RpcClientOptions {
  /** Command to spawn the server process */
  command: string[];
  /** Environment variables */
  env?: Record<string, string>;
  /** Working directory */
  cwd?: string;
}

/**
 * Event listener for RPC client events.
 */
export type RpcEventListener = (event: RpcResponse | { type: "event"; event: string; data: unknown }) => void;

/**
 * RPC client for connecting to an RPC mode server process.
 */
export class RpcClient {
  private proc: ReturnType<typeof import("node:child_process").spawn> | null = null;
  private listeners: RpcEventListener[] = [];
  private pendingRequests = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private connected = false;

  constructor(private readonly options: RpcClientOptions) {}

  /**
   * Connect to the RPC server.
   */
  async connect(): Promise<void> {
    const { spawn } = await import("node:child_process");

    this.proc = spawn(this.options.command[0], this.options.command.slice(1), {
      env: { ...process.env, ...this.options.env },
      cwd: this.options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    return new Promise((resolve, reject) => {
      if (!this.proc) return reject(new Error("Process not created"));

      this.proc.stdout?.on("data", (data: Buffer) => {
        const lines = data.toString().split("\n").filter((l) => l.trim());

        for (const line of lines) {
          const parsed = parseJsonLine(line);
          if (!parsed) continue;

          // Check if this is a response to a pending request
          if (typeof parsed === "object" && "id" in parsed && (parsed as { id?: string }).id) {
            const id = (parsed as { id: string }).id;
            const pending = this.pendingRequests.get(id);
            if (pending) {
              this.pendingRequests.delete(id);
              const response = parsed as RpcResponse;
              if (response.success && "data" in response) {
                pending.resolve(response.data);
              } else if (!response.success && "error" in response) {
                pending.reject(new Error((response as { error: string }).error));
              } else {
                pending.resolve(null);
              }
            }
          }

          // Notify all listeners
          for (const listener of this.listeners) {
            if ((parsed as { type: string }).type === "rpc_ready") {
              this.connected = true;
              resolve();
            }
            listener({ type: "event", event: (parsed as { type: string }).type, data: parsed });
          }
        }
      });

      this.proc.stderr?.on("data", (data: Buffer) => {
        console.error("RPC stderr:", data.toString());
      });

      this.proc.on("error", (err) => {
        reject(err);
      });

      this.proc.on("close", (code) => {
        this.connected = false;
        // Reject all pending requests
        for (const [_, pending] of this.pendingRequests) {
          pending.reject(new Error(`Process exited with code ${code}`));
        }
        this.pendingRequests.clear();
      });
    });
  }

  /**
   * Disconnect from the RPC server.
   */
  disconnect(): void {
    this.proc?.kill();
    this.proc = null;
    this.connected = false;
  }

  /**
   * Send a command and wait for the response.
   */
  async sendCommand<T>(command: RpcCommand): Promise<T> {
    if (!this.proc || !this.connected) {
      throw new Error("Not connected to RPC server");
    }

    const id = generateId();
    const cmdWithId = { ...command, id };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve: resolve as (value: unknown) => void, reject });

      this.proc?.stdin?.write(serializeJsonLine(cmdWithId));

      // Timeout after 60 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error("Request timeout"));
        }
      }, 60000);
    });
  }

  /**
   * Subscribe to RPC events.
   */
  subscribe(listener: RpcEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index !== -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  /**
   * Check if connected.
   */
  get isConnected(): boolean {
    return this.connected;
  }
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}
