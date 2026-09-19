import { describe, expect, test } from "bun:test";
import { classifyError } from "../src/server.ts";

describe("classifyError", () => {
  test.each([
    ["Reddit is blocking automated access to this page"],
    ["All scraping engines failed for https://www.reddit.com/r/test/"],
    ["Access Denied (akamai edge)"],
    ["Akamai EdgeSuite challenge at /r/test/comments"],
    ["Just a moment... verifying you are human"],
    ["Robot check: please verify you are not a bot"],
    ["HTTP 403 Forbidden"],
    ["Cloudflare challenge failed"],
    ["Page blocked by antibot"],
    ["captcha required"],
  ])("classifies %p as BLOCKED non-retryable", (message) => {
    const detail = classifyError(new Error(message));
    expect(detail.code).toBe("BLOCKED");
    expect(detail.retryable).toBe(false);
    expect(detail.message).toBe(message);
  });

  test("Reddit-style message with 'not found' still classifies BLOCKED, not NOT_FOUND", () => {
    const detail = classifyError(
      new Error("Reddit blocking automated access: page not found for bots"),
    );
    expect(detail.code).toBe("BLOCKED");
    expect(detail.retryable).toBe(false);
  });

  test("preserves target passthrough", () => {
    const detail = classifyError(new Error("akamai blocked"), "https://x.example");
    expect(detail.target).toBe("https://x.example");
  });

  test("classifies rate limit as RATE_LIMITED retryable", () => {
    for (const message of ["HTTP 429", "rate limit exceeded", "Too Many Requests"]) {
      const detail = classifyError(new Error(message));
      expect(detail.code).toBe("RATE_LIMITED");
      expect(detail.retryable).toBe(true);
    }
  });

  test("classifies timeout as TIMEOUT retryable", () => {
    for (const message of ["timeout after 30s", "timed out waiting", "request abort"]) {
      const detail = classifyError(new Error(message));
      expect(detail.code).toBe("TIMEOUT");
      expect(detail.retryable).toBe(true);
    }
  });

  test("classifies missing page as NOT_FOUND non-retryable", () => {
    for (const message of ["HTTP 404", "page not found"]) {
      const detail = classifyError(new Error(message));
      expect(detail.code).toBe("NOT_FOUND");
      expect(detail.retryable).toBe(false);
    }
  });

  test("classifies connection failure as NETWORK_ERROR retryable", () => {
    for (const message of ["ECONNREFUSED 127.0.0.1:3002", "fetch failed", "connection error reset"]) {
      const detail = classifyError(new Error(message));
      expect(detail.code).toBe("NETWORK_ERROR");
      expect(detail.retryable).toBe(true);
    }
  });

  test("falls back to UPSTREAM_ERROR non-retryable", () => {
    const detail = classifyError(new Error("weird unknown failure"));
    expect(detail.code).toBe("UPSTREAM_ERROR");
    expect(detail.retryable).toBe(false);
  });
});
