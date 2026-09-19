export class ExaKeyMissingError extends Error {
  constructor() {
    super("EXA_API_KEY is not set (deprecated: Google Search Grounding uses Vertex ADC)");
    this.name = "ExaKeyMissingError";
  }
}

export class SearchUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SearchUnavailableError";
  }
}

export type SearchHit = {
  readonly url: string;
  readonly title: string;
  readonly snippet: string;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    out[key] = entry;
  }
  return out;
}

function snippetFromHit(hit: Record<string, unknown>): string {
  if (typeof hit.snippet === "string" && hit.snippet.length > 0) {
    return hit.snippet;
  }
  const highlights = hit.highlights;
  if (Array.isArray(highlights)) {
    const first = highlights.find((item) => typeof item === "string");
    if (typeof first === "string" && first.length > 0) {
      return first;
    }
  }
  if (typeof hit.text === "string") {
    return hit.text;
  }
  return "";
}

export function parseSearchPayload(payload: unknown): readonly SearchHit[] {
  const root = asRecord(payload);
  const results = root?.results;
  if (!Array.isArray(results)) {
    return [];
  }
  const hits: SearchHit[] = [];
  for (const item of results) {
    const hit = asRecord(item);
    if (hit === undefined || typeof hit.url !== "string" || hit.url.length === 0) {
      continue;
    }
    hits.push({
      url: hit.url,
      title: typeof hit.title === "string" ? hit.title : "",
      snippet: snippetFromHit(hit),
    });
  }
  return hits;
}

export const parseExaSearch = parseSearchPayload;

export async function searchGoogle(
  query: string,
  numResults: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<readonly SearchHit[]> {
  const proxyUrl = (env.VERTEX_PROXY_URL || "http://127.0.0.1:8088").replace(/\/+$/, "");
  const capped =
    numResults < 1 ? 1 : numResults > 10 ? 10 : Math.floor(numResults);
  const response = await fetch(`${proxyUrl}/v1/search`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query,
      numResults: capped,
    }),
    signal: AbortSignal.timeout(25000),
  });
  const bodyText = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    throw new SearchUnavailableError(
      `Invalid JSON from Search Proxy (HTTP ${response.status}): ${bodyText.slice(0, 200)}`,
    );
  }
  if (!response.ok) {
    const errBody = asRecord(payload);
    const message =
      typeof errBody?.error === "string"
        ? errBody.error
        : `Search failed with HTTP ${response.status}`;
    throw new SearchUnavailableError(message);
  }
  return parseSearchPayload(payload);
}

export const searchExa = searchGoogle;

export function formatSearchHits(
  query: string,
  hits: readonly SearchHit[],
): string {
  if (hits.length === 0) {
    return `### Search (${query})\n\nNo results.`;
  }
  const lines = hits.map((hit, index) => {
    const snippet = hit.snippet.length > 0 ? `\n  ${hit.snippet}` : "";
    return `${index + 1}. [${hit.title || hit.url}](${hit.url})${snippet}`;
  });
  return `### Search (${query})\n\n${lines.join("\n\n")}`;
}
