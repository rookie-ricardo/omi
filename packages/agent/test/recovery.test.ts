/**
 * Tests for retry strategy and context overflow recovery
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isRetryableError,
  extractRetryAfterDelay,
  isOverflowError,
} from "@omi/memory";

describe("isRetryableError", () => {
  it("returns true for rate limit errors", () => {
    expect(isRetryableError(new Error("rate limit exceeded"))).toBe(true);
    expect(isRetryableError(new Error("Rate limit: 429"))).toBe(true);
    expect(isRetryableError(new Error("429 Too Many Requests"))).toBe(true);
  });

  it("returns true for overloaded errors", () => {
    expect(isRetryableError(new Error("server overloaded"))).toBe(true);
    expect(isRetryableError(new Error("Service overloaded"))).toBe(true);
  });

  it("returns true for 500 errors", () => {
    expect(isRetryableError(new Error("500 Internal Server Error"))).toBe(true);
    expect(isRetryableError(new Error("502 Bad Gateway"))).toBe(true);
    expect(isRetryableError(new Error("503 Service Unavailable"))).toBe(true);
    expect(isRetryableError(new Error("504 Gateway Timeout"))).toBe(true);
  });

  it("returns true for network errors", () => {
    expect(isRetryableError(new Error("network error"))).toBe(true);
    expect(isRetryableError(new Error("connection refused"))).toBe(true);
    expect(isRetryableError(new Error("fetch failed"))).toBe(true);
    expect(isRetryableError(new Error("timeout"))).toBe(true);
    expect(isRetryableError(new Error("ECONNREFUSED"))).toBe(true);
    expect(isRetryableError(new Error("ETIMEDOUT"))).toBe(true);
    expect(isRetryableError(new Error("socket hang up"))).toBe(true);
  });

  it("returns false for overflow errors", () => {
    // Overflow errors should be handled separately, not retried
    const overflowError = new Error("context length exceeded");
    expect(isRetryableError(overflowError)).toBe(false);
  });

  it("returns false for non-retryable errors", () => {
    expect(isRetryableError(new Error("invalid API key"))).toBe(false);
    expect(isRetryableError(new Error("authentication failed"))).toBe(false);
    expect(isRetryableError(new Error("400 Bad Request"))).toBe(false);
    expect(isRetryableError(new Error("401 Unauthorized"))).toBe(false);
    expect(isRetryableError(new Error("403 Forbidden"))).toBe(false);
    expect(isRetryableError(new Error("404 Not Found"))).toBe(false);
  });
});

describe("extractRetryAfterDelay", () => {
  it("extracts delay in seconds", () => {
    expect(extractRetryAfterDelay(new Error("retry after 5 seconds"))).toBe(5000);
    expect(extractRetryAfterDelay(new Error("retry after 10s"))).toBe(10000);
    expect(extractRetryAfterDelay(new Error("try again in 2 sec"))).toBe(2000);
  });

  it("extracts delay in milliseconds", () => {
    expect(extractRetryAfterDelay(new Error("retry after 500ms"))).toBe(500);
    expect(extractRetryAfterDelay(new Error("wait 200 milliseconds"))).toBe(200);
  });

  it("returns undefined when no delay is specified", () => {
    expect(extractRetryAfterDelay(new Error("rate limit exceeded"))).toBeUndefined();
    expect(extractRetryAfterDelay(new Error("500 error"))).toBeUndefined();
  });

  it("handles various phrasing", () => {
    expect(extractRetryAfterDelay(new Error("Please wait 3 seconds before retrying"))).toBe(3000);
    expect(extractRetryAfterDelay(new Error("Retry delay: 5s"))).toBe(5000);
  });
});

describe("isOverflowError", () => {
  it("identifies context overflow errors", () => {
    expect(isOverflowError(new Error("context length exceeded"))).toBe(true);
    expect(isOverflowError(new Error("maximum context length exceeded"))).toBe(true);
    expect(isOverflowError(new Error("too many tokens"))).toBe(true);
  });

  it("returns false for non-overflow errors", () => {
    expect(isOverflowError(new Error("rate limit exceeded"))).toBe(false);
    expect(isOverflowError(new Error("500 error"))).toBe(false);
    expect(isOverflowError(new Error("network error"))).toBe(false);
  });
});
