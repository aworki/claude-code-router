interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: any;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: any;
  error?: {
    code: number;
    message: string;
  };
}

interface CcrWebSearchMcpHandlerOptions {
  ccrBaseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface ParsedJsonRpcMessage {
  message: JsonRpcRequest;
  rest: string;
  transport: "content-length" | "jsonl";
}

const DEFAULT_CCR_PORT = 3456;
const DEFAULT_PROTOCOL_VERSION = "2024-11-05";
const DEBUG_LOG_PATH = process.env.CCR_WEB_SEARCH_MCP_DEBUG_LOG?.trim();

function appendDebugLog(message: string) {
  if (!DEBUG_LOG_PATH) {
    return;
  }

  try {
    require("node:fs").appendFileSync(
      DEBUG_LOG_PATH,
      `[${new Date().toISOString()}] ${message}\n`,
      "utf8",
    );
  } catch {}
}

export function getCcrBaseUrl() {
  const explicitBaseUrl = process.env.CCR_BASE_URL?.trim();
  if (explicitBaseUrl) {
    return explicitBaseUrl.replace(/\/+$/, "");
  }

  const port = Number(process.env.CCR_PORT || DEFAULT_CCR_PORT);
  const normalizedPort = Number.isFinite(port) ? port : DEFAULT_CCR_PORT;
  return `http://127.0.0.1:${normalizedPort}`;
}

export function getCcrWebSearchToolDefinition() {
  return {
    name: "ccr_web_search",
    description:
      "Search the public web through Claude Code Router and return result objects with title, url, and snippet.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The concrete web search query to run.",
        },
        max_results: {
          type: "number",
          description: "Optional maximum number of search results to return.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  };
}

function createSuccessResponse(
  id: string | number | null,
  result: any,
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

function createErrorResponse(
  id: string | number | null,
  code: number,
  message: string,
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  };
}

async function runCcrWebSearch(
  args: any,
  options: CcrWebSearchMcpHandlerOptions,
) {
  const query = typeof args?.query === "string" ? args.query.trim() : "";
  if (!query) {
    throw new Error("query is required");
  }

  const maxResults =
    typeof args?.max_results === "number" && Number.isFinite(args.max_results)
      ? args.max_results
      : undefined;

  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(`${getBaseUrlFromOptions(options)}/api/search`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query,
      ...(typeof maxResults === "number" ? { maxResults } : {}),
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.error) {
    throw new Error(payload?.error || response.statusText || "search failed");
  }

  return Array.isArray(payload?.results) ? payload.results : [];
}

function getBaseUrlFromOptions(options: CcrWebSearchMcpHandlerOptions) {
  return (options.ccrBaseUrl || getCcrBaseUrl()).replace(/\/+$/, "");
}

export function createCcrWebSearchMcpHandler(
  options: CcrWebSearchMcpHandlerOptions = {},
) {
  return async (request: JsonRpcRequest): Promise<JsonRpcResponse | null> => {
    const id = request?.id ?? null;

    if (!request?.method) {
      return createErrorResponse(id, -32600, "Invalid Request");
    }

    if (request.method === "notifications/initialized") {
      return null;
    }

    if (request.method === "ping") {
      return createSuccessResponse(id, {});
    }

    if (request.method === "initialize") {
      return createSuccessResponse(id, {
        protocolVersion:
          typeof request.params?.protocolVersion === "string"
            ? request.params.protocolVersion
            : DEFAULT_PROTOCOL_VERSION,
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: "ccr-web-search",
          version: "1.0.0",
        },
      });
    }

    if (request.method === "tools/list") {
      return createSuccessResponse(id, {
        tools: [getCcrWebSearchToolDefinition()],
      });
    }

    if (request.method === "tools/call") {
      const toolName = request.params?.name;
      if (toolName !== "ccr_web_search") {
        return createErrorResponse(id, -32601, `Unknown tool: ${toolName}`);
      }

      try {
        const results = await runCcrWebSearch(request.params?.arguments, options);
        return createSuccessResponse(id, {
          content: [
            {
              type: "text",
              text: JSON.stringify(results, null, 2),
            },
          ],
          structuredContent: {
            results,
          },
        });
      } catch (error: any) {
        return createSuccessResponse(id, {
          content: [
            {
              type: "text",
              text: `Error: ${error?.message || "search failed"}`,
            },
          ],
          isError: true,
        });
      }
    }

    return createErrorResponse(id, -32601, `Method not found: ${request.method}`);
  };
}

function serializeMessage(
  message: JsonRpcResponse,
  transport: "content-length" | "jsonl",
) {
  const body = JSON.stringify(message);
  appendDebugLog(`OUT ${body}`);
  if (transport === "jsonl") {
    return `${body}\n`;
  }

  return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
}

function findHeaderBoundary(buffer: string) {
  const crlfBoundary = buffer.indexOf("\r\n\r\n");
  const lfBoundary = buffer.indexOf("\n\n");

  if (crlfBoundary === -1) {
    return lfBoundary === -1 ? null : { index: lfBoundary, separatorLength: 2 };
  }

  if (lfBoundary === -1 || crlfBoundary < lfBoundary) {
    return { index: crlfBoundary, separatorLength: 4 };
  }

  return { index: lfBoundary, separatorLength: 2 };
}

export function readNextJsonRpcMessage(
  buffer: string,
): ParsedJsonRpcMessage | null {
  const boundary = findHeaderBoundary(buffer);
  if (!boundary) {
    const newlineIndex = buffer.indexOf("\n");
    if (newlineIndex === -1) {
      return null;
    }

    const line = buffer.slice(0, newlineIndex).trim();
    if (!line) {
      return readNextJsonRpcMessage(buffer.slice(newlineIndex + 1));
    }

    return {
      message: JSON.parse(line),
      rest: buffer.slice(newlineIndex + 1),
      transport: "jsonl",
    };
  }

  const header = buffer.slice(0, boundary.index);
  const contentLengthMatch = header.match(/content-length:\s*(\d+)/i);
  if (!contentLengthMatch) {
    return null;
  }

  const contentLength = Number(contentLengthMatch[1]);
  const messageStart = boundary.index + boundary.separatorLength;
  const messageEnd = messageStart + contentLength;
  if (buffer.length < messageEnd) {
    return null;
  }

  return {
    message: JSON.parse(buffer.slice(messageStart, messageEnd)),
    rest: buffer.slice(messageEnd),
    transport: "content-length",
  };
}

export function runCcrWebSearchMcpServer(
  options: CcrWebSearchMcpHandlerOptions = {},
) {
  const handler = createCcrWebSearchMcpHandler(options);
  let buffer = "";
  let outputTransport: "content-length" | "jsonl" = "content-length";
  appendDebugLog(
    `START pid=${process.pid} argv=${JSON.stringify(process.argv)} env=${JSON.stringify({
      CCR_BASE_URL: process.env.CCR_BASE_URL,
      CCR_WEB_SEARCH_MCP_DEBUG_LOG: process.env.CCR_WEB_SEARCH_MCP_DEBUG_LOG,
    })}`,
  );

  process.stdin.setEncoding("utf8");
  process.stdin.on("data", async (chunk) => {
    buffer += chunk;
    appendDebugLog(`IN_CHUNK ${JSON.stringify(chunk)}`);

    while (true) {
      const parsed = readNextJsonRpcMessage(buffer);
      if (!parsed) {
        return;
      }

      buffer = parsed.rest;
      outputTransport = parsed.transport;

      let request: JsonRpcRequest;
      try {
        request = parsed.message;
        appendDebugLog(`IN_MSG ${JSON.stringify(request)}`);
      } catch {
        const response = createErrorResponse(null, -32700, "Parse error");
        process.stdout.write(serializeMessage(response, outputTransport));
        continue;
      }

      try {
        const response = await handler(request);
        if (response) {
          process.stdout.write(serializeMessage(response, outputTransport));
        }
      } catch (error: any) {
        const response = createErrorResponse(
          request.id ?? null,
          -32603,
          error?.message || "Internal error",
        );
        process.stdout.write(serializeMessage(response, outputTransport));
      }
    }
  });

  process.stdin.resume();
}
