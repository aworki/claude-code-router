import http from "node:http";
import { searchWithTavily } from "./tavily";

export interface SearchSidecarServerOptions {
  host?: string;
  port?: number;
}

async function readJsonBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function writeJson(
  res: http.ServerResponse,
  statusCode: number,
  payload: Record<string, unknown>,
) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload));
}

export function startSearchSidecarServer(options: SearchSidecarServerOptions = {}) {
  const host = options.host || "127.0.0.1";
  const port = options.port || Number(process.env.SEARCH_SIDECAR_PORT || 3460);

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/health") {
        return writeJson(res, 200, { status: "ok" });
      }

      if (req.method === "POST" && req.url === "/search") {
        const body = await readJsonBody(req);
        const query = typeof body.query === "string" ? body.query : "";
        if (!query.trim()) {
          return writeJson(res, 400, { error: "query is required" });
        }

        const maxResults = Number(
          body.maxResults || process.env.SEARCH_SIDECAR_MAX_RESULTS || 5,
        );
        const results = await searchWithTavily({
          query,
          maxResults: Number.isFinite(maxResults) ? maxResults : 5,
        });

        return writeJson(res, 200, { results });
      }

      return writeJson(res, 404, { error: "not found" });
    } catch (error: any) {
      return writeJson(res, 500, {
        error: error?.message || "search sidecar error",
      });
    }
  });

  server.listen(port, host);
  return server;
}
