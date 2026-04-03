import { getLogger } from "./logger";
import type { BashExecutorOptions, BashResult, BashOperations } from "./bash-executor";

const logger = getLogger("bash-executor");

/**
 * 带观测性的 Bash 执行器
 * 包装原有执行器并添加日志和指标收集
 */

export interface BashExecutionMetrics {
  commandsExecuted: number;
  commandsFailed: number;
  totalExecutionTimeMs: number;
  totalOutputBytes: number;
}

const metrics: BashExecutionMetrics = {
  commandsExecuted: 0,
  commandsFailed: 0,
  totalExecutionTimeMs: 0,
  totalOutputBytes: 0,
};

export function getBashMetrics(): BashExecutionMetrics {
  return { ...metrics };
}

export function resetBashMetrics(): void {
  metrics.commandsExecuted = 0;
  metrics.commandsFailed = 0;
  metrics.totalExecutionTimeMs = 0;
  metrics.totalOutputBytes = 0;
}

/**
 * 执行 Bash 命令并记录观测性数据
 */
export async function executeBashWithObservability(
  command: string,
  operations: BashOperations,
  options?: BashExecutorOptions,
): Promise<BashResult> {
  const startTime = performance.now();
  const commandId = `bash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  logger.info("Bash command started", {
    commandId,
    command: command.slice(0, 100), // 截断长命令
    commandLength: command.length,
    hasAbortSignal: !!options?.signal,
  });

  try {
    const result = await operations.exec(command, process.cwd(), {
      onData: (data: Buffer) => {
        metrics.totalOutputBytes += data.length;
        options?.onChunk?.(data.toString());
      },
      signal: options?.signal,
    });

    const duration = performance.now() - startTime;
    metrics.commandsExecuted++;
    metrics.totalExecutionTimeMs += duration;

    logger.info("Bash command completed", {
      commandId,
      durationMs: Math.round(duration),
      exitCode: result.exitCode,
      cancelled: options?.signal?.aborted ?? false,
    });

    return {
      output: "", // 实际实现中由调用者填充
      exitCode: result.exitCode ?? undefined,
      cancelled: options?.signal?.aborted ?? false,
      truncated: false,
    } as BashResult;
  } catch (error) {
    const duration = performance.now() - startTime;
    metrics.commandsFailed++;
    metrics.totalExecutionTimeMs += duration;

    logger.errorWithError("Bash command failed", error, {
      commandId,
      durationMs: Math.round(duration),
      command: command.slice(0, 100),
    });

    throw error;
  }
}

/**
 * 记录 Bash 执行摘要
 */
export function logBashSummary(): void {
  logger.info("Bash execution summary", {
    commandsExecuted: metrics.commandsExecuted,
    commandsFailed: metrics.commandsFailed,
    totalExecutionTimeMs: Math.round(metrics.totalExecutionTimeMs),
    totalOutputBytes: metrics.totalOutputBytes,
    averageExecutionTimeMs:
      metrics.commandsExecuted > 0
        ? Math.round(metrics.totalExecutionTimeMs / metrics.commandsExecuted)
        : 0,
  });
}
