/**
 * RPC 模式观测性支持
 */
import type { Logger } from "../observability";
import type { RpcCommand, RpcResponse } from "./rpc-types";

export interface RpcObservabilityOptions {
  logger: Logger;
  enableMetrics?: boolean;
}

export interface RpcMetrics {
  commandsReceived: number;
  commandsSucceeded: number;
  commandsFailed: number;
  commandLatencies: Map<string, number[]>;
}

export function createRpcMetrics(): RpcMetrics {
  return {
    commandsReceived: 0,
    commandsSucceeded: 0,
    commandsFailed: 0,
    commandLatencies: new Map(),
  };
}

export function recordCommandStart(
  logger: Logger,
  command: RpcCommand,
): { startTime: number; commandId: string } {
  const startTime = performance.now();
  const commandId = command.id ?? `cmd-${startTime}`;

  logger.info("RPC command started", {
    commandId,
    commandType: command.type,
    hasMessage: "message" in command && !!command.message,
  });

  return { startTime, commandId };
}

export function recordCommandSuccess(
  logger: Logger,
  commandId: string,
  commandType: string,
  startTime: number,
  response?: RpcResponse,
): void {
  const duration = performance.now() - startTime;

  logger.info("RPC command completed", {
    commandId,
    commandType,
    durationMs: Math.round(duration),
    success: true,
    hasData: response && "data" in response && !!response.data,
  });
}

export function recordCommandError(
  logger: Logger,
  commandId: string,
  commandType: string,
  startTime: number,
  error: Error,
): void {
  const duration = performance.now() - startTime;

  logger.error("RPC command failed", {
    commandId,
    commandType,
    durationMs: Math.round(duration),
    success: false,
    error: error.message,
    errorType: error.constructor.name,
  });
}

export function logRpcReady(logger: Logger): void {
  logger.info("RPC mode ready", {
    pid: process.pid,
    nodeVersion: process.version,
  });
}

export function logRpcShutdown(logger: Logger, reason: string): void {
  logger.info("RPC mode shutting down", { reason });
}
