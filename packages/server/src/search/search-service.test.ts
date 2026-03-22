import assert from "node:assert/strict";
import test from "node:test";
import { searchWithManagedSidecar } from "./search-service";

test("searchWithManagedSidecar starts the sidecar and returns normalized results", async () => {
  let ensureStartedCalls = 0;
  let fetchCalls = 0;

  const results = await searchWithManagedSidecar({
    query: "2026 ai news",
    maxResults: 3,
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

  assert.equal(ensureStartedCalls, 1);
  assert.equal(fetchCalls, 1);
  assert.deepEqual(results, [
    {
      title: "AI update",
      url: "https://example.com/ai",
      snippet: "Latest AI update",
    },
  ]);
});

test("searchWithManagedSidecar surfaces search errors", async () => {
  await assert.rejects(
    () =>
      searchWithManagedSidecar({
        query: "2026 ai news",
        sidecarManager: {
          ensureStarted: async () => {},
          getBaseUrl: () => "http://127.0.0.1:3460",
        } as any,
        fetchImpl: async () =>
          new Response(JSON.stringify({ error: "search unavailable" }), {
            status: 503,
            headers: {
              "content-type": "application/json",
            },
          }),
      }),
    /search unavailable/,
  );
});
