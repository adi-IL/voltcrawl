import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  buildEvidence,
  buildFailedEvidence,
  extractMapLinks,
  extractProofLines,
  formatResearchPack,
  formatSurveyAppendix,
  RESEARCH_SURVEY_MAP_LIMIT,
  researchMapTarget,
  runResearch,
  summarizeSurveyMap,
} from "../src/research.ts";
import type { FirecrawlClient } from "../src/client.ts";
import type { SearchHit } from "../src/search.ts";
import { ResearchToolSchema } from "../src/types.ts";

const ResearchArgs = z.object(ResearchToolSchema);

describe("ResearchToolSchema", () => {
  test("applies contract defaults", () => {
    expect(ResearchArgs.parse({ query: "owasp llm top 10" })).toEqual({
      query: "owasp llm top 10",
      numResults: 5,
      scrapeTop: 1,
      waitFor: 2500,
      mode: "fast",
    });
  });

  test("accepts survey mode and rejects unknown modes", () => {
    expect(ResearchArgs.parse({ query: "q", mode: "survey" }).mode).toBe("survey");
    expect(ResearchArgs.parse({ query: "q" }).mode).toBe("fast");
    expect(() => ResearchArgs.parse({ query: "q", mode: "crawl" })).toThrow();
  });

  test("rejects empty query", () => {
    expect(() =>
      ResearchArgs.parse({ query: "" }),
    ).toThrow();
  });

  test("rejects out-of-range scrapeTop and waitFor", () => {
    expect(() =>
      ResearchArgs.parse({ query: "q", scrapeTop: 4 }),
    ).toThrow();
    expect(() =>
      ResearchArgs.parse({ query: "q", waitFor: 30001 }),
    ).toThrow();
    expect(() =>
      ResearchArgs.parse({ query: "q", numResults: 11 }),
    ).toThrow();
  });
});

describe("extractProofLines", () => {
  test("skips blanks and caps quotes", () => {
    const lines = extractProofLines("\n  Alpha\n\nBeta\nGamma\nDelta\n", 2);
    expect(lines).toEqual(["Alpha", "Beta"]);
  });

  test("truncates long lines to quote budget", () => {
    const lines = extractProofLines("x".repeat(500), 1);
    expect(lines).toHaveLength(1);
    expect(lines[0].length).toBe(300);
  });
});

describe("buildEvidence", () => {
  test("caps excerpt but keeps full proof lines", () => {
    const markdown = "First line\nSecond line\n";
    const evidence = buildEvidence({
      url: "https://a.example",
      title: "",
      status: 200,
      markdown,
    });
    expect(evidence.title).toBe("https://a.example");
    expect(evidence.status).toBe(200);
    expect(evidence.excerpt).toBe(markdown);
    expect(evidence.quotes).toEqual(["First line", "Second line"]);
  });

  test("failed evidence carries message and no quotes", () => {
    const evidence = buildFailedEvidence(
      "https://b.example",
      "B",
      "boom",
    );
    expect(evidence.excerpt).toContain("boom");
    expect(evidence.quotes).toEqual([]);
    expect(evidence.status).toBeUndefined();
  });
});

describe("formatResearchPack", () => {
  test("renders candidates plus rendered evidence with source, title, status", () => {
    const pack = formatResearchPack(
      "quotes js rendering",
      [
        {
          url: "https://quotes.toscrape.com/js/",
          title: "Quotes to Scrape",
          snippet: "discovery snippet",
        },
      ],
      [
        {
          url: "https://quotes.toscrape.com/js/",
          title: "Quotes to Scrape",
          status: 200,
          excerpt: "rendered body",
          quotes: ["Albert Einstein quote"],
        },
      ],
    );
    expect(pack).toContain("### Research (quotes js rendering)");
    expect(pack).toContain("discovery snippet");
    expect(pack).toContain("snippets are not truth");
    expect(pack).toContain("- Source: https://quotes.toscrape.com/js/");
    expect(pack).toContain("- Status: 200");
    expect(pack).toContain("rendered body");
    expect(pack).toContain("> Albert Einstein quote");
  });

  test("labels snippets as discovery signal and rendered as source of truth", () => {
    const pack = formatResearchPack(
      "guard wording",
      [{ url: "https://example.com/a", title: "A", snippet: "snippet text" }],
      [
        {
          url: "https://example.com/a",
          title: "A",
          status: 200,
          excerpt: "rendered body",
          quotes: ["quoted line"],
        },
      ],
    );
    expect(pack).toContain("discovery signal only, not fact");
    expect(pack).toContain("do not trust or cite snippets");
    expect(pack).toContain("Rendered evidence (source of truth");
    expect(pack).toContain("trust and cite only this section");
  });
  test("empty hits yield no-results pack", () => {
    expect(formatResearchPack("q", [], [])).toContain("No results.");
  });
});

