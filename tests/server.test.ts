import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createVoltCrawlServer } from "../src/server.ts";
import type { FirecrawlClient } from "../src/client.ts";

describe("createVoltCrawlServer rate limit classification", () => {
  test("classifies rate limit error as RATE_LIMITED and retryable", async () => {
    const mockClient = {
      scrape: async () => {
        throw new Error("HTTP 429 Too Many Requests");
      },
    } as unknown as FirecrawlClient;

    const server = createVoltCrawlServer(mockClient);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(clientTransport);
    const response = await client.callTool({ name: "volt_crawl_scrape", arguments: { url: "https://example.com" } });
    const content = response.content as Array<{ type: string; text: string }>;
    expect(response.isError).toBe(true);
    expect(content[0]?.text).toContain("[RATE_LIMITED]");
    expect(content[0]?.text).toContain("Retryable: Yes");
    await client.close();
    await server.close();
  });
});
