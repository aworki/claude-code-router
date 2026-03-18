import assert from "node:assert/strict";
import test from "node:test";
import { OAuthService } from "./service";

test("buildRequestAuth returns bearer token for openai-oauth provider", async () => {
  const service = new OAuthService({
    vault: {
      async getValidAccessToken() {
        return { accessToken: "oauth-access-token" };
      },
    } as any,
  });

  const auth = await service.buildRequestAuth({
    name: "openai-oauth",
    auth_strategy: "openai-oauth",
    account_id: "user-1234",
  } as any);

  assert.deepEqual(auth.headers, {
    Authorization: "Bearer oauth-access-token",
  });
});

test("buildRequestAuth throws reauth_required when account_id is missing", async () => {
  const service = new OAuthService({
    vault: {
      async getValidAccessToken() {
        throw new Error("should not be called");
      },
    } as any,
  });

  await assert.rejects(
    service.buildRequestAuth({
      name: "openai-oauth",
      auth_strategy: "openai-oauth",
    } as any),
    (error: any) => {
      assert.equal(error?.message, "reauth_required");
      assert.equal(error?.code, "reauth_required");
      return true;
    }
  );
});

test("buildRequestAuth falls back to API key for non-oauth providers", async () => {
  const service = new OAuthService({
    vault: {} as any,
  });

  const auth = await service.buildRequestAuth({
    name: "openai",
    auth_strategy: "api-key",
    apiKey: "provider-api-key",
  } as any);

  assert.deepEqual(auth.headers, {
    Authorization: "Bearer provider-api-key",
  });
});

test("buildRequestAuth refreshes expired tokens with the provider client ID", async () => {
  const now = new Date("2026-03-18T00:00:00.000Z").valueOf();
  const seenClientIds: string[] = [];
  const seenRefreshInputs: Array<{ accountId: string; refreshToken: string }> = [];

  const service = new OAuthService({
    vault: {
      async get(accountId: string) {
        assert.equal(accountId, "user-1234");
        return {
          accountId,
          accessToken: "expired-access-token",
          refreshToken: "refresh-token",
          expiresAt: new Date(now - 60_000).toISOString(),
        };
      },
    } as any,
    openAIClientFactory(clientId: string) {
      seenClientIds.push(clientId);
      return {
        async refresh(input: { accountId: string; refreshToken: string }) {
          seenRefreshInputs.push(input);
          return {
            accessToken: "refreshed-access-token",
          };
        },
      };
    },
    now: () => now,
  } as any);

  const auth = await service.buildRequestAuth({
    name: "openai-oauth",
    auth_strategy: "openai-oauth",
    account_id: "user-1234",
    oauth: {
      client_id: "custom-client-id",
    },
  } as any);

  assert.deepEqual(auth.headers, {
    Authorization: "Bearer refreshed-access-token",
  });
  assert.deepEqual(seenClientIds, ["custom-client-id"]);
  assert.deepEqual(seenRefreshInputs, [
    {
      accountId: "user-1234",
      refreshToken: "refresh-token",
    },
  ]);
});