describe("provenance", () => {
  test("flags redirect when final URL differs from requested URL", () => {
    const evidence = buildEvidence({
      url: "https://final.example/page",
      title: "Page",
      status: 200,
      markdown: "body",
      requestedUrl: "https://short.example/abc",
    });
    expect(evidence.redirected).toBe(true);
    expect(evidence.requestedUrl).toBe("https://short.example/abc");
    expect(evidence.url).toBe("https://final.example/page");
    expect(evidence.mismatch).toBe(false);
  });

  test("no redirect when final URL matches requested URL", () => {
    const evidence = buildEvidence({
      url: "https://a.example",
      title: "A",
      status: 200,
      markdown: "body",
    });
    expect(evidence.redirected).toBe(false);
    expect(evidence.requestedUrl).toBe("https://a.example");
    expect(evidence.mismatch).toBe(false);
  });

  test("flags mismatch on non-200 status", () => {
    const evidence = buildEvidence({
      url: "https://a.example",
      title: "A",
      status: 404,
      markdown: "body",
    });
    expect(evidence.mismatch).toBe(true);
    expect(evidence.status).toBe(404);
  });

  test("flags mismatch on empty rendered title", () => {
    const evidence = buildEvidence({
      url: "https://a.example",
      title: "",
      status: 200,
      markdown: "body",
    });
    expect(evidence.mismatch).toBe(true);
  });

  test("failed evidence is a mismatch with no redirect", () => {
    const evidence = buildFailedEvidence("https://b.example", "B", "boom");
    expect(evidence.redirected).toBe(false);
    expect(evidence.mismatch).toBe(true);
  });

  test("pack appends provenance lines without renaming existing sections", () => {
    const pack = formatResearchPack(
      "provenance",
      [{ url: "https://short.example/abc", title: "A", snippet: "s" }],
      [
        {
          url: "https://final.example/page",
          title: "A",
          status: 200,
          excerpt: "rendered body",
          quotes: ["quoted line"],
          requestedUrl: "https://short.example/abc",
          redirected: true,
        },
        {
          url: "https://plain.example/",
          title: "P",
          status: 404,
          excerpt: "missing",
          quotes: [],
        },
      ],
    );
    expect(pack).toContain("- Source: https://final.example/page");
    expect(pack).toContain("- Status: 200");
    expect(pack).toContain(
      "- Provenance: final URL https://final.example/page, redirect yes, status 200",
    );
    expect(pack).toContain(
      "- Provenance: final URL https://plain.example/, redirect no, status 404",
    );
  });
});

const surveyHit = (url: string): SearchHit => ({ url, title: url, snippet: "s" });

function surveyClient(markdown = "survey body"): FirecrawlClient {
  return {
    scrape: async (params: { url: string }) => ({
      data: {
        markdown,
        metadata: { sourceURL: params.url, title: "T", statusCode: 200 },
      },
    }),
  } as unknown as FirecrawlClient;
}

