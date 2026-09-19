import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  buildEvidence,
  extractProofLines,
  RESEARCH_EXCERPT_CHARS,
  researchMapTarget,
  runResearch,
  stripNoise,
} from "../src/research.ts";
import type { FirecrawlClient } from "../src/client.ts";
import type { SearchHit } from "../src/search.ts";
import { ResearchToolSchema } from "../src/types.ts";

const ResearchArgs = z.object(ResearchToolSchema);

const fakeHit = (url: string, title: string = "Hit"): SearchHit => ({
  url,
  title,
  snippet: "snippet for " + url,
});

describe("Persona Regression 1: researchMapTarget avoids greedy tech matching", () => {
  test('"Node.js benchmarks" surveys top hit origin, not https://node.js', () => {
    const hits = [fakeHit("https://markaicode.com/node-js-benchmarks-2026")];
    expect(researchMapTarget("Node.js benchmarks", hits)).toBe("https://markaicode.com");
  });

  test('"Vue.js reactivity guide" and "React.js architecture" survey top hit origin', () => {
    const vueHits = [fakeHit("https://blog.example.com/vue-guide")];
    expect(researchMapTarget("Vue.js reactivity guide", vueHits)).toBe("https://blog.example.com");

    const reactHits = [fakeHit("https://frontend.dev/react-state")];
    expect(researchMapTarget("React.js architecture", reactHits)).toBe("https://frontend.dev");
  });

  test("explicit site: and http(s):// directives are respected", () => {
    const hits = [fakeHit("https://markaicode.com/article")];
    expect(researchMapTarget("site:node.js", hits)).toBe("https://node.js");
    expect(researchMapTarget("site: https://vuejs.org", hits)).toBe("https://vuejs.org");
    expect(researchMapTarget("benchmarks on https://node.js/download", hits)).toBe("https://node.js");
  });

  test("runResearch survey mode maps top hit origin when query has Node.js", async () => {
    const hits = [fakeHit("https://markaicode.com/node-bench")];
    let mappedUrl: string | undefined;

    const mockClient = {
      scrape: async () => ({
        data: {
          markdown: "Substantive node benchmarks showing event loop latency details.",
          metadata: { title: "Benchmarks", statusCode: 200 },
        },
      }),
      map: async () => ({ links: [] }),
    } as unknown as FirecrawlClient;

    const mapFn = async (url: string, limit: number) => {
      mappedUrl = url;
      return { links: ["https://markaicode.com/page1"] };
    };

    const out = await runResearch(
      mockClient,
      { query: "Node.js benchmarks", numResults: 1, scrapeTop: 1, waitFor: 0, mode: "survey" },
      async () => hits,
      mapFn,
    );

    expect(mappedUrl).toBe("https://markaicode.com");
    expect(out).toContain("Survey (map https://markaicode.com");
  });
});

