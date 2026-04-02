import { describe, expect, it } from "vitest";

import {
  serializeJsonLine,
  parseJsonLine,
  attachJsonlLineReader,
} from "../../../src/modes/rpc/jsonl";

describe("jsonl", () => {
  describe("serializeJsonLine", () => {
    it("serializes object to JSON with newline", () => {
      const obj = { type: "test", data: "hello" };
      expect(serializeJsonLine(obj)).toBe('{"type":"test","data":"hello"}\n');
    });

    it("serializes nested objects correctly", () => {
      const obj = { type: "test", nested: { key: "value" } };
      expect(serializeJsonLine(obj)).toBe('{"type":"test","nested":{"key":"value"}}\n');
    });

    it("serializes arrays correctly", () => {
      const arr = [1, 2, 3];
      expect(serializeJsonLine(arr)).toBe("[1,2,3]\n");
    });

    it("serializes primitive values", () => {
      expect(serializeJsonLine("string")).toBe('"string"\n');
      expect(serializeJsonLine(123)).toBe("123\n");
      expect(serializeJsonLine(true)).toBe("true\n");
      expect(serializeJsonLine(null)).toBe("null\n");
    });
  });

  describe("parseJsonLine", () => {
    it("parses valid JSON line", () => {
      const line = '{"type":"test","data":"hello"}';
      expect(parseJsonLine(line)).toEqual({ type: "test", data: "hello" });
    });

    it("trims whitespace before parsing", () => {
      const line = '  {"type":"test"}  ';
      expect(parseJsonLine(line)).toEqual({ type: "test" });
    });

    it("returns null for empty string", () => {
      expect(parseJsonLine("")).toBeNull();
    });

    it("returns null for whitespace-only string", () => {
      expect(parseJsonLine("   ")).toBeNull();
    });

    it("throws on invalid JSON", () => {
      expect(() => parseJsonLine("{invalid")).toThrow();
    });
  });

  describe("attachJsonlLineReader", () => {
    it("yields parsed objects from complete lines", async () => {
      const chunks = ['{"a":1}\n{"b":2}\n'];
      const stream = createMockStream(chunks);

      const results: unknown[] = [];
      for await (const obj of attachJsonlLineReader(stream)) {
        results.push(obj);
      }

      expect(results).toEqual([{ a: 1 }, { b: 2 }]);
    });

    it("buffers incomplete lines until newline arrives", async () => {
      const chunks = ['{"a":1}\n{"b":', '2}\n'];
      const stream = createMockStream(chunks);

      const results: unknown[] = [];
      for await (const obj of attachJsonlLineReader(stream)) {
        results.push(obj);
      }

      expect(results).toEqual([{ a: 1 }, { b: 2 }]);
    });

    it("handles multiple lines in single chunk", async () => {
      const chunks = ['{"x":1}\n{"y":2}\n{"z":3}\n'];
      const stream = createMockStream(chunks);

      const results: unknown[] = [];
      for await (const obj of attachJsonlLineReader(stream)) {
        results.push(obj);
      }

      expect(results).toEqual([{ x: 1 }, { y: 2 }, { z: 3 }]);
    });

    it("processes remaining buffer after stream ends", async () => {
      const chunks = ['{"last":true}'];
      const stream = createMockStream(chunks);

      const results: unknown[] = [];
      for await (const obj of attachJsonlLineReader(stream)) {
        results.push(obj);
      }

      expect(results).toEqual([{ last: true }]);
    });

    it("skips empty lines", async () => {
      const chunks = ['{"a":1}\n\n{"b":2}\n'];
      const stream = createMockStream(chunks);

      const results: unknown[] = [];
      for await (const obj of attachJsonlLineReader(stream)) {
        results.push(obj);
      }

      expect(results).toEqual([{ a: 1 }, { b: 2 }]);
    });
  });
});

function createMockStream(chunks: string[]): NodeJS.ReadableStream {
  const { Readable } = require("node:stream");
  return Readable.from(chunks);
}
