import assert from "node:assert/strict";
import test from "node:test";
import { OAuthService } from "./service";
import type { CodexAuthAccount } from "./types";

test("buildRequestAuth uses the active codex account when account_id is empty", async () => {
  const activeAccount = makeAccount({
    accountId: "active-account",
    email: "active@example.com",
    accessToken: createJwt({
      sub: "auth0|active-account",
      email: "active@example.com",
    }),
  });
  const service = new OAuthService({
    codexAuthSource: {
      getActiveAccount: async () => activeAccount,
      getAccountById: async () => null,
    },
  } as any);

  const result = await service.buildRequestAuth({
    name: "codex-auth",
    auth_strategy: "codex-auth",
    api_key: "",
    account_id: "",
    oauth: {
      client_id: "client-id",
      scopes: ["openid"],
    },
  });

  assert.equal(result.headers.Authorization, `Bearer ${activeAccount.accessToken}`);
  assert.equal(result.headers["chatgpt-account-id"], activeAccount.accountId);
  assert.equal(result.headers.originator, "pi");
  assert.match(result.headers["User-Agent"], /^pi \(/);
});

test("buildRequestAuth uses the requested codex account when account_id is set", async () => {
  const requestedAccount = makeAccount({
    accountId: "requested-account",
    email: "requested@example.com",
    accessToken: createJwt({
      sub: "auth0|requested-account",
      email: "requested@example.com",
    }),
  });
  const service = new OAuthService({
    codexAuthSource: {
      getActiveAccount: async () => null,
      getAccountById: async (accountId: string) =>
        accountId === requestedAccount.accountId ? requestedAccount : null,
    },
  } as any);

  const result = await service.buildRequestAuth({
    name: "codex-auth",
    auth_strategy: "codex-auth",
    api_key: "",
    account_id: requestedAccount.accountId,
    oauth: {
      client_id: "client-id",
      scopes: ["openid"],
    },
  });

  assert.equal(result.headers.Authorization, `Bearer ${requestedAccount.accessToken}`);
  assert.equal(result.headers["chatgpt-account-id"], requestedAccount.accountId);
});

test("buildRequestAuth throws reauth_required when no codex account exists", async () => {
  const service = new OAuthService({
    codexAuthSource: {
      getActiveAccount: async () => null,
      getAccountById: async () => null,
    },
  } as any);

  await assert.rejects(
    () =>
      service.buildRequestAuth({
        name: "codex-auth",
        auth_strategy: "codex-auth",
        api_key: "",
        account_id: "",
        oauth: {
          client_id: "client-id",
          scopes: ["openid"],
        },
      }),
    (error: any) => error?.code === "reauth_required" && error.message === "reauth_required",
  );
});

test("buildRequestAuth falls back to API key for non-codex providers", async () => {
  const service = new OAuthService();

  const result = await service.buildRequestAuth({
    name: "openai",
    auth_strategy: "api-key",
    apiKey: "provider-api-key",
  } as any);

  assert.deepEqual(result.headers, {
    Authorization: "Bearer provider-api-key",
  });
});

function makeAccount(overrides: Partial<CodexAuthAccount>): CodexAuthAccount {
  return {
    accountId: overrides.accountId ?? "account-id",
    email: overrides.email,
    accessToken: overrides.accessToken ?? createJwt({
      sub: `auth0|${overrides.accountId ?? "account-id"}`,
      email: overrides.email ?? "account@example.com",
    }),
    refreshToken: overrides.refreshToken ?? "refresh-token",
    expiresAt: overrides.expiresAt ?? "2026-03-24T01:00:00.000Z",
    source: "codex-cli",
    invalid: false,
  };
}

function createJwt(payload: Record<string, unknown>) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.signature`;
}
