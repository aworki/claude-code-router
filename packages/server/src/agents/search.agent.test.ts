import assert from "node:assert/strict";
import test from "node:test";
import { SearchAgent } from "./search.agent";

test("SearchAgent replaces Anthropic web_search tools with a CCR-managed custom tool", () => {
  const agent = new SearchAgent({
    sidecarManager: {
      ensureStarted: async () => {},
      getBaseUrl: () => "http://127.0.0.1:3460",
    } as any,
  });
  const req = {
    body: {
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
        },
        {
          name: "Edit",
          input_schema: {
            type: "object",
          },
        },
      ],
    },
  };

  assert.equal(agent.shouldHandle(req, { SEARCH_SIDECAR_ENABLED: true }), true);

  agent.reqHandler(req, { SEARCH_SIDECAR_ENABLED: true });

  assert.equal(req.body.tools.length, 2);
  assert.equal(req.body.tools[0].name, "web_search");
  assert.equal(req.body.tools[0].input_schema.required[0], "query");
  assert.equal(req.body.tools[1].name, "Edit");
});

test("SearchAgent web_search handler starts the sidecar and returns DeerFlow-style JSON results", async () => {
  let ensureStartedCalls = 0;
  let fetchCalls = 0;
  const agent = new SearchAgent({
    sidecarManager: {
      ensureStarted: async () => {
        ensureStartedCalls += 1;
      },
      getBaseUrl: () => "http://127.0.0.1:3460",
    } as any,
    fetchImpl: async (input, init) => {
      fetchCalls += 1;
      assert.equal(input, "http://127.0.0.1:3460/search");
      assert.equal(init?.method, "POST");
      assert.match(String(init?.body), /"query":"2026 ai news"/);

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

  const result = await agent.tools.get("web_search")!.handler(
    { query: "2026 ai news" },
    {
      config: {},
      req: {
        id: "req-1",
      },
    },
  );

  assert.equal(ensureStartedCalls, 1);
  assert.equal(fetchCalls, 1);
  assert.match(result, /"title": "AI update"/);
  assert.match(result, /"snippet": "Latest AI update"/);
});
