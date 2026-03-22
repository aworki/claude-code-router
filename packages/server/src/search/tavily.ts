export interface DeerFlowSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchWithTavilyOptions {
  query: string;
  apiKey?: string;
  maxResults?: number;
  fetchImpl?: typeof fetch;
}

function normalizeResults(payload: any): DeerFlowSearchResult[] {
  if (!Array.isArray(payload?.results)) {
    return [];
  }

  return payload.results
    .filter((result: any) => result?.title && result?.url)
    .map((result: any) => ({
      title: String(result.title),
      url: String(result.url),
      snippet: String(result.content || ""),
    }));
}

export async function searchWithTavily(
  options: SearchWithTavilyOptions,
): Promise<DeerFlowSearchResult[]> {
  const query = options.query?.trim();
  if (!query) {
    throw new Error("query is required");
  }

  const apiKey = options.apiKey || process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error("TAVILY_API_KEY is required");
  }

  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      max_results: options.maxResults ?? 5,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Tavily API returned ${response.status}: ${errorText || response.statusText}`);
  }

  const payload = await response.json();
  return normalizeResults(payload);
}
