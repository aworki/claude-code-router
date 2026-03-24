import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  applySwitchSelection,
  buildSwitchChoices,
  loadLocalOAuthAccounts,
  resolveSwitchTarget,
  type LocalOAuthAccount,
} from "./switch";

function createConfig() {
  return {
    Providers: [
      {
        name: "openrouter",
        api_base_url: "https://openrouter.ai/api/v1/chat/completions",
        api_key: "sk-test",
        models: ["anthropic/claude-sonnet-4"],
      },
      {
        name: "codex-auth",
        auth_strategy: "codex-auth",
        account_id: "old-account",
        api_base_url: "https://chatgpt.com/backend-api/codex/responses",
        api_key: "",
        models: ["gpt-5.4"],
      },
    ],
    Router: {
      default: "openrouter,anthropic/claude-sonnet-4",
    },
  };
}

function createAccounts(): LocalOAuthAccount[] {
  return [
    {
      accountId: "google-oauth2|101",
      email: "chezhenyuml@gmail.com",
      source: "codex-cli",
      expiresAt: "2026-03-29T08:46:25.629Z",
      invalid: false,
      reauthRequired: false,
      accountKey: "7af007474c8d",
      accountHint: "go...01",
      emailHint: "c...l@g...l.com",
    },
    {
      accountId: "e704fa72-e442-415e-91aa-1631a1eb3aab",
      email: "pdd13142025@outlook.com",
      source: "codex-cli",
      expiresAt: "2026-03-30T06:56:06.000Z",
      invalid: false,
      reauthRequired: false,
      accountKey: "af341982968e",
      accountHint: "e7...ab",
      emailHint: "p...5@o...k.com",
    },
  ];
}

test("buildSwitchChoices lists regular providers and codex accounts separately", () => {
  const choices = buildSwitchChoices(createConfig(), createAccounts());

  assert.equal(choices.length, 3);
  assert.equal(choices[0]?.value, "provider:openrouter");
  assert.match(choices[0]?.name ?? "", /openrouter/);
  assert.equal(
    choices[1]?.value,
    "codex-account:codex-auth:google-oauth2|101",
  );
  assert.match(choices[1]?.name ?? "", /chezhenyuml@gmail\.com/);
  assert.match(choices[1]?.name ?? "", /codex-cli/i);
  assert.equal(
    choices[2]?.value,
    "codex-account:codex-auth:e704fa72-e442-415e-91aa-1631a1eb3aab",
  );
  assert.match(choices[2]?.name ?? "", /pdd13142025@outlook\.com/);
  assert.match(choices[2]?.name ?? "", /codex-cli/i);
});

test("buildSwitchChoices synthesizes the built-in codex-auth provider when codex auth accounts exist but config only has other providers", () => {
  const config = {
    Providers: [
      {
        name: "mmx",
        api_base_url: "https://example.com",
        api_key: "test",
        models: ["MiniMax-M2.7"],
      },
    ],
    Router: {
      default: "codex-auth,gpt-5.4",
    },
  };

  const choices = buildSwitchChoices(config, createAccounts());

  assert.equal(choices.length, 3);
  assert.equal(choices[0]?.value, "provider:mmx");
  assert.equal(
    choices[1]?.value,
    "codex-account:codex-auth:google-oauth2|101",
  );
});

test("resolveSwitchTarget matches provider names and codex account identifiers", () => {
  const config = createConfig();
  const accounts = createAccounts();

  assert.deepEqual(resolveSwitchTarget(config, accounts, "openrouter"), {
    kind: "provider",
    providerName: "openrouter",
  });
  assert.deepEqual(
    resolveSwitchTarget(config, accounts, "pdd13142025@outlook.com"),
    {
      kind: "codex-account",
      providerName: "codex-auth",
      accountId: "e704fa72-e442-415e-91aa-1631a1eb3aab",
    },
  );
  assert.deepEqual(resolveSwitchTarget(config, accounts, "google-oauth2|101"), {
    kind: "codex-account",
    providerName: "codex-auth",
    accountId: "google-oauth2|101",
  });
  assert.equal(resolveSwitchTarget(config, accounts, "missing"), null);
});

test("applySwitchSelection updates Router.default for regular providers", () => {
  const updated = applySwitchSelection(createConfig(), {
    kind: "provider",
    providerName: "openrouter",
  });

  assert.equal(
    updated.Router.default,
    "openrouter,anthropic/claude-sonnet-4",
  );
  assert.equal(updated.Providers[1]?.account_id, "old-account");
});

test("applySwitchSelection binds the selected codex account and route", () => {
  const updated = applySwitchSelection(createConfig(), {
    kind: "codex-account",
    providerName: "codex-auth",
    accountId: "e704fa72-e442-415e-91aa-1631a1eb3aab",
  });

  assert.equal(updated.Providers[1]?.account_id, "e704fa72-e442-415e-91aa-1631a1eb3aab");
  assert.equal(updated.Router.default, "codex-auth,gpt-5.4");
});

