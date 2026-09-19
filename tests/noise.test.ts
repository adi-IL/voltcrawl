import { describe, expect, test } from "bun:test";
import { stripNoise } from "../src/research.ts";

const FORTUNE_NOISE_DOC = [
  "[Skip to content](#main-content)",
  "",
  "[Home](https://fortune.com/) [Finance](https://fortune.com/finance/) [Tech](https://fortune.com/tech/) [Leadership](https://fortune.com/leadership/) [Newsletters](https://fortune.com/newsletters/)",
  "",
  "## We value your privacy",
  "We use cookies to enhance your browsing experience and analyze site traffic.",
  "[Manage Preferences](https://fortune.com/privacy/) [Accept All Cookies](https://fortune.com/privacy/)",
  "",
  "## Ad Blocker Detected",
  "Please disable your ad blocker or whitelist Fortune to continue reading.",
  "",
  "By Jane Smith",
  "",
  "Published February 12, 2026 at 6:30 AM EST",
  "",
  "Fortune 500 companies reported record earnings this quarter as markets rallied.",
  "",
  "Analysts say the gains were broad-based across sectors and regions.",
  "",
  "| Quarter | Revenue |",
  "| --- | --- |",
  "| Q1 | $1.2B |",
  "| Q2 | $1.4B |",
  "",
  "## Trending Now",
  "",
  "1. [Celebrity CEO buys a superyacht](https://fortune.com/unrelated-1/)",
  "2. [Ten beach houses of billionaires](https://fortune.com/unrelated-2/)",
  "3. [Viral office gossip roundup](https://fortune.com/unrelated-3/)",
  "",
  "## Most Viewed",
  "",
  "- [Unrelated market gossip](https://fortune.com/unrelated-4/)",
  "- [Red carpet looks ranked](https://fortune.com/unrelated-5/)",
  "",
  "© 2026 Fortune Media IP Limited. All rights reserved.",
  "[Terms of Use](https://fortune.com/terms/) [Privacy Policy](https://fortune.com/privacy-policy/)",
  "",
].join("\n");

describe("stripNoise", () => {
  test("removes OneTrust cookie consent block", () => {
    const out = stripNoise(FORTUNE_NOISE_DOC);
    expect(out).not.toContain("We value your privacy");
    expect(out).not.toContain("We use cookies to enhance your browsing experience");
    expect(out).not.toContain("Manage Preferences");
    expect(out).not.toContain("Accept All Cookies");
  });

  test("removes ad-block wall instructions", () => {
    const out = stripNoise(FORTUNE_NOISE_DOC);
    expect(out).not.toContain("Ad Blocker Detected");
    expect(out).not.toContain("disable your ad blocker");
  });

  test("removes skip link and nav menu", () => {
    const out = stripNoise(FORTUNE_NOISE_DOC);
    expect(out).not.toContain("Skip to content");
    expect(out).not.toContain("[Home](https://fortune.com/)");
  });

  test("removes Trending Now sidebar with unrelated headlines", () => {
    const out = stripNoise(FORTUNE_NOISE_DOC);
    expect(out).not.toContain("Trending Now");
    expect(out).not.toContain("Celebrity CEO buys a superyacht");
    expect(out).not.toContain("Ten beach houses of billionaires");
    expect(out).not.toContain("Viral office gossip roundup");
  });

  test("removes Most Viewed footer block and site footer", () => {
    const out = stripNoise(FORTUNE_NOISE_DOC);
    expect(out).not.toContain("Most Viewed");
    expect(out).not.toContain("Unrelated market gossip");
    expect(out).not.toContain("Red carpet looks ranked");
    expect(out).not.toContain("© 2026 Fortune Media IP Limited");
    expect(out).not.toContain("Terms of Use");
  });

  test("keeps byline, publication date, article body, and table rows", () => {
    const out = stripNoise(FORTUNE_NOISE_DOC);
    expect(out).toContain("By Jane Smith");
    expect(out).toContain("Published February 12, 2026 at 6:30 AM EST");
    expect(out).toContain(
      "Fortune 500 companies reported record earnings this quarter as markets rallied.",
    );
    expect(out).toContain("Analysts say the gains were broad-based across sectors and regions.");
    expect(out).toContain("| Quarter | Revenue |");
    expect(out).toContain("| Q1 | $1.2B |");
    expect(out).toContain("| Q2 | $1.4B |");
  });

  test("empty input stays empty", () => {
    expect(stripNoise("")).toBe("");
  });
});
