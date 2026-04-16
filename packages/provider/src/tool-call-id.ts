import { createHash } from "node:crypto";

export function canonicalizeForHash(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeForHash(item));
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const sortedEntries = Object.keys(record)
      .sort()
      .map((key) => [key, canonicalizeForHash(record[key])] as const);
    return Object.fromEntries(sortedEntries);
  }
  return value;
}

export function buildStableToolCallId(
  runId: string,
  toolCall: unknown,
  toolName: string,
  args: Record<string, unknown>,
): string {
  const toolCallSnapshot = JSON.stringify(canonicalizeForHash(toolCall ?? {}));
  const argsSnapshot = JSON.stringify(canonicalizeForHash(args));
  const fingerprint = createHash("sha1")
    .update(`${toolName}|${toolCallSnapshot}|${argsSnapshot}`)
    .digest("hex")
    .slice(0, 16);
  return `${runId}:tool:fallback:${fingerprint}`;
}

