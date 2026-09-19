import { describe, expect, test } from "bun:test";
import {
  authorize,
  extractPresentedKey,
  MasterKeyMissingError,
  requireMasterKey,
} from "../src/auth.ts";
import { classifyError } from "../src/server.ts";
import {
  buildEvidence,
  buildFailedEvidence,
  extractMapLinks,
  formatResearchPack,
  isChallengeStubUrl,
  normalizeSurveyLink,
  researchMapTarget,
  runResearch,
  stripNoise,
  summarizeSurveyMap,
  type ResearchEvidence,
  type ResearchMapFn,
} from "../src/research.ts";
import { parseExaSearch, type SearchHit } from "../src/search.ts";
import type { FirecrawlClient } from "../src/client.ts";

describe("Layer 1: Auth Boundary (Adversarial)", () => {
  const MASTER_KEY = "super-secret-master-api-key-32b!";

  describe("timingSafeEqual rejection", () => {
    test("rejects equal-length keys that differ by a single character at start, middle, or end", () => {
      const diffStart = "Xuper-secret-master-api-key-32b!";
      expect(diffStart.length).toBe(MASTER_KEY.length);
      expect(authorize(diffStart, MASTER_KEY)).toEqual({ ok: false, status: 401 });

      const diffMiddle = "super-secret-mXster-api-key-32b!";
      expect(diffMiddle.length).toBe(MASTER_KEY.length);
      expect(authorize(diffMiddle, MASTER_KEY)).toEqual({ ok: false, status: 401 });

      const diffEnd = "super-secret-master-api-key-32bX";
      expect(diffEnd.length).toBe(MASTER_KEY.length);
      expect(authorize(diffEnd, MASTER_KEY)).toEqual({ ok: false, status: 401 });

      const diffAll = "0123456789abcdef0123456789abcdef";
      expect(diffAll.length).toBe(MASTER_KEY.length);
      expect(authorize(diffAll, MASTER_KEY)).toEqual({ ok: false, status: 401 });
    });

    test("accepts exact match", () => {
      expect(authorize(MASTER_KEY, MASTER_KEY)).toEqual({ ok: true });
    });
  });

  describe("empty and missing headers", () => {
    test("extractPresentedKey returns undefined for empty Headers", () => {
      expect(extractPresentedKey(new Headers())).toBeUndefined();
    });

    test("extractPresentedKey returns undefined for empty header values", () => {
      expect(extractPresentedKey(new Headers({ authorization: "" }))).toBeUndefined();
      expect(extractPresentedKey(new Headers({ "x-api-key": "" }))).toBeUndefined();
      expect(
        extractPresentedKey(new Headers({ authorization: "", "x-api-key": "" })),
      ).toBeUndefined();
    });

    test("extractPresentedKey returns undefined when Bearer has no token due to whitespace trimming, rejecting auth", () => {
      const headers = new Headers({ authorization: "Bearer " });
      const presented = extractPresentedKey(headers);
      expect(presented).toBeUndefined();
      expect(authorize(presented, MASTER_KEY)).toEqual({ ok: false, status: 401 });
    });

    test("authorize rejects undefined presented key", () => {
      expect(authorize(undefined, MASTER_KEY)).toEqual({ ok: false, status: 401 });
    });
  });

  describe("key length fast-fail", () => {
    test("fast-fails when presented key is shorter than master key", () => {
      expect(authorize("short", MASTER_KEY)).toEqual({ ok: false, status: 401 });
      expect(authorize(MASTER_KEY.slice(0, -1), MASTER_KEY)).toEqual({
        ok: false,
        status: 401,
      });
    });

    test("fast-fails when presented key is longer than master key", () => {
      expect(authorize(`${MASTER_KEY}-extra`, MASTER_KEY)).toEqual({
        ok: false,
        status: 401,
      });
    });

    test("fast-fails on empty string", () => {
      expect(authorize("", MASTER_KEY)).toEqual({ ok: false, status: 401 });
    });
  });

  describe("bearer vs x-api-key casing and precedence", () => {
    test("supports case-insensitive header names via Web Standard Headers", () => {
      expect(
        extractPresentedKey(new Headers({ Authorization: `Bearer ${MASTER_KEY}` })),
      ).toBe(MASTER_KEY);
      expect(
        extractPresentedKey(new Headers({ AUTHORIZATION: `Bearer ${MASTER_KEY}` })),
      ).toBe(MASTER_KEY);
      expect(
        extractPresentedKey(new Headers({ "X-Api-Key": MASTER_KEY })),
      ).toBe(MASTER_KEY);
      expect(
        extractPresentedKey(new Headers({ "X-API-KEY": MASTER_KEY })),
      ).toBe(MASTER_KEY);
    });

    test("prefers Bearer over x-api-key when both headers are present", () => {
      const headers = new Headers({
        authorization: "Bearer primary-bearer-token",
        "x-api-key": "secondary-api-key",
      });
      expect(extractPresentedKey(headers)).toBe("primary-bearer-token");
    });

    test("strictly enforces 'Bearer ' scheme prefix casing", () => {
      const lowerBearer = new Headers({ authorization: "bearer lowercase-scheme" });
      expect(extractPresentedKey(lowerBearer)).toBeUndefined();

      const withFallback = new Headers({
        authorization: "bearer lowercase-scheme",
        "x-api-key": "fallback-key",
      });
      expect(extractPresentedKey(withFallback)).toBe("fallback-key");
    });
  });

  describe("requireMasterKey environment validation", () => {
    test("throws MasterKeyMissingError when MASTER_API_KEY is unset or empty", () => {
      expect(() => requireMasterKey({})).toThrow(MasterKeyMissingError);
      expect(() => requireMasterKey({ MASTER_API_KEY: "" })).toThrow(
        MasterKeyMissingError,
      );
    });

    test("returns key when set", () => {
      expect(requireMasterKey({ MASTER_API_KEY: "valid-key" })).toBe("valid-key");
    });
  });
});

