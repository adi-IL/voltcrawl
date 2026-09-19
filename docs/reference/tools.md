# Tools Reference

Complete technical specification for all six voltcrawl Model Context Protocol (MCP) tools.

## Tool List

1. [`volt_crawl_scrape`](#volt_crawl_scrape)
2. [`volt_crawl_search`](#volt_crawl_search)
3. [`volt_crawl_research`](#volt_crawl_research)
4. [`volt_crawl_map`](#volt_crawl_map)
5. [`volt_crawl_crawl`](#volt_crawl_crawl)
6. [`volt_crawl_status`](#volt_crawl_status)

---

### `volt_crawl_scrape`

Renders a webpage in headless Chromium. Extracts Markdown, HTML, raw HTML, or structured JSON.

#### Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `url` | string | Yes | | Target webpage URL to render |
| `formats` | string[] | No | `["markdown"]` | Requested output formats: `markdown`, `html`, `rawHtml`, or `json` |
| `onlyMainContent` | boolean | No | `true` | Drops headers, footers, navigation, and sidebar chrome |
| `waitFor` | integer | No | `1000` | Milliseconds to wait for dynamic JavaScript execution (0 to 30000) |
| `jsonPrompt` | string | No | | Natural language prompt for structured data extraction |
| `jsonSchema` | object | No | | JSON Schema constraining structured output |

---

### `volt_crawl_search`

Discovers search candidates using Google Search Grounding. Returns ranked URLs, titles, and snippets without rendering pages.

#### Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `query` | string | Yes | | Search query text |
| `numResults` | integer | No | `5` | Maximum candidate URLs to return (1 to 10) |

---

### `volt_crawl_research`

Resolves natural language research questions to verified evidence packs in a single MCP call.

#### Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `query` | string | Yes | | Research question or intent |
| `numResults` | integer | No | `5` | Candidate search hits to discover (1 to 10) |
| `scrapeTop` | integer | No | `1` | Number of top candidate pages to render in Chromium (1 to 3) |
| `waitFor` | integer | No | `2500` | Milliseconds to wait for JavaScript execution on rendered pages (0 to 30000) |
| `mode` | string | No | `"fast"` | Depth mode: `"fast"` renders top scrapes only; `"survey"` also maps the domain |
| `maxExcerptChars` | integer | No | `4000` | Maximum character length for rendered markdown excerpts (500 to 10000) |

---

### `volt_crawl_map`

Enumerates website links via `sitemap.xml`.

#### Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `url` | string | Yes | | Base domain URL to inspect |
| `search` | string | No | | Optional substring filter for discovered URLs |
| `limit` | integer | No | `50` | Maximum links to return (1 to 1000) |

---

### `volt_crawl_crawl`

Submits an asynchronous recursive crawl job following links from rendered pages.

#### Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `url` | string | Yes | | Starting seed URL for the crawl |
| `limit` | integer | No | `10` | Maximum pages to crawl (1 to 500) |
| `maxDiscoveryDepth` | integer | No | `2` | Maximum link traversal depth from the seed (1 to 10) |

---

### `volt_crawl_status`

Polls crawl job progress or verifies instance readiness.

#### Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `id` | string | No | | Crawl job ID to inspect |
| `includeDocs` | boolean | No | `true` | Formats markdown excerpts of crawled documents |
| `limitDocs` | integer | No | `5` | Maximum documents to display (1 to 50) |
