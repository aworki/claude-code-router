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
