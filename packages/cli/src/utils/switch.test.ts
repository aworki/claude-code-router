import assert from "node:assert/strict";
import { createCipheriv, randomBytes } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import argon2 from "argon2";
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
        name: "openai-oauth",
        auth_strategy: "openai-oauth",
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
      source: "oauth",
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

test("buildSwitchChoices lists regular providers and oauth accounts separately", () => {
  const choices = buildSwitchChoices(createConfig(), createAccounts());

  assert.equal(choices.length, 3);
  assert.equal(choices[0]?.value, "provider:openrouter");
  assert.match(choices[0]?.name ?? "", /openrouter/);
  assert.equal(
    choices[1]?.value,
    "oauth-account:openai-oauth:google-oauth2|101",
  );
  assert.match(choices[1]?.name ?? "", /chezhenyuml@gmail\.com/);
  assert.match(choices[1]?.name ?? "", /oauth/i);
  assert.equal(
    choices[2]?.value,
    "oauth-account:openai-oauth:e704fa72-e442-415e-91aa-1631a1eb3aab",
  );
  assert.match(choices[2]?.name ?? "", /pdd13142025@outlook\.com/);
  assert.match(choices[2]?.name ?? "", /codex-cli/i);
});

test("resolveSwitchTarget matches provider names and oauth identifiers", () => {
  const config = createConfig();
  const accounts = createAccounts();

  assert.deepEqual(resolveSwitchTarget(config, accounts, "openrouter"), {
    kind: "provider",
    providerName: "openrouter",
  });
  assert.deepEqual(
    resolveSwitchTarget(config, accounts, "pdd13142025@outlook.com"),
    {
      kind: "oauth-account",
      providerName: "openai-oauth",
      accountId: "e704fa72-e442-415e-91aa-1631a1eb3aab",
    },
  );
  assert.deepEqual(resolveSwitchTarget(config, accounts, "google-oauth2|101"), {
    kind: "oauth-account",
    providerName: "openai-oauth",
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

test("applySwitchSelection binds the selected oauth account and route", () => {
  const updated = applySwitchSelection(createConfig(), {
    kind: "oauth-account",
    providerName: "openai-oauth",
    accountId: "e704fa72-e442-415e-91aa-1631a1eb3aab",
  });

  assert.equal(updated.Providers[1]?.account_id, "e704fa72-e442-415e-91aa-1631a1eb3aab");
  assert.equal(updated.Router.default, "openai-oauth,gpt-5.4");
});

test("loadLocalOAuthAccounts decrypts local vault records and returns full account details", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "ccr-switch-"));
  const passphrase = "test-installation-secret";
  const bundle = {
    accountId: "google-oauth2|101618611732166349292",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    email: "chezhenyuml@gmail.com",
    source: "oauth" as const,
    expiresAt: "2026-03-29T08:46:25.629Z",
    invalid: false,
  };

  await mkdir(rootDir, { recursive: true });
  await writeFile(path.join(rootDir, "installation-secret"), `${passphrase}\n`);
  await writeEncryptedRecord(rootDir, bundle.accountId, {
    bundle,
    savedAt: "2026-03-19T08:46:26.629Z",
    writeOrder: 1,
  });

  const accounts = await loadLocalOAuthAccounts({
    rootDir,
    codexAuthFile: path.join(rootDir, "missing-codex-auth.json"),
    codexRegistryFile: path.join(rootDir, "missing-registry.json"),
  });

  assert.equal(accounts.length, 1);
  assert.equal(accounts[0]?.accountId, bundle.accountId);
  assert.equal(accounts[0]?.email, bundle.email);
  assert.equal(accounts[0]?.source, "oauth");
});

test("loadLocalOAuthAccounts reads the active codex-auth account from registry.json", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "ccr-switch-"));
  const codexDir = await mkdtemp(path.join(os.tmpdir(), "ccr-codex-auth-"));
  const accountsDir = path.join(codexDir, "accounts");
  const accessToken = createJwt({
    exp: Math.floor(Date.parse("2026-03-30T06:56:06.000Z") / 1000),
    email: "active@example.com",
  });

  await mkdir(rootDir, { recursive: true });
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

  const accounts = await loadLocalOAuthAccounts({
    rootDir,
    codexAuthFile: path.join(codexDir, "auth.json"),
    codexRegistryFile: path.join(accountsDir, "registry.json"),
  });

  assert.equal(accounts.length, 1);
  assert.equal(accounts[0]?.accountId, "acct-active");
  assert.equal(accounts[0]?.email, "active@example.com");
  assert.equal(accounts[0]?.source, "codex-cli");
});

test("loadLocalOAuthAccounts reads all codex-auth accounts from the registry", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "ccr-switch-"));
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

  await mkdir(rootDir, { recursive: true });
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

  const accounts = await loadLocalOAuthAccounts({
    rootDir,
    codexAuthFile: path.join(codexDir, "auth.json"),
    codexRegistryFile: path.join(accountsDir, "registry.json"),
  });

  assert.equal(accounts.length, 2);
  assert.deepEqual(
    accounts.map((account) => account.email),
    ["first@example.com", "second@example.com"],
  );
});

async function writeEncryptedRecord(
  rootDir: string,
  accountId: string,
  record: Record<string, unknown>,
) {
  const rawPassphrase = await readFile(path.join(rootDir, "installation-secret"), "utf8");
  const passphrase = rawPassphrase.trim();
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = (await argon2.hash(passphrase, {
    type: argon2.argon2id,
    salt,
    hashLength: 32,
    raw: true,
  })) as Buffer;
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(record), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const fileName = await hashAccountId(accountId);
  const encrypted = {
    version: 1,
    algorithm: "aes-256-gcm",
    kdf: "argon2id",
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };

  await writeFile(path.join(rootDir, `${fileName}.json`), JSON.stringify(encrypted));
}

async function hashAccountId(accountId: string) {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(accountId).digest("hex");
}

function createJwt(payload: Record<string, unknown>) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.signature`;
}
