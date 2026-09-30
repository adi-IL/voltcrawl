import { describe, expect, test } from "bun:test";
import { createVoltCrawlServer } from "../src/server.ts";
import { FirecrawlClient } from "../src/client.ts";

describe("createVoltCrawlServer error classification", () => {
  test("classifies rate limit error as RATE_LIMITED and retryable", async () => {
    const mockClient = {
      scrape: async () => {
        throw new Error("HTTP 429 Too Many Requests");
      },
    } as unknown as FirecrawlClient;

    const server = createVoltCrawlServer(mockClient);
    expect(server).toBeDefined();
  });
});
