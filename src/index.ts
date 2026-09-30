#!/usr/bin/env bun

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createVoltCrawlServer } from "./server.ts";

async function run(): Promise<void> {
  const server = createVoltCrawlServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

run().catch((error) => {
  console.error("Fatal error running voltcrawl MCP server:", error);
  process.exit(1);
});