describe("Layer 2: Error Classification (Deceptive Cases)", () => {
  describe("deceptive antibot errors that mimic 404 / page not found", () => {
    test("Reddit 'All scraping engines failed ... page not found' classifies as BLOCKED, not NOT_FOUND", () => {
      const detail = classifyError(
        new Error(
          "All scraping engines failed for https://www.reddit.com/r/technology/comments/abc: 404 page not found",
        ),
      );
      expect(detail.code).toBe("BLOCKED");
      expect(detail.retryable).toBe(false);
    });

    test("Reddit 'blocking automated access' with 'page not found' classifies as BLOCKED", () => {
      const detail = classifyError(
        new Error("Reddit is blocking automated access: page not found for bots"),
      );
      expect(detail.code).toBe("BLOCKED");
      expect(detail.retryable).toBe(false);
    });

    test("Cloudflare challenge mentioning 404 classifies as BLOCKED", () => {
      const detail = classifyError(
        new Error("Cloudflare challenge page rendered with HTTP 404 status"),
      );
      expect(detail.code).toBe("BLOCKED");
      expect(detail.retryable).toBe(false);
    });

    test("Akamai EdgeSuite challenge mentioning 404 classifies as BLOCKED", () => {
      const detail = classifyError(
        new Error("Akamai EdgeSuite challenge: /article not found for unverified clients"),
      );
      expect(detail.code).toBe("BLOCKED");
      expect(detail.retryable).toBe(false);
    });

    test("Captcha prompt claiming page not found classifies as BLOCKED", () => {
      const detail = classifyError(
        new Error("captcha required before 404 page not found can be resolved"),
      );
      expect(detail.code).toBe("BLOCKED");
      expect(detail.retryable).toBe(false);
    });
  });

  describe("deceptive HTTP 403 Forbidden in messages", () => {
    test.each([
      ["HTTP 403 Forbidden: access denied by origin"],
      ["Upstream Firecrawl returned status code 403 for target"],
      ["Request failed with 403 - antibot security shield active"],
    ])("classifies %p as BLOCKED non-retryable", (msg) => {
      const detail = classifyError(new Error(msg));
      expect(detail.code).toBe("BLOCKED");
      expect(detail.retryable).toBe(false);
    });
  });

  describe("connection refused and network errors", () => {
    test.each([
      ["connect ECONNREFUSED 127.0.0.1:3002"],
      ["fetch failed: connect ECONNREFUSED ::1:3002"],
      ["connection error: Connection reset by peer"],
    ])("classifies %p as NETWORK_ERROR retryable", (msg) => {
      const detail = classifyError(new Error(msg));
      expect(detail.code).toBe("NETWORK_ERROR");
      expect(detail.retryable).toBe(true);
    });
  });

  describe("legitimate NOT_FOUND, RATE_LIMITED, and TIMEOUT errors", () => {
    test("genuine 404 without antibot keywords classifies as NOT_FOUND", () => {
      const detail = classifyError(new Error("HTTP 404 Not Found: /missing-doc"));
      expect(detail.code).toBe("NOT_FOUND");
      expect(detail.retryable).toBe(false);
    });

    test("rate limit 429 classifies as RATE_LIMITED retryable", () => {
      const detail = classifyError(new Error("HTTP 429: Too Many Requests"));
      expect(detail.code).toBe("RATE_LIMITED");
      expect(detail.retryable).toBe(true);
    });

    test("timed out classifies as TIMEOUT retryable", () => {
      const detail = classifyError(new Error("Operation timed out after 60000ms"));
      expect(detail.code).toBe("TIMEOUT");
      expect(detail.retryable).toBe(true);
    });
  });

  describe("target preservation and non-Error argument", () => {
    test("preserves target URL across classification", () => {
      const detail = classifyError(
        new Error("Access Denied (akamai edge)"),
        "https://protected.example/data",
      );
      expect(detail.target).toBe("https://protected.example/data");
    });

    test("handles non-Error objects and strings gracefully", () => {
      const detail = classifyError("HTTP 403 Forbidden");
      expect(detail.code).toBe("BLOCKED");
      expect(detail.message).toBe("HTTP 403 Forbidden");
    });
  });
});

