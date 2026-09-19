#!/usr/bin/env bun

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  authorize,
  extractPresentedKey,
  MasterKeyMissingError,
  requireMasterKey,
} from "./auth.ts";
import { createVoltCrawledServer } from "./server.ts";

function unauthorized(): Response {
  return new Response("unauthorized", {
    status: 401,
    headers: { "www-authenticate": "Bearer" },
  });
}

async function handleMcp(request: Request): Promise<Response> {
  const master = requireMasterKey();
  const presented = extractPresentedKey(request.headers);
  const result = authorize(presented, master);
  if (!result.ok) {
    return unauthorized();
  }

  const server = createVoltCrawledServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}

async function main(): Promise<void> {
  try {
    requireMasterKey();
  } catch (err) {
    if (err instanceof MasterKeyMissingError) {
      console.error("MASTER_API_KEY is required for the remote MCP server");
      process.exit(1);
    }
    throw err;
  }

  const port = Number(process.env.MCP_HTTP_PORT ?? "8787");
  const hostname = process.env.MCP_HTTP_HOST ?? "127.0.0.1";

  Bun.serve({
    hostname,
    port,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/healthz") {
        return new Response("ok", { status: 200 });
      }
      if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
        return handleMcp(request);
      }
      return new Response("not found", { status: 404 });
    },
  });

  console.error(`voltcrawl HTTP MCP listening on ${hostname}:${port}`);
}

main().catch((err) => {
  console.error("Fatal error running voltcrawl HTTP MCP:", err);
  process.exit(1);
});
