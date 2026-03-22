import { IAgent, ITool } from "./type";
import { SearchSidecarManager, searchSidecarManager } from "../search/sidecar-manager";
import { searchWithManagedSidecar } from "../search/search-service";

interface SearchAgentOptions {
  sidecarManager?: Pick<SearchSidecarManager, "ensureStarted" | "getBaseUrl">;
  fetchImpl?: typeof fetch;
}

function isWebSearchTool(tool: any): boolean {
  return (
    tool?.type?.startsWith?.("web_search") ||
    tool?.name === "web_search"
  );
}

export class SearchAgent implements IAgent {
  name = "search";
  tools: Map<string, ITool>;
  private readonly sidecarManager: Pick<SearchSidecarManager, "ensureStarted" | "getBaseUrl">;
  private readonly fetchImpl: typeof fetch;

  constructor(options: SearchAgentOptions = {}) {
    this.sidecarManager = options.sidecarManager || searchSidecarManager;
    this.fetchImpl = options.fetchImpl || fetch;
    this.tools = new Map<string, ITool>();
    this.appendTools();
  }

  shouldHandle(req: any, config: any): boolean {
    const enabled =
      config.SEARCH_SIDECAR_ENABLED === true ||
      config.SEARCH_SIDECAR_ENABLED === "true";

    if (!enabled) {
      return false;
    }

    return Array.isArray(req.body?.tools) && req.body.tools.some(isWebSearchTool);
  }

  reqHandler(req: any, _config: any): void {
    if (!Array.isArray(req.body?.tools)) {
      req.body.tools = [];
    }

    req.body.tools = req.body.tools.filter((tool: any) => !isWebSearchTool(tool));
    req.body.tools.unshift({
      name: "web_search",
      description:
        "Search the public web and return a list of result objects with title, url, and snippet.",
      input_schema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "A concrete web search query.",
          },
        },
        required: ["query"],
      },
    });
  }

  private appendTools() {
    this.tools.set("web_search", {
      name: "web_search",
      description:
        "Search the public web and return DeerFlow-style results as JSON.",
      input_schema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "A concrete web search query.",
          },
        },
        required: ["query"],
      },
      handler: async (args) => {
        try {
          const results = await searchWithManagedSidecar({
            query: typeof args?.query === "string" ? args.query : "",
            sidecarManager: this.sidecarManager,
            fetchImpl: this.fetchImpl,
          });
          return JSON.stringify(results, null, 2);
        } catch (error: any) {
          return `Error: ${error?.message || "search failed"}`;
        }
      },
    });
  }
}

export const searchAgent = new SearchAgent();
