import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_OPENAI_TOKEN_ENDPOINT, OpenAIOAuthClient } from "./openai-client";
import { OPENAI_OIDC_ISSUER } from "./jwks";
import type { StoredTokenBundle, TokenVault } from "./types";

test("refresh uses the current OpenID token endpoint default", async () => {
  let seenUrl = "";
  const vault: TokenVault = {
    async save() {},
    async get() {
      return null;
    },
    async list() {
      return [];
    },
    async markInvalid() {
      return false;
    },
  };

  const client = new OpenAIOAuthClient({
    clientId: "client-123",
    vault,
    fetch: async (url) => {
      seenUrl = String(url);
      return new Response(
        JSON.stringify({
          access_token: "new-access-token",
          refresh_token: "refresh-token",
          expires_in: 3600,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    },
  });

  await client.refresh({
    accountId: "user-1234",
    refreshToken: "refresh-token",
  });

  assert.equal(DEFAULT_OPENAI_TOKEN_ENDPOINT, "https://auth0.openai.com/oauth/token");
  assert.equal(OPENAI_OIDC_ISSUER, "https://auth0.openai.com/");
  assert.equal(seenUrl, "https://auth0.openai.com/oauth/token");
});

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
    async markInvalid() {
      return false;
    },
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

test("invalid_grant from an old refresh token does not invalidate a newer rotated token", async () => {
  let current: StoredTokenBundle = {
    accountId: "user-1234",
    accessToken: "fresh-access-token",
    refreshToken: "rotated-refresh-token",
    expiresAt: "2026-03-19T15:00:00Z",
  };
  const invalidated: string[] = [];

  const vault: TokenVault = {
    async save(bundle) {
      current = bundle;
    },
    async get() {
      return current;
    },
    async list() {
      return [current];
    },
    async markInvalid(accountId, refreshToken) {
      if (accountId === current.accountId && refreshToken === current.refreshToken) {
        invalidated.push(refreshToken);
        current = { ...current, invalid: true };
        return true;
      }
      return false;
    },
  };

  const client = new OpenAIOAuthClient({
    clientId: "client-123",
    vault,
    fetch: async () =>
      new Response(
        JSON.stringify({
          error: "invalid_grant",
          error_description: "refresh token is no longer valid",
        }),
        {
          status: 400,
          headers: { "content-type": "application/json" },
        },
      ),
  });

  await assert.rejects(
    client.refresh({
      accountId: "user-1234",
      refreshToken: "old-refresh-token",
    }),
    /refresh token is no longer valid/,
  );

  assert.deepEqual(invalidated, []);
  assert.equal(current.invalid, undefined);
  assert.equal(current.refreshToken, "rotated-refresh-token");
});
