import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FirecrawlClient } from "./client.ts";
import { runResearch } from "./research.ts";
import { formatSearchHits, searchGoogle } from "./search.ts";
import {
  CrawlToolSchema,
  MapToolSchema,
  ResearchToolSchema,
  ScrapeToolSchema,
  SearchToolSchema,
  StatusToolSchema,
  ToolErrorCode,
  ToolErrorDetail,
} from "./types.ts";

export function classifyError(err: unknown, target?: string): ToolErrorDetail {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  let code: ToolErrorCode = "UPSTREAM_ERROR";
  let retryable = false;

  if (lower.includes("429") || lower.includes("rate limit") || lower.includes("too many requests")) {
    code = "RATE_LIMITED";
    retryable = true;
  } else if (lower.includes("403") || lower.includes("cloudflare") || lower.includes("blocked") || lower.includes("captcha") || lower.includes("blocking automated access") || lower.includes("scraping engines failed") || lower.includes("access denied") || lower.includes("akamai") || lower.includes("edgesuite") || lower.includes("just a moment") || lower.includes("robot check")) {
    code = "BLOCKED";
    retryable = false;
  } else if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("abort")) {
    code = "TIMEOUT";
    retryable = true;
  } else if (lower.includes("404") || lower.includes("not found")) {
    code = "NOT_FOUND";
    retryable = false;
  } else if (lower.includes("econnrefused") || lower.includes("fetch failed") || lower.includes("connection error")) {
    code = "NETWORK_ERROR";
    retryable = true;
  }

  return { code, message: msg, target, retryable };
}

function formatErrorResponse(action: string, detail: ToolErrorDetail) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: `[${detail.code}] ${action} failed: ${detail.message}\nRetryable: ${detail.retryable ? "Yes" : "No"}${detail.target ? `\nTarget: ${detail.target}` : ""}`,
      },
    ],
  };
}
function formatLinkItem(item: unknown): string {
  if (typeof item === "string") {
    return item;
  }
  if (item && typeof item === "object" && "url" in item && typeof item.url === "string") {
    return item.url;
  }
  return JSON.stringify(item);
}

