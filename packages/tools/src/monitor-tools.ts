import { randomBytes, randomUUID } from "node:crypto";
import { createWriteStream, existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type, type Static } from "@mariozechner/pi-ai";
import { getShellConfig, getShellEnv, killProcessTree } from "./shell.js";
import { parseToolInput } from "./input-parse.js";

// ============================================================================
// State
// ============================================================================

export interface BackgroundJob {
  id: string;
  command: string;
  cwd: string;
  pid: number | undefined;
  logFile: string;
  status: "running" | "exited" | "killed";
  exitCode: number | null;
  startedAt: number;
  endedAt?: number;
  process?: ChildProcess;
}

const activeJobs = new Map<string, BackgroundJob>();

function getTempFilePath(): string {
  const id = randomBytes(8).toString("hex");
  return join(tmpdir(), `pi-bash-bg-${id}.log`);
}

// ============================================================================
// Schemas
// ============================================================================

export const bashBackgroundSchema = Type.Object({
  command: Type.String({ description: "Bash command to execute in the background" }),
});

export const monitorSchema = Type.Object({
  jobId: Type.String({ description: "The ID of the background job to monitor" }),
});

// ============================================================================
// Tool Factories
// ============================================================================

export function createBashBackgroundTool(cwd: string): AgentTool<typeof bashBackgroundSchema, { jobId: string; pid?: number; logFile: string }> {
  return {
    name: "bash_background",
    label: "bash_background",
    description: "Execute a bash command in the background. Returns a jobId that can be used with the monitor tool.",
    parameters: bashBackgroundSchema,
    execute: async (_toolCallId: string, params: unknown) => {
      const { command } = parseToolInput("bash_background", bashBackgroundSchema, params);

      if (!existsSync(cwd)) {
        throw new Error(`Working directory does not exist: ${cwd}\nCannot execute bash_background commands.`);
      }

      const jobId = randomUUID();
      const logFile = getTempFilePath();
      const { shell, args } = getShellConfig();

      const outStream = createWriteStream(logFile, { flags: "a" });
      outStream.write(`[STARTED: ${new Date().toISOString()}]\n`);
      outStream.write(`$ ${command}\n\n`);

      const child = spawn(shell, [...args, command], {
        cwd,
        detached: true,
        env: getShellEnv(),
        stdio: ["ignore", "pipe", "pipe"],
      });

      const job: BackgroundJob = {
        id: jobId,
        command,
        cwd,
        pid: child.pid,
        logFile,
        status: "running",
        exitCode: null,
        startedAt: Date.now(),
        process: child,
      };

      activeJobs.set(jobId, job);

      if (child.stdout) {
        child.stdout.on("data", (chunk: Buffer) => {
          outStream.write(chunk);
        });
      }
      if (child.stderr) {
        child.stderr.on("data", (chunk: Buffer) => {
          outStream.write(chunk);
        });
      }

      child.on("error", (err) => {
        outStream.write(`\n[SPAWN ERROR: ${err.message}]\n`);
        job.status = "exited";
        job.exitCode = -1;
        job.endedAt = Date.now();
        outStream.end();
      });

      child.on("close", (code) => {
        outStream.write(`\n[EXITED with code ${code} at ${new Date().toISOString()}]\n`);
        job.status = "exited";
        job.exitCode = code;
        job.endedAt = Date.now();
        job.process = undefined; // release reference
        outStream.end();
      });

      return {
        content: [{ type: "text" as const, text: `Successfully started background job '${jobId}'. Log output is being written to ${logFile}. Use monitor tool to inspect execution.` }],
        details: {
          jobId,
          pid: child.pid,
          logFile,
        },
      };
    },
  };
}

export function createMonitorTool(): AgentTool<typeof monitorSchema, { jobId: string; status: string; exitCode: number | null; outputTail: string }> {
  return {
    name: "monitor",
    label: "monitor",
    description: "Monitor the status and fetch the latest output (tail) of a background job.",
    parameters: monitorSchema,
    execute: async (_toolCallId: string, params: unknown) => {
      const { jobId } = parseToolInput("monitor", monitorSchema, params);

      const job = activeJobs.get(jobId);
      if (!job) {
        throw new Error(`No background job found with ID '${jobId}'. It may have never been started or it is tracked from a previous run.`);
      }

      let tail = "";
      if (existsSync(job.logFile)) {
        try {
          const stats = statSync(job.logFile);
          // Read up to last 32KB
          const MAX_READ = 32768;
          const start = Math.max(0, stats.size - MAX_READ);
          
          // Fast naive tail reading
          // Read entire file if it's small, or slice
          const content = readFileSync(job.logFile);
          tail = content.subarray(start).toString("utf-8");
          if (start > 0) {
            tail = `[... truncated ${start} bytes ...]\n` + tail;
          }
        } catch (err) {
          tail = `[Error reading log file: ${err instanceof Error ? err.message : String(err)}]`;
        }
      } else {
        tail = "[Log file not found]";
      }

      const summary = `Job Status: ${job.status}\nExit Code: ${job.exitCode ?? "N/A"}\nCommand: ${job.command}\n\n--- Output Tail ---\n${tail}`;

      return {
        content: [{ type: "text" as const, text: summary }],
        details: {
          jobId,
          status: job.status,
          exitCode: job.exitCode,
          outputTail: tail,
        },
      };
    },
  };
}
