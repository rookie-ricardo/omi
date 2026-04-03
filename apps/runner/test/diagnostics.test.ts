import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuditLogService } from "../../../packages/agent/src/audit-log";
import { DiagnosticsService } from "../src/diagnostics";
import { TelemetryService } from "../../../packages/agent/src/telemetry";

describe("DiagnosticsService", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("tracks MCP telemetry states and reconnect/error bookkeeping across lifecycle events", () => {
		const telemetry = new TelemetryService();
		const auditLog = new AuditLogService();
		const diagnostics = new DiagnosticsService({ telemetry, auditLog });

		diagnostics.registerMcpServer({
			serverName: "filesystem",
			serverType: "stdio",
			status: "connecting",
		});

		telemetry.emitMcpConnectionEvent({
			type: "mcp:connected",
			serverName: "filesystem",
			serverType: "stdio",
			transport: "stdio",
			latencyMs: 14,
			timestamp: new Date().toISOString(),
		});

		vi.advanceTimersByTime(100);
		telemetry.emitMcpConnectionEvent({
			type: "mcp:reconnecting",
			serverName: "filesystem",
			attemptNumber: 1,
			maxAttempts: 3,
			timestamp: new Date().toISOString(),
		});

		vi.advanceTimersByTime(100);
		telemetry.emitMcpConnectionEvent({
			type: "mcp:auth_failed",
			serverName: "filesystem",
			authType: "oauth",
			error: "invalid token",
			timestamp: new Date().toISOString(),
		});

		vi.advanceTimersByTime(100);
		telemetry.emitMcpConnectionEvent({
			type: "mcp:error",
			serverName: "filesystem",
			error: "transport closed",
			errorCode: "ECONNRESET",
			timestamp: new Date().toISOString(),
		});

		vi.advanceTimersByTime(100);
		telemetry.emitMcpConnectionEvent({
			type: "mcp:disconnected",
			serverName: "filesystem",
			serverType: "stdio",
			reason: "server shutdown",
			timestamp: new Date().toISOString(),
		});

		const server = diagnostics.getMcpServer("filesystem");
		expect(server).toMatchObject({
			serverName: "filesystem",
			serverType: "stdio",
			status: "disconnected",
			connectedAt: "2024-01-01T00:00:00.000Z",
			reconnectCount: 1,
			errorCount: 2,
			lastError: "server shutdown",
			latencyMs: 14,
		});
		expect(server?.lastActivity).toBe("2024-01-01T00:00:00.400Z");
		expect(diagnostics.getAllMcpServers()).toHaveLength(1);
		expect(telemetry.getAllCounters()).toMatchObject({
			"mcp:mcp:connected": 1,
			"mcp:mcp:reconnecting": 1,
			"mcp:mcp:auth_failed": 1,
			"mcp:mcp:error": 1,
			"mcp:mcp:disconnected": 1,
		});
	});

	it("derives active runs and health checks from iterable collections", () => {
		const diagnostics = new DiagnosticsService({
			telemetry: new TelemetryService(),
			auditLog: new AuditLogService(),
		});

		diagnostics.registerRun({
			runId: "run-running",
			sessionId: "session-1",
			status: "running",
			startTime: "2024-01-01T00:00:00.000Z",
			durationMs: 0,
		});
		diagnostics.registerRun({
			runId: "run-blocked",
			sessionId: "session-1",
			status: "blocked",
			startTime: "2024-01-01T00:00:00.000Z",
			durationMs: 0,
		});
		diagnostics.registerRun({
			runId: "run-completed",
			sessionId: "session-1",
			status: "completed",
			startTime: "2024-01-01T00:00:00.000Z",
			durationMs: 0,
		});

		expect(diagnostics.getActiveRuns().map((run) => run.runId)).toEqual(["run-running", "run-blocked"]);
		expect(diagnostics.performHealthCheck()).toMatchObject({
			status: "healthy",
			checks: expect.arrayContaining([
				expect.objectContaining({
					name: "runs",
					status: "pass",
				}),
				expect.objectContaining({
					name: "mcp_servers",
				}),
				expect.objectContaining({
					name: "providers",
					status: "pass",
				}),
				expect.objectContaining({
					name: "memory",
				}),
			]),
		});
	});
});
