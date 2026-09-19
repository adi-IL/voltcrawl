/**
 * Firecrawl API client connecting to self-hosted Firecrawl on volt-rust.
 */

export interface FirecrawlClientOptions {
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
}

export class FirecrawlClient {
  private baseUrl: string;
  private apiKey?: string;
  private timeoutMs: number;

  constructor(options: FirecrawlClientOptions = {}) {
    this.baseUrl = (options.baseUrl || process.env.FIRECRAWL_API_URL || "http://localhost:3002").replace(/\/$/, "");
    this.apiKey = options.apiKey || process.env.FIRECRAWL_API_KEY;
    this.timeoutMs = options.timeoutMs || 60000;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "voltcrawl/1.0",
    };
    if (this.apiKey && this.apiKey !== "none") {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  async checkHealth(): Promise<{ status: string; url: string; ready: boolean }> {
    try {
      const resp = await fetch(`${this.baseUrl}/v0/health/readiness`, {
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) {
        return { status: `HTTP ${resp.status}`, url: this.baseUrl, ready: false };
      }
      const data = (await resp.json()) as { status?: string };
      return { status: data.status || "ok", url: this.baseUrl, ready: true };
    } catch (err: any) {
      return { status: `Connection error: ${err.message}`, url: this.baseUrl, ready: false };
    }
  }

  async scrape(params: {
    url: string;
    formats?: string[];
    onlyMainContent?: boolean;
    waitFor?: number;
    jsonPrompt?: string;
    jsonSchema?: Record<string, any>;
  }): Promise<any> {
    const formatsPayload: Array<string | { type: string; prompt?: string; schema?: Record<string, unknown> }> = [];

    // Add plain formats (excluding 'json' which is converted to an object below)
    for (const f of params.formats || ["markdown"]) {
      if (f !== "json") {
        formatsPayload.push(f);
      }
    }

    // If AI extraction prompt/schema provided or 'json' was requested in formats, add json format object
    if (params.jsonPrompt || params.jsonSchema || params.formats?.includes("json")) {
      const jsonFormatObj: { type: string; prompt?: string; schema?: Record<string, unknown> } = { type: "json" };
      if (params.jsonPrompt) jsonFormatObj.prompt = params.jsonPrompt;
      if (params.jsonSchema) jsonFormatObj.schema = params.jsonSchema;
      formatsPayload.push(jsonFormatObj);
    }
    const payload = {
      url: params.url,
      formats: formatsPayload,
      onlyMainContent: params.onlyMainContent ?? true,
      waitFor: params.waitFor ?? 1000,
    };

    const resp = await fetch(`${this.baseUrl}/v2/scrape`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    const bodyText = await resp.text();
    let data: any;
    try {
      data = JSON.parse(bodyText);
    } catch {
      throw new Error(`Invalid JSON response from Firecrawl (HTTP ${resp.status}): ${bodyText}`);
    }

    if (!resp.ok || !data.success) {
      throw new Error(data.error || `Firecrawl request failed with HTTP ${resp.status}`);
    }

    return data;
  }

  async map(params: { url: string; search?: string; limit?: number }): Promise<any> {
    const payload = {
      url: params.url,
      search: params.search,
      limit: params.limit || 50,
    };

    const resp = await fetch(`${this.baseUrl}/v2/map`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    const data = (await resp.json()) as any;
    if (!resp.ok || !data.success) {
      throw new Error(data.error || `Firecrawl map failed with HTTP ${resp.status}`);
    }
    return data;
  }

  async crawl(params: {
    url: string;
    limit?: number;
    maxDiscoveryDepth?: number;
  }): Promise<any> {
    const payload = {
      url: params.url,
      limit: params.limit || 10,
      maxDiscoveryDepth: params.maxDiscoveryDepth || 2,
    };

    const resp = await fetch(`${this.baseUrl}/v2/crawl`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    const data = (await resp.json()) as any;
    if (!resp.ok || !data.success) {
      throw new Error(data.error || `Firecrawl crawl failed with HTTP ${resp.status}`);
    }
    return data;
  }

  async getCrawlStatus(id: string): Promise<any> {
    const resp = await fetch(`${this.baseUrl}/v2/crawl/${encodeURIComponent(id)}`, {
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(10000),
    });

    const data = (await resp.json()) as any;
    if (!resp.ok || !data.success) {
      throw new Error(data.error || `Firecrawl status query failed with HTTP ${resp.status}`);
    }
    return data;
  }
}
