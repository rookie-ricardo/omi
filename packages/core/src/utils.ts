import { randomBytes } from "node:crypto";
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

const UUID_V6_GREGORIAN_OFFSET_MS = 12_219_292_800_000n;
let lastUuidV6Ms = 0n;
let lastUuidV6Subtick = 0n;

export function createId(prefix: string): string {
  return `${prefix}_${createUuidV6()}`;
}

export function createUuidV6(): string {
  const nowMs = BigInt(Date.now());
  if (nowMs === lastUuidV6Ms) {
    lastUuidV6Subtick = (lastUuidV6Subtick + 1n) % 10_000n;
  } else {
    lastUuidV6Ms = nowMs;
    lastUuidV6Subtick = 0n;
  }

  const timestamp = (nowMs + UUID_V6_GREGORIAN_OFFSET_MS) * 10_000n + lastUuidV6Subtick;
  const timeHigh = Number((timestamp >> 28n) & 0xffff_ffffn);
  const timeMid = Number((timestamp >> 12n) & 0xffffn);
  const timeLow = Number(timestamp & 0xfffn);

  const clockSeqBytes = randomBytes(2);
  const clockSeq = ((clockSeqBytes[0] << 8) | clockSeqBytes[1]) & 0x3fff;
  const nodeBytes = randomBytes(6);
  const node = Array.from(nodeBytes, (value) => value.toString(16).padStart(2, "0")).join("");

  const timeLowAndVersion = (0x6000 | timeLow).toString(16).padStart(4, "0");
  const clockSeqAndVariant = (0x8000 | clockSeq).toString(16).padStart(4, "0");

  return [
    timeHigh.toString(16).padStart(8, "0"),
    timeMid.toString(16).padStart(4, "0"),
    timeLowAndVersion,
    clockSeqAndVariant,
    node,
  ].join("-");
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
