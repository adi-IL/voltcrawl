import { describe, expect, test } from "bun:test";
import { formatSearchHits, parseExaSearch, parseSearchPayload, searchGoogle } from "../src/search.ts";

describe("parseExaSearch", () => {
  test("returns empty list when results is missing", () => {
    expect(parseExaSearch({})).toEqual([]);
  });

  test("skips hits without a url", () => {
    expect(
      parseExaSearch({
        results: [{ title: "no url" }, { url: "https://a.example", title: "A" }],
      }),
    ).toEqual([{ url: "https://a.example", title: "A", snippet: "" }]);
  });

  test("uses first highlight as snippet", () => {
    expect(
      parseExaSearch({
        results: [
          {
            url: "https://quotes.toscrape.com/js/",
            title: "Quotes to Scrape (JS)",
            highlights: ["Einstein quote"],
            text: "ignored when highlights exist",
          },
        ],
      }),
    ).toEqual([
      {
        url: "https://quotes.toscrape.com/js/",
        title: "Quotes to Scrape (JS)",
        snippet: "Einstein quote",
      },
    ]);
  });

  test("falls back to text when highlights are empty", () => {
    expect(
      parseExaSearch({
        results: [
          {
            url: "https://b.example",
            title: "B",
            text: "plain body",
          },
        ],
      }),
    ).toEqual([
      { url: "https://b.example", title: "B", snippet: "plain body" },
    ]);
  });
});

describe("parseSearchPayload (Google Search Grounding format)", () => {
  test("parses Google search grounding hits with direct snippets", () => {
    const payload = {
      results: [
        {
          url: "https://python.org/downloads",
          title: "Python Downloads",
          snippet: "Python 3.14.7 was released on August 5, 2026.",
        },
      ],
    };
    expect(parseSearchPayload(payload)).toEqual([
      {
        url: "https://python.org/downloads",
        title: "Python Downloads",
        snippet: "Python 3.14.7 was released on August 5, 2026.",
      },
    ]);
  });

  test("formatSearchHits formats markdown list with links and snippets", () => {
    const hits = [
      {
        url: "https://example.com/a",
        title: "Example A",
        snippet: "Summary of A",
      },
    ];
    const formatted = formatSearchHits("test query", hits);
    expect(formatted).toContain("### Search (test query)");
    expect(formatted).toContain("1. [Example A](https://example.com/a)");
    expect(formatted).toContain("Summary of A");
  });

  test("formatSearchHits handles empty hits list", () => {
    expect(formatSearchHits("empty query", [])).toBe(
      "### Search (empty query)\n\nNo results.",
    );
  });
});
