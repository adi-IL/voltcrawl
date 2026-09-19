import { FirecrawlClient } from "./client.ts";
import { searchGoogle, type SearchHit } from "./search.ts";

export type ResearchMode = "fast" | "survey";

export type ResearchOptions = {
  readonly query: string;
  readonly numResults: number;
  readonly scrapeTop: number;
  readonly waitFor: number;
  /** Depth mode: fast renders top scrapes only; survey also maps the top domain. */
  readonly mode?: ResearchMode;
  /** Maximum character length for rendered markdown excerpts (default 4000, min 500, max 10000). */
  readonly maxExcerptChars?: number;
};

/** Map limit for the survey appendix: top domain only, kept small. */
export const RESEARCH_SURVEY_MAP_LIMIT = 10;

/** Injected map double: (url, limit) — defaults to client.map. */
export type ResearchMapFn = (url: string, limit: number) => Promise<unknown>;

export type ResearchSurvey = {
  readonly target: string;
  readonly discovered: number;
  readonly deduped: number;
  readonly challenges: number;
  readonly links: readonly string[];
};

export type ResearchEvidence = {
  readonly url: string;
  readonly title: string;
  readonly status?: number;
  readonly excerpt: string;
  readonly quotes: readonly string[];
  /** Original discovery URL before redirect resolution. */
  readonly requestedUrl?: string;
  /** True when final sourceURL differs from the requested hit URL. */
  readonly redirected?: boolean;
  /** True when rendered title was empty or status is non-200. */
  readonly mismatch?: boolean;
};

export const RESEARCH_EXCERPT_CHARS = 4000;
export const RESEARCH_QUOTES_PER_PAGE = 3;
export const RESEARCH_QUOTE_CHARS = 300;

const NOISE_SIDEBAR_HEADING =
  /^(#{1,6}\s*)?(trending now|most viewed|most read|most popular|trending stories|recommended( for you| stories)?|you may also like|related (stories|articles|coverage)|read more|more from fortune)\s*:?\s*$/i;

const NOISE_LIST_ITEM = /^\s*(?:\d{1,3}[.)]\s+|[-*+]\s+)\S/;
const NOISE_BARE_LINK = /^\s*\[[^\]]+\]\([^)]+\)\s*$/;
const NOISE_LINK_PATTERN = /!?\[[^\]]*\]\([^)]*\)/g;
const NOISE_LINKS_ONLY_REMAINDER = /^[\s|·•\-–—*,;]+$/;

const NOISE_LINE_PATTERNS: readonly RegExp[] = [
  /skip to (content|main content|main)/i,
  /we value your privacy/i,
  /we use cookies to (enhance|improve|personalize)/i,
  /this (site|website) uses cookies/i,
  /^\s*(#{1,6}\s*)?cookie (consent|banner|preferences|settings)(\s+(notice|banner|dialog|popup|settings|preferences|modal))?\s*:?\s*$/i,
  /manage (cookie )?preferences/i,
  /accept (all )?cookies/i,
  /onetrust/i,
  /ad blocker detected/i,
  /disable your ad blocker/i,
  /turn off your ad blocker/i,
  /whitelist .* to continue reading/i,
  /all rights reserved/i,
  /^\s*(©|\(c\)|copyright)\b/i,
  /^\s*\*\*Notice:\*\*/i,
  /this page displays a fallback/i,
  /✨.*✨/,
];

const KEEP_BYLINE = /^\s*(by|written by|words by|reporting by)\s+[A-Z][^,;]{0,60}$/i;
const KEEP_DATE =
  /^\s*(published|updated|posted)\b|(?:\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4})/i;

/** True when a line carries authorship, publication date, or table data that must survive. Pure. */
function isKeepLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
    return true;
  }
  return KEEP_BYLINE.test(line) || KEEP_DATE.test(line);
}

/** True when a line is nothing but navigation links. Pure. */
function isLinksOnlyLine(line: string): boolean {
  if (!line.includes("](")) {
    return false;
  }
  const remainder = line.replace(NOISE_LINK_PATTERN, "");
  return NOISE_LINKS_ONLY_REMAINDER.test(remainder);
}

/** True for single-line noise: banners, walls, skip links, nav rows, footers. Pure. */
function isNoiseLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return false;
  }
  for (const pattern of NOISE_LINE_PATTERNS) {
    if (pattern.test(line)) {
      return true;
    }
  }
  const linkCount = line.match(NOISE_LINK_PATTERN)?.length ?? 0;
  if (linkCount >= 3) {
    return true;
  }
  if (isLinksOnlyLine(line)) {
    if (/terms of use|privacy policy|sitemap|accessibility|contact us|newsletters/i.test(line)) {
      return true;
    }
    if (linkCount >= 2) {
      return true;
    }
  }
  return false;
}

