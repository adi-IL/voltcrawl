import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { FirecrawlClient } from "../src/client.ts";

/** Every test stubs the network. Nothing here may reach a real host. */

let savedFetch: typeof fetch;

beforeEach(() => {
  savedFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = savedFetch;
});

function stubFetch(handler: () => Response): void {
  globalThis.fetch = (async () => handler()) as unknown as typeof fetch;
}

function newClient(): FirecrawlClient {
  return new FirecrawlClient({ baseUrl: "http://firecrawl.invalid" });
}

describe("FirecrawlClient error bodies", () => {
  test("map reports a non-JSON gateway body instead of a parse error", async () => {
    stubFetch(
      () =>
        new Response("<html><body>502 Bad Gateway</body></html>", {
          status: 502,
          headers: { "content-type": "text/html" },
        }),
    );

    await expect(newClient().map({ url: "https://example.test" })).rejects.toThrow(
      "Invalid JSON response from Firecrawl (HTTP 502): <html><body>502 Bad Gateway</body></html>",
    );
  });

  test("crawl keeps the Firecrawl error message for a valid JSON failure", async () => {
    stubFetch(() =>
      Response.json({ success: false, error: "crawl backlog is full" }, { status: 429 }),
    );

    await expect(newClient().crawl({ url: "https://example.test" })).rejects.toThrow(
      "crawl backlog is full",
    );
  });

  test("getCrawlStatus reports a non-JSON proxy body", async () => {
    stubFetch(
      () =>
        new Response("upstream connect error", {
          status: 503,
          headers: { "content-type": "text/plain" },
        }),
    );

    await expect(newClient().getCrawlStatus("job-1")).rejects.toThrow(
      "Invalid JSON response from Firecrawl (HTTP 503): upstream connect error",
    );
  });

  test("scrape success path is unchanged", async () => {
    stubFetch(() => Response.json({ success: true, data: { markdown: "# hello" } }));

    await expect(newClient().scrape({ url: "https://example.test" })).resolves.toEqual({
      success: true,
      data: { markdown: "# hello" },
    });
  });
});