describe("Layer 3: Search / Normalization", () => {
  describe("map link extraction from mixed strings and objects", () => {
    test("extracts clean URL strings from mixed strings, { url } objects, and corrupt entries", () => {
      const mixedPayload = {
        links: [
          "https://example.com/page1",
          { url: "https://example.com/page2" },
          null,
          undefined,
          { url: "" },
          { url: 123 },
          { otherField: "https://example.com/page3" },
          42,
          true,
          "",
          "https://example.com/page4",
        ],
      };
      const extracted = extractMapLinks(mixedPayload);
      expect(extracted).toEqual([
        "https://example.com/page1",
        "https://example.com/page2",
        "https://example.com/page4",
      ]);
    });

    test("returns empty array for malformed payload structures", () => {
      expect(extractMapLinks(null)).toEqual([]);
      expect(extractMapLinks(undefined)).toEqual([]);
      expect(extractMapLinks("string root")).toEqual([]);
      expect(extractMapLinks([])).toEqual([]);
      expect(extractMapLinks({})).toEqual([]);
      expect(extractMapLinks({ links: "not an array" })).toEqual([]);
    });
  });

  describe("URL normalization and deduplication", () => {
    test("normalizeSurveyLink strips whitespace, fragments, and trailing slashes", () => {
      expect(normalizeSurveyLink("  https://example.com/docs#overview  ")).toBe(
        "https://example.com/docs",
      );
      expect(normalizeSurveyLink("https://example.com/docs/")).toBe(
        "https://example.com/docs",
      );
      expect(normalizeSurveyLink("https://example.com/docs///")).toBe(
        "https://example.com/docs",
      );
      expect(normalizeSurveyLink("https://example.com/docs#a#b")).toBe(
        "https://example.com/docs",
      );
      expect(normalizeSurveyLink("https://example.com")).toBe("https://example.com");
    });

    test("summarizeSurveyMap deduplicates query/fragment variants of identical resources", () => {
      const rawLinks = [
        "https://example.com/guide",
        "https://example.com/guide/",
        "https://example.com/guide///",
        "https://example.com/guide#step-1",
        "https://example.com/guide#step-2",
        "https://example.com/about",
        "https://example.com/about/",
        "https://example.com/pricing",
      ];
      const summary = summarizeSurveyMap("https://example.com", rawLinks);
      expect(summary.discovered).toBe(8);
      expect(summary.deduped).toBe(3);
      expect(summary.challenges).toBe(0);
      expect(summary.links).toEqual([
        "https://example.com/guide",
        "https://example.com/about",
        "https://example.com/pricing",
      ]);
    });
  });

  describe("challenge stub detection in map links", () => {
    test("flags known antibot challenge paths as challenge stubs", () => {
      const challengeUrls = [
        "https://example.com/cdn-cgi/challenge-platform/h/b/scripts/alpha.js",
        "https://example.com/challenge-platform/orchestrate",
        "https://example.com/cloudflare/check",
        "https://example.com/turnstile/v0/api.js",
        "https://example.com/just-a-moment-challenge",
        "https://example.com/captcha/verify",
        "https://example.com/robot-check",
        "https://example.com/access-denied-gate",
        "https://example.com/perimeterx/validate",
        "https://example.com/datadome/check",
        "https://example.com/akamai/edgesuite/gate",
      ];

      for (const url of challengeUrls) {
        expect(isChallengeStubUrl(url)).toBe(true);
      }
    });

    test("distinguishes legitimate content URLs from challenge stubs", () => {
      const legitimateUrls = [
        "https://example.com/docs/getting-started",
        "https://example.com/blog/2026-privacy-report",
        "https://example.com/terms-and-conditions",
      ];

      for (const url of legitimateUrls) {
        expect(isChallengeStubUrl(url)).toBe(false);
      }
    });

    test("summarizeSurveyMap correctly tallies challenge stubs vs content links", () => {
      const summary = summarizeSurveyMap("https://example.com", [
        "https://example.com/home",
        "https://example.com/cdn-cgi/challenge-platform/h/b",
        "https://example.com/turnstile/check",
        "https://example.com/docs",
      ]);
      expect(summary.discovered).toBe(4);
      expect(summary.deduped).toBe(4);
      expect(summary.challenges).toBe(2);
    });
  });

  describe("Exa search hit normalization", () => {
    test("parseExaSearch handles highlights vs text vs snippet and malformed inputs", () => {
      const payload = {
        results: [
          {
            url: "https://exa.example/1",
            title: "First Hit",
            highlights: ["Highlight excerpt 1", "Highlight excerpt 2"],
          },
          {
            url: "https://exa.example/2",
            title: "Second Hit",
            text: "Fallback raw text body",
          },
          {
            url: "https://exa.example/3",
          },
          "invalid hit element",
        ],
      };

      const hits = parseExaSearch(payload);
      expect(hits.length).toBe(3);
      expect(hits[0]).toEqual({
        url: "https://exa.example/1",
        title: "First Hit",
        snippet: "Highlight excerpt 1",
      });
      expect(hits[1]).toEqual({
        url: "https://exa.example/2",
        title: "Second Hit",
        snippet: "Fallback raw text body",
      });
      expect(hits[2]).toEqual({
        url: "https://exa.example/3",
        title: "",
        snippet: "",
      });
    });

    test("parseExaSearch safely returns empty array on null or non-object payloads", () => {
      expect(parseExaSearch(null)).toEqual([]);
      expect(parseExaSearch(undefined)).toEqual([]);
      expect(parseExaSearch([])).toEqual([]);
      expect(parseExaSearch({ results: "not array" })).toEqual([]);
    });
  });
});