/**
 * Strip page chrome from rendered markdown: cookie consent banners, ad-block
 * walls, skip links, nav menus, trending/most-viewed sidebars, and footers.
 * Byline, publication date, table, and article body lines survive. Pure.
 */
export function stripNoise(markdown: string): string {
  if (!markdown) {
    return "";
  }
  const lines = markdown.split("\n");
  const out: string[] = [];
  let inSidebar = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (isKeepLine(line)) {
      inSidebar = false;
      out.push(line);
      continue;
    }
    if (inSidebar) {
      if (trimmed.length === 0) {
        continue;
      }
      if (
        NOISE_SIDEBAR_HEADING.test(trimmed) ||
        NOISE_LIST_ITEM.test(line) ||
        NOISE_BARE_LINK.test(line) ||
        isLinksOnlyLine(line) ||
        isNoiseLine(line)
      ) {
        continue;
      }
      inSidebar = false;
      out.push(line);
      continue;
    }
    if (NOISE_SIDEBAR_HEADING.test(trimmed)) {
      inSidebar = true;
      continue;
    }
    if (isNoiseLine(line)) {
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

/**
 * First N non-empty trimmed lines of rendered markdown, each capped.
 * Skips markdown image links, fallback notices, promo banners,
 * single-word headers/lines like Menu or Navigation, and prefers substantive lines (>= 20 chars). Pure.
 */
export function extractProofLines(
  markdown: string,
  maxQuotes: number = RESEARCH_QUOTES_PER_PAGE,
): string[] {
  if (!markdown || maxQuotes <= 0) {
    return [];
  }
  const lines = markdown.split("\n");
  const substantive: string[] = [];
  const otherCandidates: string[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) {
      continue;
    }
    // Skip markdown image links (![...](...))
    if (/!\[.*\]\(.*\)/.test(line)) {
      continue;
    }
    // Skip fallback notices (**Notice:**)
    if (/\*\*Notice:\*\*/i.test(line) || /this page displays a fallback/i.test(line)) {
      continue;
    }
    // Skip promo banners (✨ ... ✨)
    if (/✨.*✨/.test(line)) {
      continue;
    }
    // Skip single-word headers/lines like Menu or Navigation
    if (/^(?:#{1,6}\s*)?(?:menu|navigation|nav|breadcrumbs?|sidebar|toc)\s*:?\s*$/i.test(line)) {
      continue;
    }

    const capped =
      line.length > RESEARCH_QUOTE_CHARS
        ? line.slice(0, RESEARCH_QUOTE_CHARS)
        : line;

    if (line.length >= 20) {
      substantive.push(capped);
    } else {
      otherCandidates.push(capped);
    }
  }

  if (substantive.length >= maxQuotes) {
    return substantive.slice(0, maxQuotes);
  }
  return substantive.concat(otherCandidates).slice(0, maxQuotes);
}

/** Build rendered evidence from a successful scrape payload. Pure. */
export function buildEvidence(input: {
  readonly url: string;
  readonly title: string;
  readonly status?: number;
  readonly markdown: string;
  readonly requestedUrl?: string;
  readonly maxExcerptChars?: number;
}): ResearchEvidence {
  const markdown = stripNoise(input.markdown ?? "");
  const limit = input.maxExcerptChars ?? RESEARCH_EXCERPT_CHARS;
  const excerpt =
    markdown.length > limit
      ? markdown.slice(0, limit)
      : markdown;
  const requestedUrl = input.requestedUrl ?? input.url;
  const redirected = requestedUrl !== input.url;
  const renderedTitleEmpty = (input.title ?? "").trim().length === 0;
  const mismatch =
    renderedTitleEmpty || (input.status !== undefined && input.status !== 200);
  return {
    url: input.url,
    title: input.title || input.url,
    status: input.status,
    excerpt,
    quotes: extractProofLines(markdown),
    requestedUrl,
    redirected,
    mismatch,
  };
}

/** Build placeholder evidence for a failed scrape so the pack stays aligned. Pure. */
export function buildFailedEvidence(
  url: string,
  title: string,
  message: string,
): ResearchEvidence {
  return {
    url,
    title: title || url,
    status: undefined,
    excerpt: `Scrape failed: ${message}`,
    quotes: [],
    requestedUrl: url,
    redirected: false,
    mismatch: true,
  };
}

const SURVEY_CHALLENGE_PATTERNS = [
  "challenge",
  "captcha",
  "cloudflare",
  "just-a-moment",
  "robot-check",
  "access-denied",
  "turnstile",
  "perimeterx",
  "datadome",
  "akamai",
  "edgesuite",
];

/** True when a mapped URL looks like an antibot challenge stub, not content. Pure. */
export function isChallengeStubUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return SURVEY_CHALLENGE_PATTERNS.some((pattern) => lower.includes(pattern));
}

/** Normalize a mapped URL for dedup: trim, drop fragment, drop trailing slashes. Pure. */
export function normalizeSurveyLink(url: string): string {
  const trimmed = url.trim();
  const hash = trimmed.indexOf("#");
  const noFragment = hash >= 0 ? trimmed.slice(0, hash) : trimmed;
  return noFragment.length > 1 ? noFragment.replace(/\/+$/, "") : noFragment;
}

/** Pull link strings out of a map payload (strings or { url } objects). Pure. */
export function extractMapLinks(result: unknown): string[] {
  const links = recordOf(result)["links"];
  if (!Array.isArray(links)) {
    return [];
  }
  const out: string[] = [];
  for (const item of links) {
    if (typeof item === "string") {
      if (item.trim().length > 0) {
        out.push(item.trim());
      }
      continue;
    }
    const url = recordOf(item)["url"];
    if (typeof url === "string" && url.trim().length > 0) {
      out.push(url.trim());
    }
  }
  return out;
}

/** Collapse mapped links to unique normalized URLs and count challenge stubs. Pure. */
export function summarizeSurveyMap(target: string, links: readonly string[]): ResearchSurvey {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const link of links) {
    const key = normalizeSurveyLink(link);
    if (key.length === 0 || seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(key);
  }
  return {
    target,
    discovered: links.length,
    deduped: unique.length,
    challenges: unique.filter(isChallengeStubUrl).length,
    links: unique,
  };
}

const QUERY_SITE_PATTERN = /(?:^|\s)site:\s*([^\s,;()<>"]+)/i;
const QUERY_URL_PATTERN = /https?:\/\/[^\s,;()<>"]+/i;
const QUERY_DOMAIN_PATTERN = /(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}/gi;
const IGNORED_TECH_EXTENSIONS = /\.(?:js|ts|jsx|tsx|vue|mjs|cjs)$/i;

/** Map target for survey: explicit site:/URL in query, else named domain (ignoring tech names like Node.js), else top hit's origin. Pure. */
export function researchMapTarget(
  query: string,
  hits: readonly SearchHit[],
): string | undefined {
  const siteMatch = QUERY_SITE_PATTERN.exec(query);
  if (siteMatch !== null) {
    const token = siteMatch[1];
    try {
      return new URL(token.includes("://") ? token : `https://${token}`).origin;
    } catch {
      // fall through to top hit
    }
  }

  const urlMatch = QUERY_URL_PATTERN.exec(query);
  if (urlMatch !== null) {
    try {
      return new URL(urlMatch[0]).origin;
    } catch {
      // fall through to top hit
    }
  }

  const domainMatches = query.match(QUERY_DOMAIN_PATTERN);
  if (domainMatches !== null) {
    for (const token of domainMatches) {
      if (IGNORED_TECH_EXTENSIONS.test(token)) {
        continue;
      }
      try {
        return new URL(`https://${token}`).origin;
      } catch {
        // continue searching
      }
    }
  }

  const first = hits[0]?.url;
  if (typeof first !== "string" || first.length === 0) {
    return undefined;
  }
  try {
    return new URL(first).origin;
  } catch {
    return undefined;
  }
}

/** Render the survey appendix: map coverage counts. Pure. */
export function formatSurveyAppendix(survey: ResearchSurvey): string {
  return [
    "",
    `Survey (map ${survey.target}, limit ${RESEARCH_SURVEY_MAP_LIMIT}):`,
    "",
    `- Discovered: ${survey.discovered}`,
    `- Deduped: ${survey.deduped}`,
    `- Challenge stubs: ${survey.challenges}`,
  ].join("\n");
}

/**
 * Render the evidence pack. Snippets are discovery signal only, not fact —
 * do not trust or cite them; the rendered page excerpt/quotes below are the
 * source of truth. Pure.
 */
export function formatResearchPack(
  query: string,
  hits: readonly SearchHit[],
  evidences: readonly ResearchEvidence[],
  survey?: ResearchSurvey,
): string {
  if (hits.length === 0) {
    const none = `### Research (${query})\n\nNo results.`;
    return survey === undefined ? none : `${none}\n${formatSurveyAppendix(survey)}`;
  }
  const candidates = hits.map((hit, index) => {
    const snippet = hit.snippet.length > 0 ? `\n  ${hit.snippet}` : "";
    return `${index + 1}. [${hit.title || hit.url}](${hit.url})${snippet}`;
  });
  const sections: string[] = [
    `### Research (${query})`,
    "",
    "Candidates (discovery signal only, not fact — snippets are not truth; do not trust or cite snippets, the rendered section below is the source of truth):",
    "",
    candidates.join("\n\n"),
  ];
  if (evidences.length === 0) {
    sections.push("", "Rendered evidence: none (top scrapes unavailable).");
    const noneRendered = sections.join("\n");
    return survey === undefined ? noneRendered : `${noneRendered}\n${formatSurveyAppendix(survey)}`;
  }
  sections.push("", "Rendered evidence (source of truth — trust and cite only this section):", "");
  evidences.forEach((evidence, index) => {
    const status =
      evidence.status === undefined ? "unknown" : String(evidence.status);
    const redirected =
      evidence.redirected ??
      (evidence.requestedUrl !== undefined &&
        evidence.requestedUrl !== evidence.url);
    const proof =
      evidence.quotes.length > 0
        ? evidence.quotes.map((line) => `> ${line}`).join("\n")
        : "> (no quoted lines)";
    sections.push(
      `## ${index + 1}. ${evidence.title}`,
      `- Source: ${evidence.url}`,
      `- Status: ${status}`,
      `- Provenance: final URL ${evidence.url}, redirect ${redirected ? "yes" : "no"}, status ${status}`,
      "",
      evidence.excerpt,
      "",
      "Proof:",
      proof,
      "",
    );
  });
  const base = sections.join("\n").trimEnd();
  return survey === undefined ? base : `${base}\n${formatSurveyAppendix(survey)}`;
}

function recordOf(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function evidenceFromScrape(
  hit: SearchHit,
  result: unknown,
  maxExcerptChars?: number,
): ResearchEvidence {
  const data = recordOf(recordOf(result)["data"]);
  const metadata = recordOf(data["metadata"]);
  const markdown = typeof data["markdown"] === "string" ? data["markdown"] : "";
  const sourceURL = typeof metadata["sourceURL"] === "string" ? metadata["sourceURL"] : hit.url;
  const rawTitle = typeof metadata["title"] === "string" ? metadata["title"] : "";
  const scrapedTitle = rawTitle || hit.title || hit.url;
  const statusCode = typeof metadata["statusCode"] === "number" ? metadata["statusCode"] : undefined;
  const evidence = buildEvidence({
    url: sourceURL,
    title: scrapedTitle,
    status: statusCode,
    markdown,
    requestedUrl: hit.url,
    maxExcerptChars,
  });
  if (rawTitle.trim().length === 0) {
    return { ...evidence, mismatch: true };
  }
  return evidence;
}

/**
 * Server-side orchestration: Google Search Grounding discovery, then render the top hits
 * with Firecrawl so vague intent resolves to quoted evidence in one call.
 * Survey mode also maps the top domain (limit 10) and appends
 * discovered/deduped/challenge counts; the fast path never calls map.
 */
export async function runResearch(
  client: FirecrawlClient,
  options: ResearchOptions,
  searchFn: (
    query: string,
    numResults: number,
  ) => Promise<readonly SearchHit[]> = searchGoogle,
  mapFn: ResearchMapFn = (url, limit) => client.map({ url, limit }),
): Promise<string> {
  if ((options.mode ?? "fast") !== "survey") {
    const hits = await searchFn(options.query, options.numResults);
    if (hits.length === 0) {
      return formatResearchPack(options.query, hits, []);
    }
    return formatResearchPack(options.query, hits, await renderTopHits(client, options, hits));
  }
  const hits = await searchFn(options.query, options.numResults);
  if (hits.length === 0) {
    const survey = await surveyTopDomain(options.query, hits, mapFn);
    return formatResearchPack(options.query, hits, [], survey);
  }
  const evidences = await renderTopHits(client, options, hits);
  const survey = await surveyTopDomain(options.query, hits, mapFn);
  return formatResearchPack(options.query, hits, evidences, survey);
}

async function renderTopHits(
  client: FirecrawlClient,
  options: ResearchOptions,
  hits: readonly SearchHit[],
): Promise<ResearchEvidence[]> {
  const top = Math.max(0, Math.min(options.scrapeTop, hits.length));
  const evidences: ResearchEvidence[] = [];
  for (const hit of hits.slice(0, top)) {
    try {
      const result = await client.scrape({
        url: hit.url,
        formats: ["markdown"],
        onlyMainContent: true,
        waitFor: options.waitFor,
      });
      evidences.push(evidenceFromScrape(hit, result, options.maxExcerptChars));
    } catch (err) {
      evidences.push(
        buildFailedEvidence(hit.url, hit.title, err instanceof Error ? err.message : String(err)),
      );
    }
  }
  return evidences;
}

async function surveyTopDomain(
  query: string,
  hits: readonly SearchHit[],
  mapFn: ResearchMapFn,
): Promise<ResearchSurvey | undefined> {
  const target = researchMapTarget(query, hits);
  if (target === undefined) {
    return undefined;
  }
  try {
    const result = await mapFn(target, RESEARCH_SURVEY_MAP_LIMIT);
    return summarizeSurveyMap(target, extractMapLinks(result));
  } catch {
    return { target, discovered: 0, deduped: 0, challenges: 0, links: [] };
  }
}
