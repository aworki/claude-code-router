import assert from "node:assert/strict";
import test from "node:test";
import {
  readCodexCliCredential,
  selectCodexImportedAccountId,
  syncCodexCliCredentialToVault,
} from "./codex-cli-sync";
import type { StoredTokenBundle } from "./types";

test("reads Codex CLI credentials from auth.json and decodes expiry from the access token", () => {
  const exp = Math.floor(Date.parse("2026-03-20T00:00:00.000Z") / 1000);
  const accessToken = createJwt({ exp, sub: "windowslive|acct_123", email: "person@example.com" });

  const credential = readCodexCliCredential({
    readFileSync(filePath) {
      assert.match(filePath, /auth\.json$/);
      return JSON.stringify({
        tokens: {
          access_token: accessToken,
          refresh_token: "refresh-token",
          account_id: "windowslive|acct_123",
        },
      });
    },
    statSync() {
      return {
        mtimeMs: Date.parse("2026-03-19T00:00:00.000Z"),
      } as any;
    },
    existsSync() {
      return true;
    },
    platform: "linux",
  });

  assert.deepEqual(credential, {
    accountId: "windowslive|acct_123",
    accessToken,
    refreshToken: "refresh-token",
    email: "person@example.com",
    expiresAt: "2026-03-20T00:00:00.000Z",
    invalid: false,
    source: "codex-cli",
  });
});

test("prefers the active codex-auth account from registry.json over the default auth.json", () => {
  const exp = Math.floor(Date.parse("2026-03-22T00:00:00.000Z") / 1000);
  const activeAccessToken = createJwt({
    exp,
    sub: "auth0|current-user",
    email: "current@example.com",
  });
  const fallbackAccessToken = createJwt({
    exp: Math.floor(Date.parse("2026-03-21T00:00:00.000Z") / 1000),
    sub: "auth0|fallback-user",
    email: "fallback@example.com",
  });

  const credential = readCodexCliCredential({
    existsSync(filePath) {
      return /registry\.json$|\.auth\.json$|auth\.json$/.test(filePath);
    },
    readFileSync(filePath) {
      if (/registry\.json$/.test(filePath)) {
        return JSON.stringify({
          active_account_key: "user-current::acct-current",
        });
      }

      if (/dXNlci1jdXJyZW50OjphY2N0LWN1cnJlbnQ\.auth\.json$/.test(filePath)) {
        return JSON.stringify({
          tokens: {
            access_token: activeAccessToken,
            refresh_token: "current-refresh-token",
            account_id: "acct-current",
          },
          last_refresh: "2026-03-21T01:02:03.000Z",
        });
      }

      if (/auth\.json$/.test(filePath)) {
        return JSON.stringify({
          tokens: {
            access_token: fallbackAccessToken,
            refresh_token: "fallback-refresh-token",
            account_id: "acct-fallback",
          },
        });
      }

      throw new Error(`Unexpected file read: ${filePath}`);
    },
    statSync() {
      return {
        mtimeMs: Date.parse("2026-03-20T00:00:00.000Z"),
      } as any;
    },
    platform: "linux",
  });

  assert.deepEqual(credential, {
    accountId: "acct-current",
    accessToken: activeAccessToken,
    refreshToken: "current-refresh-token",
    email: "current@example.com",
    expiresAt: "2026-03-22T00:00:00.000Z",
    invalid: false,
    source: "codex-cli",
  });
});

test("falls back to file mtime when the JWT does not include an exp claim", () => {
  const accessToken = createJwt({ sub: "windowslive|acct_123" });

  const credential = readCodexCliCredential({
    readFileSync() {
      return JSON.stringify({
        tokens: {
          access_token: accessToken,
          refresh_token: "refresh-token",
          account_id: "windowslive|acct_123",
        },
      });
    },
    statSync() {
      return {
        mtimeMs: Date.parse("2026-03-19T00:00:00.000Z"),
      } as any;
    },
    existsSync() {
      return true;
    },
    platform: "linux",
  });

  assert.equal(credential?.expiresAt, "2026-03-19T01:00:00.000Z");
});

test("selects the imported account id when there is exactly one valid bundle", () => {
  const accountId = selectCodexImportedAccountId([
    {
      accountId: "windowslive|acct_123",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: "2026-03-20T00:00:00.000Z",
      invalid: false,
    },
  ]);

  assert.equal(accountId, "windowslive|acct_123");
});

test("selects the first valid account when multiple valid bundles exist", () => {
  const bundles: StoredTokenBundle[] = [
    {
      accountId: "windowslive|acct_123",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: "2026-03-20T00:00:00.000Z",
      invalid: false,
    },
    {
      accountId: "windowslive|acct_456",
      accessToken: "access-token-2",
      refreshToken: "refresh-token-2",
      expiresAt: "2026-03-21T00:00:00.000Z",
      invalid: false,
    },
  ];

  assert.equal(selectCodexImportedAccountId(bundles), "windowslive|acct_123");
});

test("syncCodexCliCredentialToVault stops when another account already uses the same email", async () => {
  let saveCalls = 0;
  const vault = {
    async save() {
      saveCalls += 1;
    },
    async get() {
      return null;
    },
    async list() {
      return [
        {
          accountId: "oauth-account-1",
          accessToken: "existing-access-token",
          refreshToken: "existing-refresh-token",
          email: "Person@Example.com",
          source: "oauth" as const,
          expiresAt: "2026-03-20T00:00:00.000Z",
          invalid: false,
        },
      ];
    },
    async markInvalid() {
      return false;
    },
  };

  await assert.rejects(
    syncCodexCliCredentialToVault(vault, {
      readFileSync() {
        return JSON.stringify({
          tokens: {
            access_token: createJwt({ exp: 1773878400, sub: "windowslive|acct_123", email: "person@example.com" }),
            refresh_token: "refresh-token",
            account_id: "windowslive|acct_123",
          },
        });
      },
      statSync() {
        return {
          mtimeMs: Date.parse("2026-03-19T00:00:00.000Z"),
        } as any;
      },
      existsSync() {
        return true;
      },
      platform: "linux",
    }),
    /email.*person@example\.com.*oauth/i,
  );

  assert.equal(saveCalls, 0);
});

function createJwt(payload: Record<string, unknown>) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.signature`;
}
