/**
 * JSON Lines protocol helpers for RPC mode.
 */

/**
 * Serialize an object to a JSON line (JSON + newline).
 */
export function serializeJsonLine(obj: unknown): string {
  return JSON.stringify(obj) + "\n";
}

/**
 * Parse a JSON line into an object.
 */
export function parseJsonLine(line: string): unknown {
  const trimmed = line.trim();
  if (!trimmed) return null;
  return JSON.parse(trimmed);
}

/**
 * Attach a JSON line reader to a readable stream.
 * Yields parsed objects as they come in.
 */
export async function* attachJsonlLineReader(
  stream: NodeJS.ReadableStream,
): AsyncGenerator<unknown, void, unknown> {
  let buffer = "";

  for await (const chunk of stream) {
    buffer += chunk;

    // Split by newlines
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? ""; // Keep the last incomplete line in buffer

    for (const line of lines) {
      const parsed = parseJsonLine(line);
      if (parsed !== null) {
        yield parsed;
      }
    }
  }

  // Process any remaining content in buffer
  if (buffer.trim()) {
    const parsed = parseJsonLine(buffer);
    if (parsed !== null) {
      yield parsed;
    }
  }
}
