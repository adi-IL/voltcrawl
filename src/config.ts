/**
 * Centralized configuration loader for voltcrawl.
 */
export interface VoltCrawlConfig {
  readonly firecrawlApiUrl: string;
  readonly firecrawlApiKey: string;
  readonly searchProxyUrl: string;
  readonly mcpHttpPort: number;
  readonly mcpHttpHost: string;
  readonly masterApiKey?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): VoltCrawlConfig {
  const rawPort = env.PORT || env.MCP_HTTP_PORT || "8787";
  const mcpHttpPort = parseInt(rawPort, 10);
  return {
    firecrawlApiUrl: (env.FIRECRAWL_API_URL || "http://localhost:3002").replace(/\/+$/, ""),
    firecrawlApiKey: env.FIRECRAWL_API_KEY || "",
    searchProxyUrl: (env.SEARCH_PROXY_URL || env.VERTEX_PROXY_URL || "http://localhost:8088").replace(/\/+$/, ""),
    mcpHttpPort: isNaN(mcpHttpPort) ? 8787 : mcpHttpPort,
    mcpHttpHost: env.HOST || env.MCP_HTTP_HOST || "127.0.0.1",
    masterApiKey: env.MASTER_API_KEY,
  };
}
