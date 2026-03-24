import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCodexAuthProviderLimit,
  assertSingleCodexAuthProvider,
  CODEX_AUTH_SINGLE_PROVIDER_ERROR,
  getAutoBootstrappedCodexAuthConfig,
  normalizeOAuthProviderConfig,
  syncCodexAuthProviderWithCodexAccount,
} from "./config";

test("normalizes codex-auth provider defaults", () => {
  const provider = normalizeOAuthProviderConfig({
    name: "codex-auth",
    auth_strategy: "codex-auth",
    models: ["gpt-5.4"],
  } as any);

  assert.equal(provider.auth_strategy, "codex-auth");
  assert.equal((provider as any).api_base_url, "https://chatgpt.com/backend-api");
  assert.equal(provider.oauth?.client_id, "app_EMoamEEZ73f0CkXaXp7hrann");
  assert.deepEqual(provider.oauth?.scopes, [
    "openid",
    "email",
    "profile",
    "offline_access",
  ]);
  assert.deepEqual((provider as any).transformer?.use, ["openai-codex-responses"]);
});

test("migrates legacy openai-oauth providers to codex-auth", () => {
  const provider = normalizeOAuthProviderConfig({
    name: "openai-oauth",
    auth_strategy: "openai-oauth" as any,
    models: ["gpt-5.4"],
    oauth: {
      client_id: "legacy-client",
      redirect_uri: "http://localhost:1455/auth/callback",
    } as any,
  } as any);

  assert.equal(provider.name, "codex-auth");
  assert.equal(provider.auth_strategy, "codex-auth");
  assert.equal(provider.oauth?.client_id, "legacy-client");
  assert.equal((provider.oauth as any)?.redirect_uri, undefined);
});

test("ignores redirect overrides for codex-auth providers", () => {
  const provider = normalizeOAuthProviderConfig(
    {
      name: "codex-auth",
      auth_strategy: "codex-auth",
      models: ["gpt-5.4"],
    } as any,
    {
      defaultRedirectUri: "http://localhost:4567/auth/callback",
    },
  );

  assert.equal(provider.oauth?.client_id, "app_EMoamEEZ73f0CkXaXp7hrann");
});

test("rejects multiple codex-auth providers in one config", () => {
  assert.throws(
    () =>
      assertSingleCodexAuthProvider([
        { name: "codex-auth-a", auth_strategy: "codex-auth" },
        { name: "codex-auth-b", auth_strategy: "codex-auth" },
      ]),
    new RegExp(CODEX_AUTH_SINGLE_PROVIDER_ERROR),
  );
});

test("allows updating an existing codex-auth provider without tripping the single-provider guard", () => {
  assert.doesNotThrow(() =>
    assertCodexAuthProviderLimit(
      [
        { name: "codex-auth", auth_strategy: "codex-auth" },
        { name: "openai-api-key", auth_strategy: "api-key" },
      ],
      { name: "codex-auth", auth_strategy: "codex-auth" },
      "codex-auth",
    ),
  );
});

test("normalizes codex-auth providers away from public OpenAI API base URLs", () => {
  const provider = normalizeOAuthProviderConfig({
    name: "codex-auth",
    auth_strategy: "codex-auth",
    api_base_url: "https://api.openai.com/v1/chat/completions",
    models: ["gpt-5.4"],
  } as any);

  assert.equal((provider as any).api_base_url, "https://chatgpt.com/backend-api");
});


test("bootstraps a minimal codex-auth config without legacy callback fields", () => {
  const config = getAutoBootstrappedCodexAuthConfig(
    {
      Providers: [],
      Router: {},
    },
    {
      hasImportedCredential: true,
      defaultRedirectUri: "http://localhost:4567/auth/callback",
    },
  );

  assert.ok(config);
  assert.equal(config!.providers.length, 1);
  assert.equal(config!.providers[0]?.name, "codex-auth");
  assert.deepEqual(config!.providers[0]?.models, ["gpt-5.4"]);
  assert.equal(config!.Router.default, "codex-auth,gpt-5.4");
});

test("bootstraps a minimal codex-auth config for an empty first-run config even without imported codex credentials", () => {
  const config = getAutoBootstrappedCodexAuthConfig(
    {
      Providers: [],
      Router: {},
    },
    {
      hasImportedCredential: false,
    },
  );

  assert.ok(config);
  assert.equal(config!.providers.length, 1);
  assert.equal(config!.providers[0]?.name, "codex-auth");
  assert.equal(config!.Router.default, "codex-auth,gpt-5.4");
});

test("does not bootstrap codex-auth config when providers already exist and codex auth is not needed", () => {
  const config = getAutoBootstrappedCodexAuthConfig(
    {
      Providers: [
        {
          name: "existing-provider",
          auth_strategy: "api-key",
          api_base_url: "https://example.com",
          api_key: "test",
          models: ["foo"],
        },
      ],
      Router: {},
    },
    {
      hasImportedCredential: false,
    },
  );

  assert.equal(config, null);
});

test("adds the built-in codex-auth provider when routes reference it but the config only has other providers", () => {
  const config = getAutoBootstrappedCodexAuthConfig(
    {
      Providers: [
        {
          name: "mmx",
          auth_strategy: "api-key",
          api_base_url: "https://example.com",
          api_key: "test",
          models: ["foo"],
        },
      ],
      Router: {
        default: "codex-auth,gpt-5.4",
      },
    },
    {
      hasImportedCredential: true,
    },
  );

  assert.ok(config);
  assert.equal(config!.providers.length, 2);
  assert.equal(config!.providers[1]?.name, "codex-auth");
  assert.equal(config!.Router.default, "codex-auth,gpt-5.4");
});

test("syncCodexAuthProviderWithCodexAccount follows the latest codex-auth account when the provider was already bound to codex-cli", () => {
  const update = syncCodexAuthProviderWithCodexAccount(
    {
      Providers: [
        {
          name: "codex-auth",
          auth_strategy: "codex-auth",
          account_id: "codex-old",
          models: ["gpt-5.4"],
        },
      ],
      Router: {
        default: "codex-auth,gpt-5.4",
      },
    },
    {
      importedAccountId: "codex-new",
      previousCodexAccountIds: ["codex-old"],
    },
  );

  assert.deepEqual(update, {
    providerName: "codex-auth",
    accountId: "codex-new",
  });
});

test("syncCodexAuthProviderWithCodexAccount keeps manual local oauth bindings unchanged", () => {
  const update = syncCodexAuthProviderWithCodexAccount(
    {
      Providers: [
        {
          name: "codex-auth",
          auth_strategy: "codex-auth",
          account_id: "local-legacy-account",
          models: ["gpt-5.4"],
        },
      ],
      Router: {
        default: "codex-auth,gpt-5.4",
      },
    },
    {
      importedAccountId: "codex-new",
      previousCodexAccountIds: ["codex-old"],
    },
  );

  assert.equal(update, null);
});
