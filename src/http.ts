#!/usr/bin/env node

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  authorize,
  extractPresentedKey,
  MasterKeyMissingError,
  requireMasterKey,
} from "./auth.ts";
import { createVoltCrawlServer } from "./server.ts";

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

  const server = createVoltCrawlServer();
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
  // This server terminates no TLS. Caddy does, in front of it. The base URL is
  // only used to reconstruct an absolute request URL, so it must always be http
  // or a non-loopback bind produces an https:// URL the server cannot serve.
  // IPv6 literals must be bracketed in a URL authority, so http://::1:8787 is
  // invalid and every request 500s before routing.
  const urlHost = hostname.includes(":") && !hostname.startsWith("[")
    ? `[${hostname}]`
    : hostname;
  const baseUrl = `http://${urlHost}:${port}`;

  const server = createServer((incoming, outgoing) => {
    serveRequest(incoming, outgoing, baseUrl).catch((err: unknown) => {
      // An unhandled rejection here would take the process down, and the only
      // sanctioned way to stop this service is systemctl restart.
      console.error("Unhandled error in HTTP request listener:", err);
      if (!outgoing.headersSent) {
        outgoing.writeHead(500, { "Content-Type": "text/plain" });
        outgoing.end("Internal Server Error");
        return;
      }
      outgoing.destroy(err instanceof Error ? err : new Error(String(err)));
    });
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
  try {
    await dispatch(incoming, outgoing, baseUrl);
  } catch (err) {
    // An oversized or malformed body must not reach the transport.
    if (err instanceof PayloadTooLargeError && !outgoing.headersSent) {
      outgoing.writeHead(err.status, { "Content-Type": "text/plain" });
      outgoing.end("Payload Too Large");
      return;
    }
    throw err;
  }
}

async function dispatch(
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
  // Stream rather than buffer. Buffering would stall SSE responses, and the
  // transport reuses the Response for a JSON or event-stream body.
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    // write() returns false once the socket buffer is full. Ignoring that lets
    // a slow client accumulate the whole stream in Node's memory, so wait for
    // drain, and stop if the client hangs up mid-response.
    if (!outgoing.write(chunk) && !(await waitForDrain(outgoing))) {
      return;
    }
  }
  outgoing.end();
}

function waitForDrain(outgoing: ServerResponse): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (drained: boolean) => {
      outgoing.off("drain", onDrain);
      outgoing.off("close", onClose);
      outgoing.off("error", onError);
      resolve(drained);
    };
    const onDrain = () => done(true);
    const onClose = () => done(false);
    const onError = () => done(false);
    outgoing.on("drain", onDrain);
    outgoing.on("close", onClose);
    outgoing.on("error", onError);
  });
}

/** Cap on a single request body. Research args are small; anything larger is abuse. */
const MAX_BODY_BYTES = 10 * 1024 * 1024;

async function readBody(incoming: IncomingMessage): Promise<Buffer> {
  const declared = Number(incoming.headers["content-length"]);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new PayloadTooLargeError(declared);
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of incoming) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    total += buf.length;
    if (total > MAX_BODY_BYTES) {
      throw new PayloadTooLargeError(total);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

class PayloadTooLargeError extends Error {
  readonly status = 413;
  constructor(readonly bytes: number) {
    super(`Request body of ${bytes} bytes exceeds the ${MAX_BODY_BYTES} byte limit`);
    this.name = "PayloadTooLargeError";
  }
}

main().catch((err) => {
  console.error("Fatal error running voltcrawl HTTP MCP:", err);
  process.exit(1);
});
