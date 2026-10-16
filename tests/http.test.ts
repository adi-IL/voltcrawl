import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";

/**
 * Boots the real HTTP transport in a child process and drives it over a socket,
 * so the order of auth and body parsing is observed on the wire rather than
 * asserted against an in-process handler.
 */

const SERVER_ENTRY = join(import.meta.dir, "..", "src", "http.ts");
const MASTER_KEY = "test-key";
const READY_TIMEOUT_MS = 10_000;

// Assigned in beforeAll, once a free port has been probed.
let PORT = 0;
let BASE_URL = "";
const BIG_BODY = "x".repeat(11 * 1024 * 1024);
const MCP_HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};
const INITIALIZE_BODY = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "http-test", version: "1.0.0" },
  },
});

let child: ReturnType<typeof Bun.spawn> | undefined;
let childStderr = "";

async function waitForHealth(): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/healthz`);
      if (response.ok) {
        return;
      }
    } catch {
      // Not listening yet.
    }
    await Bun.sleep(100);
  }
  throw new Error(
    `HTTP MCP server did not become healthy within ${READY_TIMEOUT_MS}ms; stderr: ${childStderr}`,
  );
}

/**
 * A fixed port can collide with a process that already holds it, which would
 * make waitForHealth talk to a stranger. Probe candidates with a temporary
 * listener and release the first one that binds.
 */
async function findFreePort(): Promise<number> {
  // Never 8787 (the deployed unit), 3002 (Firecrawl), or 8088 (Vertex proxy).
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = 39_000 + Math.floor(Math.random() * 1_000);
    try {
      const probe = Bun.serve({
        hostname: "127.0.0.1",
        port: candidate,
        fetch: () => new Response(null, { status: 204 }),
      });
      await probe.stop();
      return candidate;
    } catch {
      // Already held; try another candidate.
    }
  }
  throw new Error(
    "Could not find a free port in 39000-39999 after 20 attempts",
  );
}

beforeAll(async () => {
  PORT = await findFreePort();
  BASE_URL = `http://127.0.0.1:${PORT}`;
  child = Bun.spawn(["bun", "run", SERVER_ENTRY], {
    env: {
      ...process.env,
      MASTER_API_KEY: MASTER_KEY,
      MCP_HTTP_HOST: "127.0.0.1",
      MCP_HTTP_PORT: String(PORT),
    },
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });
  if (child.stderr instanceof ReadableStream) {
    void new Response(child.stderr)
      .text()
      .then((text) => {
        childStderr = text;
      })
      .catch(() => {});
  }
  try {
    await waitForHealth();
  } catch (err) {
    child.kill();
    throw err;
  }
}, 30_000);

afterAll(async () => {
  if (child === undefined || child.exitCode !== null) {
    return;
  }
  child.kill();
  await child.exited;
});

setDefaultTimeout(30_000);

describe("HTTP MCP authentication happens before the body is read", () => {
  test("an unauthenticated oversized POST is rejected with 401, not 413", async () => {
    const response = await fetch(`${BASE_URL}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: BIG_BODY,
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
  });

  test("an authenticated oversized POST still reports 413", async () => {
    const response = await fetch(`${BASE_URL}/mcp`, {
      method: "POST",
      headers: { ...MCP_HEADERS, authorization: `Bearer ${MASTER_KEY}` },
      body: BIG_BODY,
    });

    expect(response.status).toBe(413);
    expect(await response.text()).toBe("Payload Too Large");
  });

  test("a small POST without credentials is 401", async () => {
    const response = await fetch(`${BASE_URL}/mcp`, {
      method: "POST",
      headers: MCP_HEADERS,
      body: INITIALIZE_BODY,
    });

    expect(response.status).toBe(401);
  });

  test("a small POST with the wrong bearer is 401", async () => {
    const response = await fetch(`${BASE_URL}/mcp`, {
      method: "POST",
      headers: { ...MCP_HEADERS, authorization: "Bearer not-the-key" },
      body: INITIALIZE_BODY,
    });

    expect(response.status).toBe(401);
  });

  test("initialize with the master key returns server info", async () => {
    const response = await fetch(`${BASE_URL}/mcp`, {
      method: "POST",
      headers: { ...MCP_HEADERS, authorization: `Bearer ${MASTER_KEY}` },
      body: INITIALIZE_BODY,
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      result?: { serverInfo?: { name?: string } };
    };
    expect(payload.result?.serverInfo?.name).toBe("voltcrawl");
  });
});
