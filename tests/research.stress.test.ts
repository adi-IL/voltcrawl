import { describe, expect, test } from "bun:test";
import {
  buildEvidence,
  buildFailedEvidence,
  formatResearchPack,
  runResearch,
  type ResearchOptions,
} from "../src/research.ts";
import type { FirecrawlClient } from "../src/client.ts";
import type { SearchHit } from "../src/search.ts";

const hit = (url: string, title = url, snippet = "snippet"): SearchHit => ({
  url,
  title,
  snippet,
});

const opts = (overrides: Partial<ResearchOptions> = {}): ResearchOptions => ({
  query: "stress query",
  numResults: 5,
  scrapeTop: 3,
  waitFor: 0,
  ...overrides,
});

function stubClient(
  handler: (url: string) => unknown | Promise<unknown>,
  onCall?: (url: string) => void,
): FirecrawlClient {
  return {
    scrape: async (params: { url: string }) => {
      onCall?.(params.url);
      const out = await handler(params.url);
      if (out instanceof Error) throw out;
      return out;
    },
  } as unknown as FirecrawlClient;
}

const okPayload = (
  markdown: string,
  meta: { sourceURL: string; title: string; statusCode?: number },
) => ({
  data: { markdown, metadata: { ...meta } },
});

function candidateCount(pack: string): number {
  return pack.match(/^\d+\. \[/gm)?.length ?? 0;
}

function evidenceCount(pack: string): number {
  return pack.match(/^- Source: /gm)?.length ?? 0;
}

describe("research stress", () => {
  test("empty hits: no-results pack, scrape never called, no throw", async () => {
    let calls = 0;
    const client = stubClient(() => {
      throw new Error("scrape must not run on empty hits");
    }, () => {
      calls += 1;
    });
    const pack = await runResearch(client, opts(), async () => []);
    expect(calls).toBe(0);
    expect(pack).toContain("No results.");
    expect(candidateCount(pack)).toBe(0);
    expect(evidenceCount(pack)).toBe(0);
    expect(formatResearchPack("q", [], [])).toContain("No results.");
  });

  test("all scrapes fail: placeholders keep pack aligned, provenance no-redirect unknown-status", async () => {
    const hits = [hit("https://a.example/1", "A"), hit("https://b.example/2", "B")];
    const client = stubClient(() => new Error("boom"));
    const pack = await runResearch(client, opts({ scrapeTop: 2 }), async () => hits);
    expect(candidateCount(pack)).toBe(2);
    expect(evidenceCount(pack)).toBe(2);
    expect(pack.match(/Scrape failed: boom/g)?.length).toBe(2);
    expect(pack.match(/redirect no/g)?.length).toBe(2);
    expect(pack.match(/status unknown/g)?.length).toBe(2);
    for (const h of hits) {
      const failed = buildFailedEvidence(h.url, h.title, "boom");
      expect(failed.redirected).toBe(false);
      expect(failed.mismatch).toBe(true);
      expect(failed.quotes).toEqual([]);
    }
  });

  test("redirect chain: final URL flagged, pack provenance says redirect yes", async () => {
    const requested = "https://short.example/abc";
    const final = "https://final.example/page";
    const hits = [hit(requested, "Short")];
    const client = stubClient(() =>
      okPayload("rendered body\nsecond line", {
        sourceURL: final,
        title: "Final Page",
        statusCode: 200,
      }),
    );
    const pack = await runResearch(client, opts({ scrapeTop: 1 }), async () => hits);
    expect(candidateCount(pack)).toBe(1);
    expect(evidenceCount(pack)).toBe(1);
    expect(pack).toContain(`- Source: ${final}`);
    expect(pack).toContain(
      `- Provenance: final URL ${final}, redirect yes, status 200`,
    );
    const direct = buildEvidence({
      url: final,
      title: "Final Page",
      status: 200,
      markdown: "body",
      requestedUrl: requested,
    });
    expect(direct.redirected).toBe(true);
    expect(direct.requestedUrl).toBe(requested);
    expect(direct.mismatch).toBe(false);
  });

  test("duplicate URLs: both candidates rendered in order, no dedupe throw", async () => {
    const url = "https://dup.example/page";
    const hits = [hit(url, "First"), hit(url, "Second")];
    const client = stubClient(() =>
      okPayload("shared body", {
        sourceURL: url,
        title: "Dup",
        statusCode: 200,
      }),
    );
    const pack = await runResearch(client, opts({ scrapeTop: 2 }), async () => hits);
    expect(candidateCount(pack)).toBe(2);
    expect(evidenceCount(pack)).toBe(2);
    expect(pack.match(new RegExp(`- Source: ${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g"))?.length).toBe(2);
  });

  test("non-200 statuses: mismatch flagged, status surfaced in pack", async () => {
    const hits = [hit("https://gone.example/404", "Gone"), hit("https://err.example/500", "Err")];
    const statuses = [404, 500];
    const client = stubClient((url) =>
      okPayload("error body", {
        sourceURL: url,
        title: url.includes("404") ? "Gone" : "Err",
        statusCode: url.includes("404") ? 404 : 500,
      }),
    );
    const pack = await runResearch(client, opts({ scrapeTop: 2 }), async () => hits);
    expect(candidateCount(pack)).toBe(2);
    expect(evidenceCount(pack)).toBe(2);
    for (const status of statuses) {
      expect(pack).toContain(`- Status: ${status}`);
    }
    for (const [i, url] of ["https://gone.example/404", "https://err.example/500"].entries()) {
      const evidence = buildEvidence({
        url,
        title: "T",
        status: statuses[i],
        markdown: "body",
      });
      expect(evidence.mismatch).toBe(true);
      expect(evidence.redirected).toBe(false);
    }
  });

  test("3-hit mixed success: success + throw + non-200 stay aligned in hit order", async () => {
    const hits = [
      hit("https://ok.example/good", "Good"),
      hit("https://fail.example/bad", "Bad"),
      hit("https://stale.example/old", "Old"),
    ];
    const client = stubClient((url) => {
      if (url.includes("fail.example")) return new Error("timeout");
      if (url.includes("stale.example")) {
        return okPayload("stale body", {
          sourceURL: url,
          title: "Old",
          statusCode: 404,
        });
      }
      return okPayload("good line one\ngood line two", {
        sourceURL: url,
        title: "Good",
        statusCode: 200,
      });
    });
    const pack = await runResearch(client, opts({ scrapeTop: 3 }), async () => hits);
    expect(candidateCount(pack)).toBe(3);
    expect(evidenceCount(pack)).toBe(3);
    // Order preserved: ok, failed placeholder, stale.
    const sources = [...pack.matchAll(/^- Source: (\S+)/gm)].map((m) => m[1]);
    expect(sources).toEqual(hits.map((h) => h.url));
    expect(pack).toContain("- Status: 200");
    expect(pack).toContain("- Status: unknown");
    expect(pack).toContain("- Status: 404");
    expect(pack).toContain("Scrape failed: timeout");
    expect(pack).toContain("> good line one");
  });

  test("garbage scrape payloads never throw and fall back to hit URL", async () => {
    const payloads: unknown[] = [
      null,
      undefined,
      42,
      [],
      {},
      { data: null },
      { data: { markdown: 123, metadata: null } },
      { data: { metadata: { sourceURL: 7, title: {}, statusCode: "200" } } },
    ];
    const hits = payloads.map((_, i) => hit(`https://junk.example/${i}`, `J${i}`));
    let n = 0;
    const client = stubClient(() => payloads[n++] as unknown);
    const pack = await runResearch(
      client,
      opts({ scrapeTop: hits.length }),
      async () => hits,
    );
    expect(candidateCount(pack)).toBe(hits.length);
    expect(evidenceCount(pack)).toBe(hits.length);
    for (const h of hits) {
      expect(pack).toContain(`- Source: ${h.url}`);
    }
  });

  test("scrapeTop clamps: zero scrapes render none-line, overshoot caps at hits", async () => {
    const hits = [hit("https://a.example/1", "A")];
    const client = stubClient(() =>
      okPayload("body", {
        sourceURL: "https://a.example/1",
        title: "A",
        statusCode: 200,
      }),
    );
    const none = await runResearch(client, opts({ scrapeTop: 0 }), async () => hits);
    expect(evidenceCount(none)).toBe(0);
    expect(none).toContain("Rendered evidence: none");
    const capped = await runResearch(client, opts({ scrapeTop: 99 }), async () => hits);
    expect(evidenceCount(capped)).toBe(1);
  });
});
