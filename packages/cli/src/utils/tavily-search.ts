const TAVILY_SEARCH_URL = "https://api.tavily.com/search";

interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

interface TavilyResponse {
  results?: TavilyResult[];
  answer?: string;
}

export async function tavilySearch(
  apiKey: string,
  query: string,
  signal?: AbortSignal
): Promise<string> {
  const response = await fetch(TAVILY_SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: "basic",
      max_results: 5
    }),
    signal
  });

  if (!response.ok) {
    throw new Error(`Tavily search failed (status ${response.status}).`);
  }

  const data = (await response.json()) as TavilyResponse;
  const parts: string[] = [];

  if (data.answer) {
    parts.push(`Summary: ${data.answer}`);
  }

  for (const result of data.results ?? []) {
    parts.push(`[${result.title}](${result.url})\n${result.content}`);
  }

  return parts.join("\n\n") || "No results found.";
}