describe("Layer 4: Noise vs Content Turing Test", () => {
  test("article ABOUT cookie consent and ad-blockers survives, while actual banners and walls are stripped", () => {
    const rawArticleWithNoise = [
      "[Skip to main content](#main)",
      "[Home](https://news.example.com/) [World](https://news.example.com/world) [Tech](https://news.example.com/tech)",
      "## We value your privacy",
      "We use cookies to enhance your browsing experience and personalize content.",
      "[Accept All Cookies](https://news.example.com/accept) [Manage Preferences](https://news.example.com/prefs)",
      "",
      "## Ad Blocker Detected",
      "Please disable your ad blocker or whitelist Fortune to continue reading.",
      "Turn off your ad blocker to view full investigative reporting.",
      "",
      "By Sarah Jenkins",
      "",
      "Published March 14, 2026 at 09:15 AM EST",
      "",
      "The EU passed a cookie consent regulation that fundamentally transforms digital publishing.",
      "",
      "Lawmakers argued that existing cookie banners created consent fatigue among users.",
      "",
      "Publishers worry that ad-blockers combined with stricter privacy enforcement will threaten digital revenue.",
      "",
      "A new research paper shows that ad-blockers are now used by more than 40 percent of desktop readers.",
      "",
      "| Sector | Cookie Banner Compliance | Ad-Blocker Impact |",
      "| --- | --- | --- |",
      "| News Media | 94% | -18% |",
      "| E-Commerce | 87% | -6% |",
      "",
      "The debate over cookie consent has intensified as browsers phase out third-party cookies.",
      "",
      "## Trending Now",
      "1. [Celebrity buys luxury island](https://news.example.com/gossip-1)",
      "2. [Ten shocking lottery winners](https://news.example.com/gossip-2)",
      "3. [Viral workplace drama recap](https://news.example.com/gossip-3)",
      "",
      "## Most Viewed",
      "- [Top fashion looks ranked](https://news.example.com/fashion)",
      "- [Unrelated viral video](https://news.example.com/video)",
      "",
      "© 2026 Global News Media Inc. All rights reserved.",
      "[Terms of Use](https://news.example.com/terms) [Privacy Policy](https://news.example.com/privacy) [Sitemap](https://news.example.com/sitemap)",
    ].join("\n");

    const cleaned = stripNoise(rawArticleWithNoise);

    expect(cleaned).not.toContain("Skip to main content");
    expect(cleaned).not.toContain("We value your privacy");
    expect(cleaned).not.toContain("We use cookies to enhance");
    expect(cleaned).not.toContain("Accept All Cookies");
    expect(cleaned).not.toContain("Manage Preferences");
    expect(cleaned).not.toContain("Ad Blocker Detected");
    expect(cleaned).not.toContain("Please disable your ad blocker");
    expect(cleaned).not.toContain("Turn off your ad blocker");
    expect(cleaned).not.toContain("Trending Now");
    expect(cleaned).not.toContain("Celebrity buys luxury island");
    expect(cleaned).not.toContain("Most Viewed");
    expect(cleaned).not.toContain("Top fashion looks ranked");
    expect(cleaned).not.toContain("All rights reserved");
    expect(cleaned).not.toContain("Terms of Use");

    expect(cleaned).toContain("By Sarah Jenkins");
    expect(cleaned).toContain("Published March 14, 2026 at 09:15 AM EST");
    expect(cleaned).toContain(
      "The EU passed a cookie consent regulation that fundamentally transforms digital publishing.",
    );
    expect(cleaned).toContain(
      "Lawmakers argued that existing cookie banners created consent fatigue among users.",
    );
    expect(cleaned).toContain(
      "Publishers worry that ad-blockers combined with stricter privacy enforcement will threaten digital revenue.",
    );
    expect(cleaned).toContain(
      "A new research paper shows that ad-blockers are now used by more than 40 percent of desktop readers.",
    );
    expect(cleaned).toContain(
      "The debate over cookie consent has intensified as browsers phase out third-party cookies.",
    );

    expect(cleaned).toContain("| Sector | Cookie Banner Compliance | Ad-Blocker Impact |");
    expect(cleaned).toContain("| --- | --- | --- |");
    expect(cleaned).toContain("| News Media | 94% | -18% |");
    expect(cleaned).toContain("| E-Commerce | 87% | -6% |");
  });
});

