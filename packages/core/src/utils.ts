import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export function ensureDir(path: string): string {
  mkdirSync(path, { recursive: true });
  return path;
}

export function ensureParentDir(path: string): string {
  mkdirSync(dirname(path), { recursive: true });
  return path;
}

export function createId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export class AppError extends Error {
  constructor(
    message: string,
    readonly code = "APP_ERROR",
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function splitLines(value: string): string[] {
  return value.split(/\r?\n/);
}

/**
 * Get the agent config directory (e.g., ~/.omi/).
 * Respects OMI_DIR env var and tilde expansion.
 */
export function getAgentDir(): string {
  const envDir = process.env.OMI_DIR;
  if (envDir) {
    if (envDir === "~") return homedir();
    if (envDir.startsWith("~/")) return homedir() + envDir.slice(1);
    return envDir;
  }
  return join(homedir(), ".omi");
}

/**
 * Get path to managed binaries directory (fd, rg).
 */
export function getBinDir(): string {
  return join(getAgentDir(), "bin");
}
