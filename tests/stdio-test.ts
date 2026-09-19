/**
 * Stdio JSON-RPC integration test for voltcrawl MCP server.
 */

import { spawn } from "child_process";
import path from "path";

async function runTest() {
  console.log("==> Spawning voltcrawl MCP server via Bun...");

  const packageDir = path.resolve(import.meta.dir, "..");
  const proc = spawn("bun", ["run", "src/index.ts"], {
    cwd: packageDir,
    env: { ...process.env, FIRECRAWL_API_URL: "http://localhost:3002" },
    stdio: ["pipe", "pipe", "inherit"],
  });

  let buffer = "";

  const send = (msg: unknown) => {
    const raw = JSON.stringify(msg) + "\n";
    proc.stdin.write(raw);
  };

  proc.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
  });

  send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    },
  });

  await new Promise((r) => setTimeout(r, 600));

  send({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  });
  send({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {},
  });

  await new Promise((r) => setTimeout(r, 800));
  send({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "volt_crawl_status",
      arguments: {},
    },
  });

  await new Promise((r) => setTimeout(r, 1500));

  proc.stdin.end();
  proc.kill();

  const lines = buffer
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  console.log(`Received ${lines.length} JSON-RPC responses from server:`);
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      console.log(`- Response ID ${parsed.id}:`, parsed.result ? "SUCCESS" : parsed.error || "NOTIFICATION");
      if (parsed.id === 2) {
        const tools = Array.isArray(parsed.result?.tools)
          ? parsed.result.tools.map((t: { name?: string }) => t.name ?? "")
          : [];
        console.log("  Registered tools:", tools.join(", "));
      }
      if (parsed.id === 3) {
        console.log("  Health tool result:", parsed.result?.content?.[0]?.text);
      }
    } catch {
      console.log("  Raw non-JSON line:", line);
    }
  }

  const listResp = lines.find((l) => {
    try {
      return JSON.parse(l).id === 2;
    } catch {
      return false;
    }
  });

  if (!listResp) {
    throw new Error("Failed to receive tools/list response");
  }

  const parsedList = JSON.parse(listResp);
  const toolNames: string[] = Array.isArray(parsedList.result?.tools)
    ? parsedList.result.tools.map((t: { name: string }) => t.name)
    : [];
  const expectedTools = [
    "volt_crawl_scrape",
    "volt_crawl_map",
    "volt_crawl_crawl",
    "volt_crawl_search",
    "volt_crawl_status",
    "volt_crawl_research",
  ];
  const missingTools = expectedTools.filter((name) => !toolNames.includes(name));
  if (missingTools.length > 0 || toolNames.length !== expectedTools.length) {
    throw new Error(
      `Expected ${expectedTools.length} tools (${expectedTools.join(", ")}), but received ${toolNames.length}: ${toolNames.join(", ")} (missing: ${missingTools.join(", ")})`
    );
  }

  console.log("==> All MCP stdio tests passed!");
}

runTest().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