describe("Layer 5: Provenance / Evidence Integrity", () => {
  describe("divergence detection (requestedUrl vs sourceURL)", () => {
    test("divergence between requestedUrl and sourceURL flags redirected=true", () => {
      const evidence = buildEvidence({
        requestedUrl: "https://short.link/post123",
        url: "https://canonical.example.com/articles/post123-full-story",
        title: "Post 123",
        status: 200,
        markdown: "Article body text.",
      });

      expect(evidence.redirected).toBe(true);
      expect(evidence.requestedUrl).toBe("https://short.link/post123");
      expect(evidence.url).toBe("https://canonical.example.com/articles/post123-full-story");
      expect(evidence.mismatch).toBe(false);
    });

    test("matching requestedUrl and sourceURL leaves redirected=false", () => {
      const evidence = buildEvidence({
        requestedUrl: "https://canonical.example.com/direct",
        url: "https://canonical.example.com/direct",
        title: "Direct",
        status: 200,
        markdown: "Direct body text.",
      });

      expect(evidence.redirected).toBe(false);
      expect(evidence.requestedUrl).toBe("https://canonical.example.com/direct");
      expect(evidence.mismatch).toBe(false);
    });

    test("defaults requestedUrl to url when requestedUrl is omitted", () => {
      const evidence = buildEvidence({
        url: "https://canonical.example.com/direct",
        title: "Direct",
        status: 200,
        markdown: "Direct body text.",
      });

      expect(evidence.redirected).toBe(false);
      expect(evidence.requestedUrl).toBe("https://canonical.example.com/direct");
    });
  });

  describe("mismatch detection (non-200 status or empty title)", () => {
    test("non-200 HTTP status triggers mismatch=true", () => {
      const notFoundEvidence = buildEvidence({
        url: "https://example.com/not-found",
        title: "Not Found",
        status: 404,
        markdown: "Page missing",
      });
      expect(notFoundEvidence.mismatch).toBe(true);

      const serverErrorEvidence = buildEvidence({
        url: "https://example.com/server-error",
        title: "Server Error",
        status: 500,
        markdown: "Internal failure",
      });
      expect(serverErrorEvidence.mismatch).toBe(true);
    });

    test("empty or whitespace title triggers mismatch=true", () => {
      const emptyTitleEvidence = buildEvidence({
        url: "https://example.com/page",
        title: "",
        status: 200,
        markdown: "Content with empty title",
      });
      expect(emptyTitleEvidence.mismatch).toBe(true);

      const whitespaceTitleEvidence = buildEvidence({
        url: "https://example.com/page",
        title: "    ",
        status: 200,
        markdown: "Content with whitespace title",
      });
      expect(whitespaceTitleEvidence.mismatch).toBe(true);
    });
  });

  describe("failed scrape placeholder generation", () => {
    test("buildFailedEvidence creates placeholder with mismatch=true, redirected=false, and empty quotes", () => {
      const failed = buildFailedEvidence(
        "https://failing.example.com/unreachable",
        "Target Title",
        "connect ECONNREFUSED 127.0.0.1:3002",
      );

      expect(failed.url).toBe("https://failing.example.com/unreachable");
      expect(failed.title).toBe("Target Title");
      expect(failed.status).toBeUndefined();
      expect(failed.excerpt).toBe("Scrape failed: connect ECONNREFUSED 127.0.0.1:3002");
      expect(failed.quotes).toEqual([]);
      expect(failed.requestedUrl).toBe("https://failing.example.com/unreachable");
      expect(failed.redirected).toBe(false);
      expect(failed.mismatch).toBe(true);
    });

    test("buildFailedEvidence falls back to url if title is empty", () => {
      const failed = buildFailedEvidence("https://no-title.example.com", "", "timeout");
      expect(failed.title).toBe("https://no-title.example.com");
    });
  });

  describe("provenance rendering in formatted pack", () => {
    test("renders final URL, redirect status, and HTTP status explicitly in pack", () => {
      const hits: SearchHit[] = [
        {
          url: "https://redirect.origin/short",
          title: "Redirect Test",
          snippet: "Snippet info",
        },
      ];
      const evidences: ResearchEvidence[] = [
        {
          url: "https://redirect.dest/destination-article",
          title: "Destination Title",
          status: 200,
          excerpt: "Destination rendered excerpt.",
          quotes: ["Rendered quote line"],
          requestedUrl: "https://redirect.origin/short",
          redirected: true,
          mismatch: false,
        },
      ];

      const pack = formatResearchPack("provenance query", hits, evidences);
      expect(pack).toContain("- Source: https://redirect.dest/destination-article");
      expect(pack).toContain("- Status: 200");
      expect(pack).toContain(
        "- Provenance: final URL https://redirect.dest/destination-article, redirect yes, status 200",
      );
      expect(pack).toContain("Destination rendered excerpt.");
      expect(pack).toContain("> Rendered quote line");
    });
  });
});

