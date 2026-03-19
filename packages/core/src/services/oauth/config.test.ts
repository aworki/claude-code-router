import assert from "node:assert/strict";
import test from "node:test";
import {
  assertOpenAIOAuthProviderLimit,
  assertSingleOpenAIOAuthProvider,
  normalizeOAuthProviderConfig,
  OPENAI_OAUTH_SINGLE_PROVIDER_ERROR,
  getAutoBootstrappedOpenAIOAuthConfig,
} from "./config";

test("normalizes openai-oauth provider defaults", () => {
  const provider = normalizeOAuthProviderConfig({
    name: "openai-oauth",
    auth_strategy: "openai-oauth",
    models: ["gpt-5.4"],
  } as any);

  assert.equal(provider.auth_strategy, "openai-oauth");
  assert.equal((provider as any).api_base_url, "https://chatgpt.com/backend-api");
  assert.equal(provider.oauth?.client_id, "app_EMoamEEZ73f0CkXaXp7hrann");
  assert.equal(provider.oauth?.redirect_uri, "http://localhost:1455/auth/callback");
  assert.deepEqual(provider.oauth?.scopes, [
    "openid",
    "email",
    "profile",
    "offline_access",
  ]);
  assert.deepEqual((provider as any).transformer?.use, ["openai-codex-responses"]);
});

test("normalizes openai-oauth provider defaults with a runtime redirect override", () => {
  const provider = normalizeOAuthProviderConfig(
    {
      name: "openai-oauth",
      auth_strategy: "openai-oauth",
      models: ["gpt-5.4"],
    } as any,
    {
      defaultRedirectUri: "http://localhost:4567/auth/callback",
    },
  );

  assert.equal(provider.oauth?.redirect_uri, "http://localhost:4567/auth/callback");
});

test("rejects multiple openai-oauth providers in one config", () => {
  assert.throws(
    () =>
      assertSingleOpenAIOAuthProvider([
        { name: "openai-oauth-a", auth_strategy: "openai-oauth" },
        { name: "openai-oauth-b", auth_strategy: "openai-oauth" },
      ]),
    new RegExp(OPENAI_OAUTH_SINGLE_PROVIDER_ERROR),
  );
});

test("allows updating an existing openai-oauth provider without tripping the single-provider guard", () => {
  assert.doesNotThrow(() =>
    assertOpenAIOAuthProviderLimit(
      [
        { name: "openai-oauth", auth_strategy: "openai-oauth" },
        { name: "openai-api-key", auth_strategy: "api-key" },
      ],
      { name: "openai-oauth", auth_strategy: "openai-oauth" },
      "openai-oauth",
    ),
  );
});

test("normalizes openai-oauth providers away from public OpenAI API base URLs", () => {
  const provider = normalizeOAuthProviderConfig({
    name: "openai-oauth",
    auth_strategy: "openai-oauth",
    api_base_url: "https://api.openai.com/v1/chat/completions",
    models: ["gpt-5.4"],
  } as any);

  assert.equal((provider as any).api_base_url, "https://chatgpt.com/backend-api");
});


test("bootstraps a minimal openai-oauth config without inheriting the CCR service port as redirect_uri", () => {
  const config = getAutoBootstrappedOpenAIOAuthConfig(
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
  assert.equal(config!.providers[0]?.name, "openai-oauth");
  assert.deepEqual(config!.providers[0]?.models, ["gpt-5.4"]);
  assert.equal(config!.providers[0]?.oauth?.redirect_uri, "http://localhost:1455/auth/callback");
  assert.equal(config!.Router.default, "openai-oauth,gpt-5.4");
});

test("bootstraps a minimal openai-oauth config for an empty first-run config even without imported codex credentials", () => {
  const config = getAutoBootstrappedOpenAIOAuthConfig(
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
  assert.equal(config!.providers[0]?.name, "openai-oauth");
  assert.equal(config!.providers[0]?.oauth?.redirect_uri, "http://localhost:1455/auth/callback");
  assert.equal(config!.Router.default, "openai-oauth,gpt-5.4");
});

test("does not bootstrap openai-oauth config when providers already exist", () => {
  const config = getAutoBootstrappedOpenAIOAuthConfig(
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
      hasImportedCredential: true,
    },
  );

  assert.equal(config, null);
});