describe("survey mode", () => {
  test("survey map limit is 10", () => {
    expect(RESEARCH_SURVEY_MAP_LIMIT).toBe(10);
  });

  test("researchMapTarget prefers a site named in the query", () => {
    const hits = [surveyHit("https://other.example/page")];
    expect(researchMapTarget("docs on quotes.toscrape.com about quotes", hits)).toBe(
      "https://quotes.toscrape.com",
    );
  });

  test("researchMapTarget falls back to the top hit origin", () => {
    expect(researchMapTarget("vague topic", [surveyHit("https://quotes.toscrape.com/js/")])).toBe(
      "https://quotes.toscrape.com",
    );
    expect(researchMapTarget("vague topic", [])).toBeUndefined();
  });

  test("extractMapLinks accepts string and object links", () => {
    expect(
      extractMapLinks({
        links: ["https://a.example/1", { url: "https://a.example/2" }, { url: 7 }, 9, ""],
      }),
    ).toEqual(["https://a.example/1", "https://a.example/2"]);
    expect(extractMapLinks({ links: "nope" })).toEqual([]);
    expect(extractMapLinks({})).toEqual([]);
  });

  test("summarizeSurveyMap dedupes normalized URLs and counts challenge stubs", () => {
    const survey = summarizeSurveyMap("https://a.example", [
      "https://a.example/docs",
      "https://a.example/docs/",
      "https://a.example/docs#intro",
      "https://a.example/cdn-cgi/challenge-platform/h/b",
      "https://a.example/Just-A-Moment-check",
    ]);
    expect(survey.discovered).toBe(5);
    expect(survey.deduped).toBe(3);
    expect(survey.challenges).toBe(2);
  });

  test("formatSurveyAppendix reports discovered, deduped, and challenge counts", () => {
    const appendix = formatSurveyAppendix({
      target: "https://a.example",
      discovered: 7,
      deduped: 5,
      challenges: 1,
      links: [],
    });
    expect(appendix).toContain("Survey (map https://a.example, limit 10):");
    expect(appendix).toContain("- Discovered: 7");
    expect(appendix).toContain("- Deduped: 5");
    expect(appendix).toContain("- Challenge stubs: 1");
  });

  test("survey path maps the top domain and appends the appendix", async () => {
    const hits = [surveyHit("https://quotes.toscrape.com/js/")];
    const calls: Array<{ url: string; limit: number }> = [];
    const pack = await runResearch(
      surveyClient(),
      { query: "quotes on quotes.toscrape.com", numResults: 1, scrapeTop: 1, waitFor: 0, mode: "survey" },
      async () => hits,
      async (url, limit) => {
        calls.push({ url, limit });
        return { links: ["https://quotes.toscrape.com/", "https://quotes.toscrape.com/", "https://quotes.toscrape.com/login"] };
      },
    );
    expect(calls).toEqual([{ url: "https://quotes.toscrape.com", limit: 10 }]);
    expect(pack).toContain("- Discovered: 3");
    expect(pack).toContain("- Deduped: 2");
    expect(pack).toContain("- Challenge stubs: 0");
    expect(pack).toContain("- Source: https://quotes.toscrape.com/js/");
  });

  test("survey reports challenge stubs from map results", async () => {
    const hits = [surveyHit("https://a.example/page")];
    const pack = await runResearch(
      surveyClient(),
      { query: "topic a.example", numResults: 1, scrapeTop: 1, waitFor: 0, mode: "survey" },
      async () => hits,
      async () => ({
        links: ["https://a.example/docs", "https://a.example/cdn-cgi/challenge-platform/h/b"],
      }),
    );
    expect(pack).toContain("- Discovered: 2");
    expect(pack).toContain("- Deduped: 2");
    expect(pack).toContain("- Challenge stubs: 1");
  });

  test("fast path never calls map", async () => {
    const hits = [surveyHit("https://quotes.toscrape.com/js/")];
    let calls = 0;
    const fastDefault = await runResearch(
      surveyClient(),
      { query: "quotes", numResults: 1, scrapeTop: 1, waitFor: 0 },
      async () => hits,
      async () => {
        calls += 1;
        return { links: [] };
      },
    );
    expect(calls).toBe(0);
    expect(fastDefault).not.toContain("Survey (map");
    const fastExplicit = await runResearch(
      surveyClient(),
      { query: "quotes", numResults: 1, scrapeTop: 1, waitFor: 0, mode: "fast" },
      async () => hits,
      async () => {
        calls += 1;
        return { links: [] };
      },
    );
    expect(calls).toBe(0);
    expect(fastExplicit).toBe(fastDefault);
  });

  test("survey degrades to zero counts when map throws", async () => {
    const hits = [surveyHit("https://a.example/page")];
    const pack = await runResearch(
      surveyClient(),
      { query: "topic", numResults: 1, scrapeTop: 1, waitFor: 0, mode: "survey" },
      async () => hits,
      async () => {
        throw new Error("map down");
      },
    );
    expect(pack).toContain("Survey (map https://a.example, limit 10):");
    expect(pack).toContain("- Discovered: 0");
    expect(pack).toContain("- Deduped: 0");
    expect(pack).toContain("- Challenge stubs: 0");
  });
});

describe("buildEvidence strips page chrome", () => {
  test("excerpt comes from stripped text: banner absent, body present", () => {
    const markdown =
      "We value your privacy\nAccept all cookies\nArticle body line one\nArticle body line two\n";
    const evidence = buildEvidence({
      url: "https://c.example",
      title: "C",
      status: 200,
      markdown,
    });
    expect(evidence.excerpt).not.toContain("privacy");
    expect(evidence.excerpt).not.toContain("cookies");
    expect(evidence.excerpt).toContain("Article body line one");
    expect(evidence.excerpt).toContain("Article body line two");
  });

  test("quotes come from stripped text: banner absent, body present", () => {
    const markdown =
      "We value your privacy\nAccept all cookies\nArticle body line one\nArticle body line two\n";
    const evidence = buildEvidence({
      url: "https://c.example",
      title: "C",
      status: 200,
      markdown,
    });
    expect(evidence.quotes).toEqual([
      "Article body line one",
      "Article body line two",
    ]);
  });

  test("empty markdown stays empty and quote-free", () => {
    const evidence = buildEvidence({
      url: "https://c.example",
      title: "C",
      status: 200,
      markdown: "",
    });
    expect(evidence.excerpt).toBe("");
    expect(evidence.quotes).toEqual([]);
  });
});
