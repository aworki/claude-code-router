import assert from "node:assert/strict";
import test from "node:test";
import {
  createCcrWebSearchMcpHandler,
  getCcrWebSearchToolDefinition,
  readNextJsonRpcMessage,
} from "./ccr-web-search-mcp";

test("getCcrWebSearchToolDefinition exposes the expected MCP tool contract", () => {
  const tool = getCcrWebSearchToolDefinition();

  assert.equal(tool.name, "ccr_web_search");
  assert.match(tool.description, /web/i);
  assert.equal(tool.inputSchema.type, "object");
  assert.deepEqual(tool.inputSchema.required, ["query"]);
  assert.equal(tool.inputSchema.properties.query.type, "string");
  assert.equal(tool.inputSchema.properties.max_results.type, "number");
});

test("createCcrWebSearchMcpHandler returns tools/list payload for Claude MCP clients", async () => {
  const handler = createCcrWebSearchMcpHandler();
  const response = await handler({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
  });

  assert.equal(response?.jsonrpc, "2.0");
  assert.equal(response?.id, 1);
  assert.equal(response?.result.tools.length, 1);
  assert.equal(response?.result.tools[0].name, "ccr_web_search");
});

test("createCcrWebSearchMcpHandler maps ccr_web_search to CCR /api/search", async () => {
  const handler = createCcrWebSearchMcpHandler({
    ccrBaseUrl: "http://127.0.0.1:3456",
    fetchImpl: async (input, init) => {
      assert.equal(input, "http://127.0.0.1:3456/api/search");
      assert.equal(init?.method, "POST");
      assert.match(String(init?.body), /"query":"latest ai news"/);
      assert.match(String(init?.body), /"maxResults":3/);

      return new Response(
        JSON.stringify({
          results: [
            {
              title: "AI update",
              url: "https://example.com/ai",
              snippet: "Latest AI update",
            },
          ],
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    },
  });

  const response = await handler({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "ccr_web_search",
      arguments: {
        query: "latest ai news",
        max_results: 3,
      },
    },
  });

  assert.equal(response?.jsonrpc, "2.0");
  assert.equal(response?.id, 2);
  assert.equal(response?.result.isError, undefined);
  assert.equal(response?.result.content[0].type, "text");
  assert.match(response?.result.content[0].text, /AI update/);
  assert.deepEqual(response?.result.structuredContent.results, [
    {
      title: "AI update",
      url: "https://example.com/ai",
      snippet: "Latest AI update",
    },
  ]);
});

test("createCcrWebSearchMcpHandler rejects blank queries", async () => {
  const handler = createCcrWebSearchMcpHandler();
  const response = await handler({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "ccr_web_search",
      arguments: {
        query: "   ",
      },
    },
  });

  assert.equal(response?.jsonrpc, "2.0");
  assert.equal(response?.id, 3);
  assert.equal(response?.result.isError, true);
  assert.match(response?.result.content[0].text, /query is required/);
});

test("readNextJsonRpcMessage parses LF-only stdio frames", () => {
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
  });
  const buffer = `Content-Length: ${Buffer.byteLength(payload, "utf8")}\n\n${payload}`;

  const parsed = readNextJsonRpcMessage(buffer);

  assert.equal(parsed?.message.jsonrpc, "2.0");
  assert.equal(parsed?.message.id, 1);
  assert.equal(parsed?.message.method, "initialize");
  assert.equal(parsed?.rest, "");
});

test("readNextJsonRpcMessage parses newline-delimited JSON-RPC frames", () => {
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
  });

  const parsed = readNextJsonRpcMessage(`${payload}\n`);

  assert.equal(parsed?.message.jsonrpc, "2.0");
  assert.equal(parsed?.message.id, 1);
  assert.equal(parsed?.message.method, "initialize");
  assert.equal(parsed?.rest, "");
});
