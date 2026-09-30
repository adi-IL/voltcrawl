#!/usr/bin/env node

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
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

  const port = Number(process.env.MCP_HTTP_PORT ?? process.env.PORT ?? "8787");
  const hostname = process.env.MCP_HTTP_HOST ?? process.env.HOST ?? "127.0.0.1";
  const scheme = hostname === "127.0.0.1" || hostname === "::1" || hostname === "localhost" ? "http" : "https";

  const server = createServer((incoming, outgoing) => {
    void serveRequest(incoming, outgoing, `${scheme}://${hostname}:${port}`);
  });
  server.listen(port, hostname, () => {
    console.error(`voltcrawl HTTP MCP listening on ${hostname}:${port}`);
  });
}

async function route(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/healthz") {
    return new Response("ok", { status: 200 });
  }
  if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
    return handleMcp(request);
  }
  return new Response("not found", { status: 404 });
}

async function serveRequest(
  incoming: IncomingMessage,
  outgoing: ServerResponse,
  baseUrl: string,
): Promise<void> {
  const body =
    incoming.method === "GET" || incoming.method === "HEAD"
      ? undefined
      : await readBody(incoming);
  const request = new Request(new URL(incoming.url ?? "/", baseUrl).toString(), {
    method: incoming.method,
    headers: incoming.headers as Record<string, string>,
    ...(body === undefined ? {} : { body }),
  });
  const response = await route(request);
  outgoing.writeHead(response.status, Object.fromEntries(response.headers));
  if (response.body === null) {
    outgoing.end();
    return;
  }
  outgoing.end(Buffer.from(await response.arrayBuffer()));
}

async function readBody(incoming: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of incoming) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks);
}

main().catch((err) => {
  console.error("Fatal error running voltcrawl HTTP MCP:", err);
  process.exit(1);
});
