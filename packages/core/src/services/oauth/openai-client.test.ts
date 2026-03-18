import assert from "node:assert/strict";
import test from "node:test";
import { OpenAIOAuthClient } from "./openai-client";
import type { StoredTokenBundle, TokenVault } from "./types";

test("refresh replaces rotated tokens atomically", async () => {
  const saved: StoredTokenBundle[] = [];
  const vault: TokenVault = {
    async save(bundle) {
      saved.push(bundle);
    },
    async get() {
      return null;
    },
    async list() {
      return [];
    },
    async markInvalid() {},
  };

  const client = new OpenAIOAuthClient({
    clientId: "client-123",
    vault,
    fetch: async () =>
      new Response(
        JSON.stringify({
          access_token: "new-access-token",
          refresh_token: "rotated-refresh-token",
          expires_in: 3600,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
  });

  const refreshed = await client.refresh({
    accountId: "user-1234",
    refreshToken: "refresh-token",
  });

  assert.equal(refreshed.accountId, "user-1234");
  assert.equal(refreshed.accessToken, "new-access-token");
  assert.equal(refreshed.refreshToken, "rotated-refresh-token");
  assert.equal(saved.length, 1);
  assert.equal(saved[0]?.refreshToken, "rotated-refresh-token");
});
