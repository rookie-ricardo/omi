import { type RunnerResultName, parseResult, resultSchemas } from "@omi/protocol";

export function normalizeResult(method: string, result: unknown): unknown {
  if (method in resultSchemas) {
    return parseResult(method as RunnerResultName, result);
  }

  return result;
}
