import {
  SearchSidecarManager,
  searchSidecarManager,
} from "./sidecar-manager";
import { DeerFlowSearchResult } from "./tavily";

export interface SearchWithManagedSidecarOptions {
  query: string;
  maxResults?: number;
  sidecarManager?: Pick<SearchSidecarManager, "ensureStarted" | "getBaseUrl">;
  fetchImpl?: typeof fetch;
}

export async function searchWithManagedSidecar(
  options: SearchWithManagedSidecarOptions,
): Promise<DeerFlowSearchResult[]> {
  const query = typeof options.query === "string" ? options.query.trim() : "";
  if (!query) {
    throw new Error("query is required");
  }

  const sidecarManager = options.sidecarManager || searchSidecarManager;
  const fetchImpl = options.fetchImpl || fetch;

  await sidecarManager.ensureStarted();
  const response = await fetchImpl(`${sidecarManager.getBaseUrl()}/search`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query,
      ...(typeof options.maxResults === "number"
        ? { maxResults: options.maxResults }
        : {}),
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.error) {
    throw new Error(payload?.error || response.statusText || "search failed");
  }

  return Array.isArray(payload?.results) ? payload.results : [];
}
