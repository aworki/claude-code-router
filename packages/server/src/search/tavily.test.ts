import assert from "node:assert/strict";
import test from "node:test";
import { searchWithTavily } from "./tavily";

test("searchWithTavily normalizes Tavily results to DeerFlow-style search output", async () => {
  const result = await searchWithTavily({
    query: "latest ai news",
    apiKey: "test-key",
    maxResults: 3,
    fetchImpl: async (input, init) => {
      assert.equal(input, "https://api.tavily.com/search");
      assert.equal(init?.method, "POST");
      assert.match(String(init?.body), /"query":"latest ai news"/);

      return new Response(
        JSON.stringify({
          results: [
            {
              title: "OpenAI launches something",
              url: "https://example.com/openai",
              content: "A short summary from Tavily",
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

  assert.deepEqual(result, [
    {
      title: "OpenAI launches something",
      url: "https://example.com/openai",
      snippet: "A short summary from Tavily",
    },
  ]);
});

test("searchWithTavily throws when the API key is missing", async () => {
  await assert.rejects(
    () =>
      searchWithTavily({
        query: "latest ai news",
      }),
    /TAVILY_API_KEY is required/,
  );
});
