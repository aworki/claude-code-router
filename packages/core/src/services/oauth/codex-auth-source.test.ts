import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  getActiveCodexAuthAccount,
  getCodexAuthAccountById,
  listCodexAuthAccounts,
} from "./codex-auth-source";

test("listCodexAuthAccounts reads all accounts from registry.json", async () => {
  const codexHome = await createCodexHome([
    {
      accountKey: "user-current::acct-current",
      accountId: "acct-current",
      email: "current@example.com",
      exp: "2026-03-22T00:00:00.000Z",
    },
    {
      accountKey: "user-fallback::acct-fallback",
      accountId: "acct-fallback",
      email: "fallback@example.com",
      exp: "2026-03-21T00:00:00.000Z",
    },
  ], "user-current::acct-current");

  const accounts = await listCodexAuthAccounts({ codexHome });

  assert.equal(accounts.length, 2);
  assert.deepEqual(
    accounts.map((account) => ({
      accountId: account.accountId,
      email: account.email,
      source: account.source,
      expiresAt: account.expiresAt,
    })),
    [
      {
        accountId: "acct-current",
        email: "current@example.com",
        source: "codex-cli",
        expiresAt: "2026-03-22T00:00:00.000Z",
      },
      {
        accountId: "acct-fallback",
        email: "fallback@example.com",
        source: "codex-cli",
        expiresAt: "2026-03-21T00:00:00.000Z",
      },
    ],
  );
});

test("getActiveCodexAuthAccount prefers registry active_account_key", async () => {
  const codexHome = await createCodexHome([
    {
      accountKey: "user-current::acct-current",
      accountId: "acct-current",
      email: "current@example.com",
      exp: "2026-03-22T00:00:00.000Z",
    },
    {
      accountKey: "user-fallback::acct-fallback",
      accountId: "acct-fallback",
      email: "fallback@example.com",
      exp: "2026-03-21T00:00:00.000Z",
    },
  ], "user-current::acct-current");

  const account = await getActiveCodexAuthAccount({ codexHome });

  assert.equal(account?.accountId, "acct-current");
  assert.equal(account?.email, "current@example.com");
});

test("getActiveCodexAuthAccount does not silently pick a different registry account when the active key is unreadable", async () => {
  const codexHome = await createCodexHome([
    {
      accountKey: "user-current::acct-current",
      accountId: "acct-current",
      email: "current@example.com",
      exp: "2026-03-22T00:00:00.000Z",
    },
    {
      accountKey: "user-fallback::acct-fallback",
      accountId: "acct-fallback",
      email: "fallback@example.com",
      exp: "2026-03-21T00:00:00.000Z",
    },
  ], "missing::account");

  const account = await getActiveCodexAuthAccount({ codexHome });

  assert.equal(account, null);
});

test("getCodexAuthAccountById resolves a specific codex account", async () => {
  const codexHome = await createCodexHome([
    {
      accountKey: "user-current::acct-current",
      accountId: "acct-current",
      email: "current@example.com",
      exp: "2026-03-22T00:00:00.000Z",
    },
    {
      accountKey: "user-fallback::acct-fallback",
      accountId: "acct-fallback",
      email: "fallback@example.com",
      exp: "2026-03-21T00:00:00.000Z",
    },
  ], "user-current::acct-current");

  const account = await getCodexAuthAccountById("acct-fallback", { codexHome });

  assert.equal(account?.accountId, "acct-fallback");
  assert.equal(account?.email, "fallback@example.com");
});

test("falls back to ~/.codex/auth.json when registry is missing", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-auth-source-"));
  await writeFile(
    path.join(codexHome, "auth.json"),
    JSON.stringify({
      tokens: {
        access_token: createJwt({
          exp: Math.floor(Date.parse("2026-03-20T00:00:00.000Z") / 1000),
          sub: "auth0|fallback-user",
          email: "fallback@example.com",
        }),
        refresh_token: "refresh-token",
        account_id: "fallback-account",
      },
      last_refresh: "2026-03-19T00:00:00.000Z",
    }),
  );

  const accounts = await listCodexAuthAccounts({ codexHome });

  assert.equal(accounts.length, 1);
  assert.deepEqual(accounts[0], {
    accountId: "fallback-account",
    email: "fallback@example.com",
    accessToken: createJwt({
      exp: Math.floor(Date.parse("2026-03-20T00:00:00.000Z") / 1000),
      sub: "auth0|fallback-user",
      email: "fallback@example.com",
    }),
    refreshToken: "refresh-token",
    expiresAt: "2026-03-20T00:00:00.000Z",
    source: "codex-cli",
    invalid: false,
  });
});

test("uses last_refresh plus one hour when the token does not expose exp", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-auth-source-"));
  await writeFile(
    path.join(codexHome, "auth.json"),
    JSON.stringify({
      tokens: {
        access_token: createJwt({
          sub: "auth0|fallback-user",
          email: "fallback@example.com",
        }),
        refresh_token: "refresh-token",
        account_id: "fallback-account",
      },
      last_refresh: "2026-03-19T00:00:00.000Z",
    }),
  );

  const accounts = await listCodexAuthAccounts({ codexHome });

  assert.equal(accounts[0]?.expiresAt, "2026-03-19T01:00:00.000Z");
});

async function createCodexHome(
  accounts: Array<{
    accountKey: string;
    accountId: string;
    email: string;
    exp: string;
  }>,
  activeAccountKey?: string,
) {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-auth-source-"));
  const accountsDir = path.join(codexHome, "accounts");
  await mkdir(accountsDir, { recursive: true });

  await writeFile(
    path.join(accountsDir, "registry.json"),
    JSON.stringify({
      active_account_key: activeAccountKey,
      accounts: accounts.map((account) => ({
        account_key: account.accountKey,
      })),
    }),
  );

  for (const account of accounts) {
    await writeFile(
      path.join(accountsDir, `${Buffer.from(account.accountKey).toString("base64url")}.auth.json`),
      JSON.stringify({
        tokens: {
          access_token: createJwt({
            exp: Math.floor(Date.parse(account.exp) / 1000),
            sub: `auth0|${account.accountId}`,
            email: account.email,
          }),
          refresh_token: `${account.accountId}-refresh-token`,
          account_id: account.accountId,
        },
        last_refresh: account.exp,
      }),
    );
  }

  return codexHome;
}

function createJwt(payload: Record<string, unknown>) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.signature`;
}
