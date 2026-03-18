import assert from "node:assert/strict";
import test from "node:test";
import { normalizeOAuthProviderConfig } from "./config";

test("normalizes openai-oauth provider defaults", () => {
  const provider = normalizeOAuthProviderConfig({
    name: "openai-oauth",
    auth_strategy: "openai-oauth",
    models: ["gpt-5.4"],
  } as any);

  assert.equal(provider.auth_strategy, "openai-oauth");
  assert.equal(provider.oauth?.client_id, "app_EMoamEEZ73f0CkXaXp7hrann");
  assert.equal(provider.oauth?.redirect_uri, "http://localhost:3456/oauth/callback");
  assert.deepEqual(provider.oauth?.scopes, [
    "openid",
    "email",
    "profile",
    "offline_access",
  ]);
});

test("normalizes openai-oauth provider defaults with a runtime redirect override", () => {
  const provider = normalizeOAuthProviderConfig(
    {
      name: "openai-oauth",
      auth_strategy: "openai-oauth",
      models: ["gpt-5.4"],
    } as any,
    {
      defaultRedirectUri: "http://localhost:4567/oauth/callback",
    },
  );

  assert.equal(provider.oauth?.redirect_uri, "http://localhost:4567/oauth/callback");
});
