/**
 * RPC client for connecting to an RPC mode server.
 */

import type { RpcCommand, RpcExtensionUIResponse, RpcResponse, RpcSessionState } from "./rpc-types";
import { serializeJsonLine, parseJsonLine } from "./jsonl";
import { getLogger } from "../../logger";

const logger = getLogger("rpc-client");

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
  private connectionStartTime = 0;
  private requestCounter = 0;
  private errorCounter = 0;

  constructor(private readonly options: RpcClientOptions) {}

  /**
   * Connect to the RPC server.
   */
  async connect(): Promise<void> {
    const { spawn } = await import("node:child_process");
    this.connectionStartTime = Date.now();

    logger.info("RPC client connecting", {
      command: this.options.command[0],
      cwd: this.options.cwd,
    });

    this.proc = spawn(this.options.command[0], this.options.command.slice(1), {
      env: { ...process.env, ...this.options.env },
      cwd: this.options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    return new Promise((resolve, reject) => {
      if (!this.proc) {
        logger.error("RPC client failed: Process not created");
        return reject(new Error("Process not created"));
      }

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
              const durationMs = Date.now() - this.connectionStartTime;
              logger.info("RPC client connected", { durationMs });
              resolve();
            }
            listener({ type: "event", event: (parsed as { type: string }).type, data: parsed });
          }
        }
      });

      this.proc.stderr?.on("data", (data: Buffer) => {
        logger.warn("RPC stderr", { data: data.toString().slice(0, 200) });
      });

      this.proc.on("error", (err) => {
        logger.errorWithError("RPC client connection error", err);
        reject(err);
      });

      this.proc.on("close", (code) => {
        const wasConnected = this.connected;
        this.connected = false;
        logger.info("RPC client disconnected", { exitCode: code, wasConnected });

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
    logger.info("RPC client disconnecting");
    this.proc?.kill();
    this.proc = null;
    this.connected = false;
  }

  /**
   * Send a command and wait for the response.
   */
  async sendCommand<T>(command: RpcCommand): Promise<T> {
    if (!this.proc || !this.connected) {
      logger.error("RPC command failed: Not connected", { command: command.type });
      throw new Error("Not connected to RPC server");
    }

    const id = generateId();
    const cmdWithId = { ...command, id };
    this.requestCounter++;

    const startTime = Date.now();
    logger.debug("RPC command sending", { command: command.type, id });

    return new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve: resolve as (value: unknown) => void, reject });

      this.proc?.stdin?.write(serializeJsonLine(cmdWithId));

      // Timeout after 60 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          this.errorCounter++;
          logger.warn("RPC command timeout", { command: command.type, id, timeoutMs: 60000 });
          reject(new Error("Request timeout"));
        }
      }, 60000);
    }).then((result) => {
      const durationMs = Date.now() - startTime;
      logger.debug("RPC command completed", { command: command.type, id, durationMs });
      return result as T;
    }).catch((error) => {
      const durationMs = Date.now() - startTime;
      this.errorCounter++;
      logger.warn("RPC command failed", { command: command.type, id, durationMs, error: String(error) });
      throw error;
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
