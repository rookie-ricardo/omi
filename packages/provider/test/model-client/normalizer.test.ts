import { describe, expect, it } from "vitest";
import { classifyPiAiError } from "../../src/model-client/normalizer";

describe("classifyPiAiError", () => {
  it("classifies by structured status code before message fallback", () => {
    expect(classifyPiAiError({ statusCode: 429, message: "something else" })).toBe("rate_limit");
    expect(classifyPiAiError({ response: { status: 503 }, message: "unexpected" })).toBe("network");
  });

  it("classifies by structured error code", () => {
    expect(classifyPiAiError({ code: "invalid_api_key", message: "oops" })).toBe("auth");
    expect(classifyPiAiError({ code: "ECONNRESET", message: "oops" })).toBe("network");
  });

  it("falls back to message classification when no structured fields are present", () => {
    expect(classifyPiAiError("429 Too Many Requests")).toBe("rate_limit");
    expect(classifyPiAiError({ message: "max output tokens reached" })).toBe("max_output");
  });
});

