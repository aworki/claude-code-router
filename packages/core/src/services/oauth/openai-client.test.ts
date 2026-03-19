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

  assert.equal(DEFAULT_OPENAI_TOKEN_ENDPOINT, "https://auth.openai.com/oauth/token");
  assert.equal(OPENAI_OIDC_ISSUER, "https://auth.openai.com");
  assert.equal(seenUrl, "https://auth.openai.com/oauth/token");
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

test("exchangeAuthorizationCode forwards token params and id token validation overrides", async () => {
  let seenBody = "";
  let seenValidationOptions: Record<string, string | undefined> | undefined;
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
    tokenEndpoint: "https://auth.openai.com/oauth/token",
    tokenParams: {
      audience: "https://api.openai.com/v1",
    },
    issuer: "https://auth.openai.com",
    audience: "https://api.openai.com/v1",
    jwksUrl: "https://auth.openai.com/.well-known/jwks.json",
    validateIdToken: async (_idToken, _clientId, options) => {
      seenValidationOptions = options;
      return {
        sub: "acct_123",
        email: "person@example.com",
      };
    },
    fetch: async (_url, init) => {
      seenBody = String(init?.body);
      return new Response(
        JSON.stringify({
          access_token: "new-access-token",
          refresh_token: "refresh-token",
          id_token: "id-token",
          expires_in: 3600,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    },
  });

  await client.exchangeAuthorizationCode({
    code: "auth-code",
    codeVerifier: "pkce-verifier",
    redirectUri: "http://localhost:3456/oauth/callback",
  });

  assert.match(seenBody, /audience=https%3A%2F%2Fapi\.openai\.com%2Fv1/);
  assert.deepEqual(seenValidationOptions, {
    issuer: "https://auth.openai.com",
    audience: "https://api.openai.com/v1",
    jwksUrl: "https://auth.openai.com/.well-known/jwks.json",
  });
});

test("exchangeAuthorizationCode surfaces the token endpoint error body", async () => {
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
    fetch: async () =>
      new Response("invalid_client", {
        status: 401,
        headers: { "content-type": "text/plain" },
      }),
  });

  await assert.rejects(
    client.exchangeAuthorizationCode({
      code: "auth-code",
      codeVerifier: "pkce-verifier",
      redirectUri: "http://localhost:1455/auth/callback",
    }),
    /invalid_client/,
  );
});