export function createVoltCrawledServer(
  client: FirecrawlClient = new FirecrawlClient(),
): McpServer {
  const server = new McpServer({
    name: "voltcrawl",
    version: "1.0.0",
  });

  server.tool(
    "volt_crawl_scrape",
    "Scrape a webpage and convert it to clean markdown or structured JSON using headless Chromium",
    ScrapeToolSchema,
    async (args) => {
      try {
        const result = await client.scrape(args);
        const textParts: { type: "text"; text: string }[] = [];
        // 1. Extracted structured JSON first so large markdown does not truncate it
        if (result.data?.json) {
          textParts.push({
            type: "text",
            text: `### Extracted Structured Data\n\n\`\`\`json\n${JSON.stringify(
              result.data.json,
              null,
              2,
            )}\n\`\`\``,
          });
        }

        // 2. Scraped Markdown
        if (result.data?.markdown) {
          textParts.push({
            type: "text",
            text: `### Scraped Content (${args.url})\n\n${result.data.markdown}`,
          });
        }

        // 3. Scraped HTML if requested
        if (result.data?.html) {
          textParts.push({
            type: "text",
            text: `### Scraped HTML (${args.url})\n\n${result.data.html}`,
          });
        }

        // 4. Scraped Raw HTML if requested
        if (result.data?.rawHtml) {
          textParts.push({
            type: "text",
            text: `### Scraped Raw HTML (${args.url})\n\n${result.data.rawHtml}`,
          });
        }

        // 5. Metadata
        if (result.data?.metadata) {
          textParts.push({
            type: "text",
            text: `### Metadata\n- Title: ${result.data.metadata.title || "N/A"}\n- Status: ${
              result.data.metadata.statusCode
            }\n- Source: ${result.data.metadata.sourceURL || args.url}`,
          });
        }
        return {
          content:
            textParts.length > 0
              ? textParts
              : [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return formatErrorResponse("Scrape", classifyError(err, args.url));
      }
    },
  );

  server.tool(
    "volt_crawl_map",
    "Discover links from a sitemap when one exists. JS sites without a sitemap return zero links. Use crawl for those.",
    MapToolSchema,
    async (args) => {
      try {
        const result = await client.map(args);
        let links = Array.isArray(result.links) ? result.links : [];

        // Client-side search filter so sitemap entries actually match the query
        if (typeof args.search === "string" && args.search.trim().length > 0) {
          const q = args.search.trim().toLowerCase();
          links = links.filter((link: unknown) => {
            const str = formatLinkItem(link);
            return str.toLowerCase().includes(q);
          });
        }

        const formattedLinks = links
          .slice(0, 100)
          .map((link: unknown) => `- ${formatLinkItem(link)}`)
          .join("\n");

        return {
          content: [
            {
              type: "text",
              text:
                `### Discovered Links for ${args.url} (Total: ${links.length})\n\n` +
                formattedLinks +
                (links.length > 100
                  ? `\n...and ${links.length - 100} more links.`
                  : ""),
            },
          ],
        };
      } catch (err) {
        return formatErrorResponse("Map", classifyError(err, args.url));
      }
    },
  );

  server.tool(
    "volt_crawl_crawl",
    "Initiate an asynchronous recursive crawl of a website",
    CrawlToolSchema,
    async (args) => {
      try {
        const result = await client.crawl(args);
        return {
          content: [
            {
              type: "text",
              text: `### Crawl Initiated\n- Crawl ID: ${result.id}\n- Polling URL: ${result.url}\n\nUse volt_crawl_status with ID '${result.id}' to inspect progress.`,
            },
          ],
        };
      } catch (err) {
        return formatErrorResponse("Crawl", classifyError(err, args.url));
      }
    },
  );

  server.tool(
    "volt_crawl_search",
    "Web search via Google Search Grounding. Returns ranked URLs and snippets. Does not render pages. Use volt_crawl_scrape on a URL you want rendered.",
    SearchToolSchema,
    async (args) => {
      try {
        const hits = await searchGoogle(args.query, args.numResults ?? 5);
        return {
          content: [{ type: "text", text: formatSearchHits(args.query, hits) }],
        };
      } catch (err) {
        return formatErrorResponse("Search", classifyError(err, args.query));
      }
    },
  );

  server.tool(
    "volt_crawl_status",
    "Check crawl job progress or verify service readiness",
    StatusToolSchema,
    async (args) => {
      try {
        if (args.id) {
          const result = await client.getCrawlStatus(args.id);
          const parts: string[] = [
            `### Crawl Status (${args.id})\n- Status: ${result.status}\n- Total: ${result.total}\n- Completed: ${result.completed}\n- Credits Used: ${result.creditsUsed}`,
          ];

          const docs = Array.isArray(result.data) ? result.data : [];
          if (docs.length > 0 && args.includeDocs !== false) {
            const limit = Math.min(args.limitDocs ?? 5, docs.length);
            parts.push(`\n### Scraped Documents (${docs.length} total, showing first ${limit}):\n`);
            for (let i = 0; i < limit; i++) {
              const doc = docs[i];
              const docMeta = doc && typeof doc === "object" && "metadata" in doc && doc.metadata && typeof doc.metadata === "object" ? doc.metadata : {};
              const docTitle = "title" in docMeta && typeof docMeta.title === "string" ? docMeta.title : "Untitled";
              const docUrl = "sourceURL" in docMeta && typeof docMeta.sourceURL === "string" ? docMeta.sourceURL : ("url" in doc && typeof doc.url === "string" ? doc.url : `Doc ${i + 1}`);
              const docStatus = "statusCode" in docMeta && docMeta.statusCode ? ` [HTTP ${docMeta.statusCode}]` : "";
              const docMarkdown = doc && typeof doc === "object" && "markdown" in doc && typeof doc.markdown === "string" ? doc.markdown : "";
              const docExcerpt = docMarkdown.length > 0 ? (docMarkdown.length > 500 ? docMarkdown.slice(0, 500) + "..." : docMarkdown) : "(no markdown)";
              parts.push(`#### ${i + 1}. [${docTitle}](${docUrl})${docStatus}\n${docExcerpt}\n`);
            }
          }

          return {
            content: [
              {
                type: "text",
                text: parts.join("\n"),
              },
            ],
          };
        }

        const health = await client.checkHealth();
        return {
          content: [
            {
              type: "text",
              text: `### Firecrawl Instance Health\n- Target Endpoint: ${health.url}\n- Status: ${health.status}\n- Ready: ${health.ready ? "Yes" : "No"}`,
            },
          ],
        };
      } catch (err) {
        return formatErrorResponse("Status", classifyError(err, args.id));
      }
    },
  );

  server.tool(
    "volt_crawl_research",
    "Resolve vague research intent to rendered evidence in one call. Exa discovers ranked candidates, but do not trust or cite search snippets — they are discovery signal only, not fact. Firecrawl renders the top hits and returns quoted lines with source URL, title, and status; cite only rendered evidence as the source of truth.",
    ResearchToolSchema,
    async (args) => {
      try {
        const text = await runResearch(client, {
          query: args.query,
          numResults: args.numResults ?? 5,
          scrapeTop: args.scrapeTop ?? 1,
          waitFor: args.waitFor ?? 2500,
          mode: args.mode ?? "fast",
          maxExcerptChars: args.maxExcerptChars,
        });
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return formatErrorResponse("Research", classifyError(err, args.query));
      }
    },
  );

  return server;
}