describe("Layer 6: Orchestration / Research Mode", () => {
  const createMockClient = (
    responses: Record<
      string,
      { markdown: string; status?: number; title?: string; sourceURL?: string }
    > = {},
  ): FirecrawlClient => {
    return {
      scrape: async (params: { url: string }) => {
        const configured = responses[params.url];
        if (!configured) {
          return {
            data: {
              markdown: `Default markdown for ${params.url}`,
              metadata: { sourceURL: params.url, title: "Mock Title", statusCode: 200 },
            },
          };
        }
        return {
          data: {
            markdown: configured.markdown,
            metadata: {
              sourceURL: configured.sourceURL ?? params.url,
              title: configured.title ?? "Configured Title",
              statusCode: configured.status ?? 200,
            },
          },
        };
      },
      map: async () => ({ links: [] }),
    } as unknown as FirecrawlClient;
  };

  describe("fast mode vs survey mode", () => {
    test("fast mode (default and explicit) strictly skips mapFn calls and omits survey appendix", async () => {
      const hits: SearchHit[] = [
        { url: "https://site.example/page1", title: "Page 1", snippet: "Snippet 1" },
      ];
      let mapCalls = 0;
      const mockMap: ResearchMapFn = async () => {
        mapCalls += 1;
        return { links: [] };
      };

      const defaultPack = await runResearch(
        createMockClient(),
        { query: "test query", numResults: 1, scrapeTop: 1, waitFor: 0 },
        async () => hits,
        mockMap,
      );
      expect(mapCalls).toBe(0);
      expect(defaultPack).not.toContain("Survey (map");

      const explicitPack = await runResearch(
        createMockClient(),
        { query: "test query", numResults: 1, scrapeTop: 1, waitFor: 0, mode: "fast" },
        async () => hits,
        mockMap,
      );
      expect(mapCalls).toBe(0);
      expect(explicitPack).not.toContain("Survey (map");
    });

    test("survey mode extracts domain from query or falls back to top search hit", async () => {
      const mapTargets: string[] = [];
      const recordingMap: ResearchMapFn = async (url) => {
        mapTargets.push(url);
        return { links: ["https://quotes.toscrape.com/page1"] };
      };

      await runResearch(
        createMockClient(),
        {
          query: "find quotes on quotes.toscrape.com today",
          numResults: 1,
          scrapeTop: 1,
          waitFor: 0,
          mode: "survey",
        },
        async () => [
          { url: "https://other.example/quote", title: "Other", snippet: "s" },
        ],
        recordingMap,
      );
      expect(mapTargets[0]).toBe("https://quotes.toscrape.com");

      await runResearch(
        createMockClient(),
        {
          query: "vague philosophical sayings",
          numResults: 1,
          scrapeTop: 1,
          waitFor: 0,
          mode: "survey",
        },
        async () => [
          { url: "https://philosophy.example.org/topics/sayings", title: "P", snippet: "s" },
        ],
        recordingMap,
      );
      expect(mapTargets[1]).toBe("https://philosophy.example.org");
    });
  });

  describe("alignment preserved across mixed success and failure", () => {
    test("preserves strict positional 1:1 alignment between search hits and evidence sections when middle hit fails", async () => {
      const hits: SearchHit[] = [
        { url: "https://test.example/hit1", title: "First Resource", snippet: "Snippet 1" },
        { url: "https://test.example/hit2", title: "Second Resource", snippet: "Snippet 2" },
        { url: "https://test.example/hit3", title: "Third Resource", snippet: "Snippet 3" },
      ];

      const clientWithFailingMiddleHit: FirecrawlClient = {
        scrape: async (params: { url: string }) => {
          if (params.url === "https://test.example/hit1") {
            return {
              data: {
                markdown: "Successful content for hit 1",
                metadata: { sourceURL: params.url, title: "First Title", statusCode: 200 },
              },
            };
          }
          if (params.url === "https://test.example/hit2") {
            throw new Error("Cloudflare challenge failed on hit 2");
          }
          if (params.url === "https://test.example/hit3") {
            return {
              data: {
                markdown: "Successful content for hit 3",
                metadata: { sourceURL: params.url, title: "Third Title", statusCode: 200 },
              },
            };
          }
          throw new Error("Unexpected url");
        },
      } as unknown as FirecrawlClient;

      const pack = await runResearch(
        clientWithFailingMiddleHit,
        {
          query: "resilience alignment test",
          numResults: 3,
          scrapeTop: 3,
          waitFor: 0,
          mode: "fast",
        },
        async () => hits,
      );

      expect(pack).toContain("1. [First Resource](https://test.example/hit1)");
      expect(pack).toContain("2. [Second Resource](https://test.example/hit2)");
      expect(pack).toContain("3. [Third Resource](https://test.example/hit3)");

      const sec1Index = pack.indexOf("## 1. First Title");
      const sec2Index = pack.indexOf("## 2. Second Resource");
      const sec3Index = pack.indexOf("## 3. Third Title");

      expect(sec1Index).toBeGreaterThan(-1);
      expect(sec2Index).toBeGreaterThan(sec1Index);
      expect(sec3Index).toBeGreaterThan(sec2Index);

      expect(pack).toContain("Successful content for hit 1");
      expect(pack).toContain("- Provenance: final URL https://test.example/hit1, redirect no, status 200");

      expect(pack).toContain("Scrape failed: Cloudflare challenge failed on hit 2");
      expect(pack).toContain("- Provenance: final URL https://test.example/hit2, redirect no, status unknown");

      expect(pack).toContain("Successful content for hit 3");
      expect(pack).toContain("- Provenance: final URL https://test.example/hit3, redirect no, status 200");
    });
  });
});