test("applySwitchSelection creates the built-in codex-auth provider when binding a codex account into a config that lacks it", () => {
  const updated = applySwitchSelection(
    {
      Providers: [
        {
          name: "mmx",
          api_base_url: "https://example.com",
          api_key: "test",
          models: ["MiniMax-M2.7"],
        },
      ],
      Router: {
        default: "mmx,MiniMax-M2.7",
      },
    },
    {
      kind: "codex-account",
      providerName: "codex-auth",
      accountId: "acct-active",
    },
  );

  assert.equal(updated.Providers?.length, 2);
  assert.equal(updated.Providers?.[1]?.name, "codex-auth");
  assert.equal(updated.Providers?.[1]?.account_id, "acct-active");
  assert.equal(updated.Router.default, "codex-auth,gpt-5.4");
});

test("loadLocalOAuthAccounts reads the fallback codex auth file without using the CCR vault", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "ccr-codex-auth-"));
  const accessToken = createJwt({
    exp: Math.floor(Date.parse("2026-03-29T08:46:25.629Z") / 1000),
    email: "chezhenyuml@gmail.com",
  });

  await writeFile(
    path.join(codexHome, "auth.json"),
    JSON.stringify({
      tokens: {
        access_token: accessToken,
        refresh_token: "refresh-token",
        account_id: "google-oauth2|101618611732166349292",
      },
      last_refresh: "2026-03-19T08:46:26.629Z",
    }),
  );

  const accounts = await loadLocalOAuthAccounts({ codexHome });

  assert.equal(accounts.length, 1);
  assert.equal(accounts[0]?.accountId, "google-oauth2|101618611732166349292");
  assert.equal(accounts[0]?.email, "chezhenyuml@gmail.com");
  assert.equal(accounts[0]?.source, "codex-cli");
});

test("loadLocalOAuthAccounts reads the active codex-auth account from registry.json", async () => {
  const codexDir = await mkdtemp(path.join(os.tmpdir(), "ccr-codex-auth-"));
  const accountsDir = path.join(codexDir, "accounts");
  const accessToken = createJwt({
    exp: Math.floor(Date.parse("2026-03-30T06:56:06.000Z") / 1000),
    email: "active@example.com",
  });

  await mkdir(accountsDir, { recursive: true });
  await writeFile(
    path.join(accountsDir, "registry.json"),
    JSON.stringify({
      active_account_key: "user-active::acct-active",
    }),
  );
  await writeFile(
    path.join(accountsDir, "dXNlci1hY3RpdmU6OmFjY3QtYWN0aXZl.auth.json"),
    JSON.stringify({
      tokens: {
        access_token: accessToken,
        refresh_token: "refresh-token",
        account_id: "acct-active",
      },
      last_refresh: "2026-03-21T01:02:03.000Z",
    }),
  );

  const accounts = await loadLocalOAuthAccounts({ codexHome: codexDir });

  assert.equal(accounts.length, 1);
  assert.equal(accounts[0]?.accountId, "acct-active");
  assert.equal(accounts[0]?.email, "active@example.com");
  assert.equal(accounts[0]?.source, "codex-cli");
});

test("loadLocalOAuthAccounts reads all codex-auth accounts from the registry", async () => {
  const codexDir = await mkdtemp(path.join(os.tmpdir(), "ccr-codex-auth-"));
  const accountsDir = path.join(codexDir, "accounts");
  const firstAccessToken = createJwt({
    exp: Math.floor(Date.parse("2026-03-30T06:56:06.000Z") / 1000),
    email: "first@example.com",
  });
  const secondAccessToken = createJwt({
    exp: Math.floor(Date.parse("2026-03-31T06:56:06.000Z") / 1000),
    email: "second@example.com",
  });

  await mkdir(accountsDir, { recursive: true });
  await writeFile(
    path.join(accountsDir, "registry.json"),
    JSON.stringify({
      active_account_key: "user-first::acct-first",
      accounts: [
        {
          account_key: "user-first::acct-first",
          email: "first@example.com",
        },
        {
          account_key: "user-second::acct-second",
          email: "second@example.com",
        },
      ],
    }),
  );
  await writeFile(
    path.join(accountsDir, "dXNlci1maXJzdDo6YWNjdC1maXJzdA.auth.json"),
    JSON.stringify({
      tokens: {
        access_token: firstAccessToken,
        refresh_token: "first-refresh-token",
        account_id: "acct-first",
      },
      last_refresh: "2026-03-21T01:02:03.000Z",
    }),
  );
  await writeFile(
    path.join(accountsDir, "dXNlci1zZWNvbmQ6OmFjY3Qtc2Vjb25k.auth.json"),
    JSON.stringify({
      tokens: {
        access_token: secondAccessToken,
        refresh_token: "second-refresh-token",
        account_id: "acct-second",
      },
      last_refresh: "2026-03-21T01:02:04.000Z",
    }),
  );

  const accounts = await loadLocalOAuthAccounts({ codexHome: codexDir });

  assert.equal(accounts.length, 2);
  assert.deepEqual(
    accounts.map((account) => account.email),
    ["first@example.com", "second@example.com"],
  );
});

function createJwt(payload: Record<string, unknown>) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.signature`;
}
