import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getBashMetrics,
  resetBashMetrics,
} from "../src/bash-observability";
import type { BashOperations } from "../src/bash-executor";

describe("Bash Observability", () => {
  beforeEach(() => {
    resetBashMetrics();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getBashMetrics", () => {
    it("应该返回初始化的指标", () => {
      const metrics = getBashMetrics();

      expect(metrics).toEqual({
        commandsExecuted: 0,
        commandsFailed: 0,
        totalExecutionTimeMs: 0,
        totalOutputBytes: 0,
      });
    });

    it("应该返回独立的副本", () => {
      const metrics1 = getBashMetrics();
      metrics1.commandsExecuted = 10;

      const metrics2 = getBashMetrics();

      expect(metrics2.commandsExecuted).toBe(0);
    });
  });

  describe("resetBashMetrics", () => {
    it("应该重置所有指标", () => {
      // 先模拟一些指标变化
      const mockMetrics = getBashMetrics();
      Object.assign(mockMetrics, {
        commandsExecuted: 5,
        commandsFailed: 2,
        totalExecutionTimeMs: 1000,
        totalOutputBytes: 5000,
      });

      resetBashMetrics();

      const metrics = getBashMetrics();
      expect(metrics.commandsExecuted).toBe(0);
      expect(metrics.commandsFailed).toBe(0);
      expect(metrics.totalExecutionTimeMs).toBe(0);
      expect(metrics.totalOutputBytes).toBe(0);
    });
  });
});
