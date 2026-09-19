import { z } from "zod";

export const ScrapeToolSchema = {
  url: z.string().url().describe("The URL of the webpage to scrape"),
  formats: z
    .array(z.enum(["markdown", "html", "rawHtml", "json"]))
    .optional()
    .default(["markdown"])
    .describe("Requested output formats (default: ['markdown']). Use ['json'] for standalone structured extraction without markdown."),
  onlyMainContent: z
    .boolean()
    .optional()
    .default(true)
    .describe("Exclude headers, footers, and sidebars to return only main article content"),
  waitFor: z
    .number()
    .int()
    .min(0)
    .max(30000)
    .optional()
    .default(1000)
    .describe("Milliseconds to wait for dynamic JavaScript execution (default: 1000)"),
  jsonPrompt: z
    .string()
    .optional()
    .describe("Natural language extraction prompt for structured JSON"),
  jsonSchema: z
    .record(z.any())
    .optional()
    .describe("Optional JSON Schema defining the exact shape of structured data to extract"),
};

export const MapToolSchema = {
  url: z.string().url().describe("Base domain URL to map via sitemap.xml. Use crawl for non-sitemap sites."),
  search: z.string().optional().describe("Optional search keyword to filter discovered URLs"),
  limit: z.number().int().min(1).max(1000).optional().default(50).describe("Maximum number of links to return (default: 50)"),
};

export const CrawlToolSchema = {
  url: z.string().url().describe("The starting URL for recursive crawling"),
  limit: z.number().int().min(1).max(500).optional().default(10).describe("Maximum pages to crawl (default: 10)"),
  maxDiscoveryDepth: z.number().int().min(1).max(10).optional().default(2).describe("Maximum link discovery depth (default: 2)"),
};

export const StatusToolSchema = {
  id: z.string().optional().describe("Optional crawl job ID. If omitted, checks overall instance health and readiness"),
  includeDocs: z.boolean().optional().default(true).describe("Whether to include scraped documents for completed crawl jobs (default: true)"),
  limitDocs: z.number().int().min(1).max(50).optional().default(5).describe("Maximum number of scraped documents to return in status response (default: 5)"),
};

export const SearchToolSchema = {
  query: z
    .string()
    .min(1)
    .describe("Natural language search query. Returns ranked URLs. Scrape a hit with volt_crawl_scrape."),
  numResults: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .default(5)
    .describe("Number of URLs to return (default 5, max 10)"),
};

export const ResearchToolSchema = {
  query: z
    .string()
    .min(1)
    .describe("Vague research intent. Resolves to search candidates plus rendered evidence from top scrapes."),
  numResults: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .default(5)
    .describe("Number of search candidates to discover (default 5, max 10)"),
  scrapeTop: z
    .number()
    .int()
    .min(1)
    .max(3)
    .optional()
    .default(1)
    .describe("How many top candidate pages to render (default 1, max 3)"),
  waitFor: z
    .number()
    .int()
    .min(0)
    .max(30000)
    .optional()
    .default(2500)
    .describe("Milliseconds to wait for dynamic JavaScript when rendering top hits (default 2500)"),
  mode: z
    .enum(["fast", "survey"])
    .optional()
    .default("fast")
    .describe("Depth mode: fast renders top scrapes only; survey also maps the top domain (limit 10) and appends discovered/deduped/challenge counts (default fast)"),
  maxExcerptChars: z
    .number()
    .int()
    .min(500)
    .max(10000)
    .optional()
    .describe("Maximum character length for rendered markdown excerpts (default 4000, min 500, max 10000)"),
};

export type ToolErrorCode =
  | "RATE_LIMITED"
  | "BLOCKED"
  | "TIMEOUT"
  | "NOT_FOUND"
  | "UPSTREAM_ERROR"
  | "NETWORK_ERROR";

export interface ToolErrorDetail {
  code: ToolErrorCode;
  message: string;
  target?: string;
  retryable: boolean;
}

