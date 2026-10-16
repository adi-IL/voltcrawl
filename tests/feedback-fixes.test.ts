import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createVoltCrawlServer } from "../src/server.ts";
import type { FirecrawlClient } from "../src/client.ts";

describe("Feedback fixes validation", () => {
  test("Fix 1: Extracted JSON is placed BEFORE markdown to prevent truncation", async () => {
    const mockClient = {
      scrape: async () => ({
        success: true,
        data: {
          markdown: "# Massive Page Markdown\n".repeat(500),
          json: { product: "Transformer", layers: 12 },
          metadata: { title: "Test", statusCode: 200 },
        },
      }),
    } as unknown as FirecrawlClient;

    const server = createVoltCrawlServer(mockClient);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(clientTransport);
    const response = await client.callTool({ name: "volt_crawl_scrape", arguments: { url: "https://example.com" } });
    const content = response.content as Array<{ type: string; text: string }>;

    // Extracted structured JSON must be the first content part so large markdown cannot truncate it
    expect(content[0]!.text).toContain("Extracted Structured Data");
    expect(content[0]!.text).toContain('"product": "Transformer"');
    expect(content[1]!.text).toContain("Scraped Content");
    await client.close();
    await server.close();
  });

  test("Fix 2: html and rawHtml are included in scrape response when present", async () => {
    const mockClient = {
      scrape: async () => ({
        success: true,
        data: {
          html: "<html><body><article>Real HTML Content</article></body></html>",
          rawHtml: "<!DOCTYPE html><html><body>Raw HTML Content</body></html>",
          metadata: { title: "HTML Test", statusCode: 200 },
        },
      }),
    } as unknown as FirecrawlClient;

    const server = createVoltCrawlServer(mockClient);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(clientTransport);
    const response = await client.callTool({
      name: "volt_crawl_scrape",
      arguments: { url: "https://example.com", formats: ["html", "rawHtml"] },
    });
    const content = response.content as Array<{ type: string; text: string }>;
    const fullText = content.map((c) => c.text).join("\n");

    expect(fullText).toContain("Real HTML Content");
    expect(fullText).toContain("Raw HTML Content");
    await client.close();
    await server.close();
  });

  test("Fix 3: search parameter in map filters returned links correctly", async () => {
    const mockClient = {
      map: async () => ({
        success: true,
        links: [
          "https://example.com/shoes/running",
          "https://example.com/apparel/shirts",
          "https://example.com/shoes/basketball",
        ],
      }),
    } as unknown as FirecrawlClient;

    const server = createVoltCrawlServer(mockClient);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(clientTransport);
    const response = await client.callTool({ name: "volt_crawl_map", arguments: { url: "https://example.com", search: "shoes" } });
    const content = response.content as Array<{ type: string; text: string }>;
    const text = content[0]!.text;

    expect(text).toContain("Total: 2");
    expect(text).toContain("https://example.com/shoes/running");
    expect(text).toContain("https://example.com/shoes/basketball");
    expect(text).not.toContain("https://example.com/apparel/shirts");
    await client.close();
    await server.close();
  });

  test("Fix 4: crawl status retrieves and formats completed crawl documents", async () => {
    const mockClient = {
      getCrawlStatus: async () => ({
        status: "completed",
        total: 2,
        completed: 2,
        creditsUsed: 2,
        data: [
          {
            url: "https://example.com/page1",
            markdown: "# Page 1 Content\nFull article body here.",
            metadata: { title: "Page 1 Title", statusCode: 200, sourceURL: "https://example.com/page1" },
          },
          {
            url: "https://example.com/page2",
            markdown: "# Page 2 Content\nSecond article body.",
            metadata: { title: "Page 2 Title", statusCode: 200, sourceURL: "https://example.com/page2" },
          },
        ],
      }),
    } as unknown as FirecrawlClient;

    const server = createVoltCrawlServer(mockClient);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(clientTransport);
    const response = await client.callTool({ name: "volt_crawl_status", arguments: { id: "crawl-123" } });
    const content = response.content as Array<{ type: string; text: string }>;
    const text = content[0]!.text;

    expect(text).toContain("Crawl Status (crawl-123)");
    expect(text).toContain("Scraped Documents (2 total, showing first 2)");
    expect(text).toContain("Page 1 Title");
    expect(text).toContain("https://example.com/page1");
    expect(text).toContain("Full article body here.");
    expect(text).toContain("Page 2 Title");
    await client.close();
    await server.close();
  });

  test("Fix 4b: crawl status can skip docs when includeDocs is false", async () => {
    const mockClient = {
      getCrawlStatus: async () => ({
        status: "completed",
        total: 2,
        completed: 2,
        creditsUsed: 2,
        data: [
          {
            url: "https://example.com/page1",
            markdown: "# Page 1 Content",
            metadata: { title: "Page 1 Title", statusCode: 200 },
          },
        ],
      }),
    } as unknown as FirecrawlClient;

    const server = createVoltCrawlServer(mockClient);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(clientTransport);
    const response = await client.callTool({ name: "volt_crawl_status", arguments: { id: "crawl-123", includeDocs: false } });
    const content = response.content as Array<{ type: string; text: string }>;
    const text = content[0]!.text;

    expect(text).toContain("Crawl Status (crawl-123)");
    expect(text).not.toContain("Scraped Documents");
    await client.close();
    await server.close();
  });
});