describe("Persona Regression 2: RESEARCH_EXCERPT_CHARS and maxExcerptChars override", () => {
  test("RESEARCH_EXCERPT_CHARS constant is 4000", () => {
    expect(RESEARCH_EXCERPT_CHARS).toBe(4000);
  });

  test("Excerpt captures up to 4000 chars without cutting off early", () => {
    const header = "# In-Depth System Evaluation\n\n";
    const padding = "A".repeat(1600);
    const table = "\n\n| Item | Price | Status |\n| Widget | $49.99 | In Stock |\n\n";
    const config = "ExecStart=/usr/bin/volt-service --port 8080\nRestart=always\n";
    const remaining = "B".repeat(1500);

    const fullMarkdown = `${header}${padding}${table}${config}${remaining}`;
    expect(fullMarkdown.length).toBeGreaterThan(3200);

    const evidence = buildEvidence({
      url: "https://example.com/system",
      title: "System Evaluation",
      markdown: fullMarkdown,
    });

    expect(evidence.excerpt.length).toBeGreaterThan(1500);
    expect(evidence.excerpt).toContain("| Widget | $49.99 | In Stock |");
    expect(evidence.excerpt).toContain("ExecStart=/usr/bin/volt-service");
  });

  test("maxExcerptChars overrides excerpt length when provided", () => {
    const longMarkdown = "Substantive sentence of text. ".repeat(250); // ~7500 chars

    const defaultEvidence = buildEvidence({
      url: "https://example.com/test",
      title: "Test",
      markdown: longMarkdown,
    });
    expect(defaultEvidence.excerpt.length).toBe(4000);

    const customEvidence = buildEvidence({
      url: "https://example.com/test",
      title: "Test",
      markdown: longMarkdown,
      maxExcerptChars: 6000,
    });
    expect(customEvidence.excerpt.length).toBe(6000);

    const smallerEvidence = buildEvidence({
      url: "https://example.com/test",
      title: "Test",
      markdown: longMarkdown,
      maxExcerptChars: 1000,
    });
    expect(smallerEvidence.excerpt.length).toBe(1000);
  });

  test("ResearchToolSchema validates maxExcerptChars constraints", () => {
    expect(ResearchArgs.parse({ query: "q", maxExcerptChars: 500 }).maxExcerptChars).toBe(500);
    expect(ResearchArgs.parse({ query: "q", maxExcerptChars: 10000 }).maxExcerptChars).toBe(10000);
    expect(() => ResearchArgs.parse({ query: "q", maxExcerptChars: 499 })).toThrow();
    expect(() => ResearchArgs.parse({ query: "q", maxExcerptChars: 10001 })).toThrow();
  });
});

describe("Persona Regression 3: extractProofLines skips images, notices, and short navigation", () => {
  test("Proof lines skip images and notices, picking substantive sentences", () => {
    const markdown = [
      "![MarkaiCode Architecture Logo](https://markaicode.com/logo.png)",
      "**Notice:** This page displays a fallback version because JavaScript is disabled.",
      "# Menu",
      "✨ Exclusive limited-time promotion for new enterprise accounts! ✨",
      "Navigation",
      "Here is a comprehensive breakdown of the benchmark methodology and testing environment.",
      "All trials were executed on dedicated bare-metal hardware with isolated network interfaces.",
      "The measured throughput demonstrated a forty percent improvement under sustained load.",
    ].join("\n");

    const quotes = extractProofLines(markdown, 3);

    expect(quotes).toHaveLength(3);
    for (const quote of quotes) {
      expect(quote).not.toContain("![");
      expect(quote).not.toContain("**Notice:**");
      expect(quote).not.toContain("✨");
      expect(quote).not.toBe("Menu");
      expect(quote).not.toBe("Navigation");
      expect(quote.length).toBeGreaterThanOrEqual(20);
    }

    expect(quotes[0]).toBe("Here is a comprehensive breakdown of the benchmark methodology and testing environment.");
    expect(quotes[1]).toBe("All trials were executed on dedicated bare-metal hardware with isolated network interfaces.");
    expect(quotes[2]).toBe("The measured throughput demonstrated a forty percent improvement under sustained load.");
  });
});

describe("Persona Regression 4: stripNoise drops fallback notices and promo banners", () => {
  test("Strip noise drops fallback notices and promo banners", () => {
    const rawMarkdown = [
      "# Official Product Overview",
      "By Jane Doe",
      "Published September 14, 2026",
      "**Notice:** This page displays a fallback version because JavaScript is disabled in your browser.",
      "✨ Save up to 50% on all cloud subscriptions today only! ✨",
      "Our distributed architecture guarantees sub-millisecond response times at scale.",
      "| Metric | Result |",
      "| Throughput | 100k req/s |",
      "✨ Exclusive offer ends tonight! ✨",
    ].join("\n");

    const cleaned = stripNoise(rawMarkdown);

    expect(cleaned).not.toContain("**Notice:**");
    expect(cleaned).not.toContain("This page displays a fallback");
    expect(cleaned).not.toContain("✨");
    expect(cleaned).not.toContain("Save up to 50%");
    expect(cleaned).toContain("By Jane Doe");
    expect(cleaned).toContain("Published September 14, 2026");
    expect(cleaned).toContain("Our distributed architecture guarantees sub-millisecond response times at scale.");
    expect(cleaned).toContain("| Throughput | 100k req/s |");
  });
});
