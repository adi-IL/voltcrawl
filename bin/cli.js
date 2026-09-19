#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function getVersion() {
  try {
    const pkgPath = resolve(__dirname, "../package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    return pkg.version || "1.0.0";
  } catch {
    return "1.0.0";
  }
}

function printHelp() {
  const version = getVersion();
  console.log(`voltcrawl v${version} - Model Context Protocol (MCP) server for Firecrawl and search grounding

Usage:
  voltcrawl [options]

Transports:
  stdio (default)               Standard input/output for local MCP clients
  --http, -H                    Streamable HTTP transport for remote deployments

Options:
  -H, --http                    Start the server in Streamable HTTP mode
  -p, --port <number>           Port to listen on in HTTP mode (default: 8787 or PORT)
      --host <string>           Host interface to bind in HTTP mode (default: 127.0.0.1 or HOST)
  -v, --version                 Show version number and exit
  -h, --help                    Show this help message and exit

Environment Variables:
  FIRECRAWL_API_URL             URL of the Firecrawl instance (default: http://localhost:3002)
  FIRECRAWL_API_KEY             Optional API key for authenticated Firecrawl instances
  SEARCH_PROXY_URL              URL of search grounding proxy (default: http://localhost:8088)
  MASTER_API_KEY                Required master authentication token when running in HTTP mode
  PORT, MCP_HTTP_PORT           Port to listen on in HTTP mode (default: 8787)
  HOST, MCP_HTTP_HOST           Host interface to bind in HTTP mode (default: 127.0.0.1)

Examples:
  voltcrawl                     Run via stdio (for OpenCode, Claude Desktop, Cursor)
  voltcrawl --http              Run HTTP server on 127.0.0.1:8787
  voltcrawl -H -p 9000          Run HTTP server on 127.0.0.1:9000
  voltcrawl -H --host 0.0.0.0   Run HTTP server on all interfaces`);
}

function printVersion() {
  const version = getVersion();
  console.log(`voltcrawl v${version}`);
}

async function main() {
  const args = process.argv.slice(2);
  let isHttp = false;
  let cliPort = undefined;
  let cliHost = undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    }
    if (arg === "-v" || arg === "--version") {
      printVersion();
      process.exit(0);
    }
    if (arg === "-H" || arg === "--http") {
      isHttp = true;
      continue;
    }
    if (arg === "-p" || arg === "--port") {
      if (i + 1 >= args.length || args[i + 1].startsWith("-")) {
        console.error("Error: --port requires a port number argument.");
        process.exit(1);
      }
      cliPort = args[++i];
      continue;
    }
    if (arg.startsWith("-p=")) {
      cliPort = arg.slice(3);
      continue;
    }
    if (arg.startsWith("--port=")) {
      cliPort = arg.slice(7);
      continue;
    }
    if (arg === "--host") {
      if (i + 1 >= args.length || args[i + 1].startsWith("-")) {
        console.error("Error: --host requires an address argument.");
        process.exit(1);
      }
      cliHost = args[++i];
      continue;
    }
    if (arg.startsWith("--host=")) {
      cliHost = arg.slice(7);
      continue;
    }
    console.error(`Unknown option: ${arg}\nRun 'voltcrawl --help' for usage.`);
    process.exit(1);
  }

  if (cliPort !== undefined) {
    process.env.MCP_HTTP_PORT = cliPort;
    process.env.PORT = cliPort;
  }
  if (cliHost !== undefined) {
    process.env.MCP_HTTP_HOST = cliHost;
    process.env.HOST = cliHost;
  }

  const targetFile = isHttp ? "http.js" : "index.js";
  const distPath = resolve(__dirname, "..", "dist", targetFile);

  if (!existsSync(distPath)) {
    console.error(`Error: voltcrawl build artifact not found at ${distPath}\nRun 'bun run build' or use source entrypoints directly.`);
    process.exit(1);
  }

  await import(distPath);
}

main().catch((err) => {
  console.error("Fatal launcher error:", err);
  process.exit(1);
});
