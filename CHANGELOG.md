# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-09-20

### Added

- Initial open-source release of `voltcrawl`.
- Six Model Context Protocol (MCP) tools for coding agents:
  - `volt_crawl_scrape`: Headless Chromium rendering supporting Markdown, HTML, raw HTML, and structured JSON extraction.
  - `volt_crawl_search`: Web search candidate discovery returning ranked URLs and snippets.
  - `volt_crawl_research`: Multi-step evidence synthesis combining search candidate discovery, Chromium rendering, deterministic DOM noise filtering, and quoted proof line extraction.
  - `volt_crawl_map`: Sitemap link discovery with substring filtering.
  - `volt_crawl_crawl`: Asynchronous recursive website crawling with depth and limit controls.
  - `volt_crawl_status`: Crawl job polling and Firecrawl instance health checks.
- Dual MCP transports:
  - Stdio transport for local processes (`npx voltcrawl`, `bunx voltcrawl`).
  - Streamable HTTP transport with bearer token authentication for remote deployments (`voltcrawl --http`).
- CLI binary `voltcrawl` declared in `package.json`.
- Deterministic DOM noise filtering:
  - Automatic removal of OneTrust banners, cookie dialogs, ad-block notices, and navigation carousels.
  - Retention of author bylines, publication timestamps, data tables, code blocks, and primary body text.
- Truth contract enforcement:
  - Clear separation between search index snippets (discovery signal only) and rendered Chromium output (authoritative evidence).
  - Verbatim proof line extraction requiring substantive lines of 20 characters or more.
- Structured error classification:
  - Explicit error codes: `RATE_LIMITED`, `BLOCKED`, `TIMEOUT`, `NOT_FOUND`, `NETWORK_ERROR`, and `UPSTREAM_ERROR`.
  - Machine-readable `retryable` flags and target URLs in error responses.
- Comprehensive test suite running 100% offline without external network or credential dependencies.
