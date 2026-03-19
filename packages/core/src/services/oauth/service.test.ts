import assert from "node:assert/strict";
import test from "node:test";
import { OAuthService } from "./service";

function createTokenWithAccountId(accountId: string) {
  return [
    Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url"),
    Buffer.from(
      JSON.stringify({
        "https://api.openai.com/auth": {
          chatgpt_account_id: accountId,
        },
      }),
    ).toString("base64url"),
    "signature",
  ].join(".");
}

test("buildRequestAuth returns bearer token for openai-oauth provider", async () => {
  const service = new OAuthService({
    vault: {
      async getValidAccessToken() {
        return { accessToken: createTokenWithAccountId("user-1234") };
      },
    } as any,
  });

  const auth = await service.buildRequestAuth({
    name: "openai-oauth",
    auth_strategy: "openai-oauth",
    account_id: "user-1234",
  } as any);

  assert.equal(auth.headers.Authorization, `Bearer ${createTokenWithAccountId("user-1234")}`);
  assert.equal(auth.headers["chatgpt-account-id"], "user-1234");
  assert.equal(auth.headers.originator, "pi");
  assert.match(auth.headers["User-Agent"], /^pi \(/);
});

test("buildRequestAuth throws reauth_required when account_id is missing", async () => {
  const service = new OAuthService({
    vault: {
      async getValidAccessToken() {
        throw new Error("should not be called");
      },
      async list() {
        return [];
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

test("buildRequestAuth falls back to the single imported oauth account when account_id is missing", async () => {
  const service = new OAuthService({
    vault: {
      async list() {
        return [
          {
            accountId: "windowslive|acct_123",
            accessToken: "oauth-access-token",
            refreshToken: "refresh-token",
            expiresAt: "2026-03-20T00:00:00.000Z",
            invalid: false,
          },
        ];
      },
      async getValidAccessToken(accountId: string) {
        assert.equal(accountId, "windowslive|acct_123");
        return { accessToken: createTokenWithAccountId("windowslive|acct_123") };
      },
    } as any,
  });

  const auth = await service.buildRequestAuth({
    name: "openai-oauth",
    auth_strategy: "openai-oauth",
  } as any);

  assert.equal(
    auth.headers.Authorization,
    `Bearer ${createTokenWithAccountId("windowslive|acct_123")}`,
  );
  assert.equal(auth.headers["chatgpt-account-id"], "windowslive|acct_123");
  assert.equal(auth.headers.originator, "pi");
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

test("buildRequestAuth refreshes expired tokens with the provider oauth metadata", async () => {
  const now = new Date("2026-03-18T00:00:00.000Z").valueOf();
  const seenProviders: Array<{
    clientId?: string;
    tokenEndpoint?: string;
    audience?: string;
  }> = [];
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
    openAIClientFactory(provider: any) {
      seenProviders.push({
        clientId: provider.oauth?.client_id,
        tokenEndpoint: provider.oauth?.token_endpoint,
        audience: provider.oauth?.audience,
      });
      return {
        async refresh(input: { accountId: string; refreshToken: string }) {
          seenRefreshInputs.push(input);
          return {
            accessToken: createTokenWithAccountId("user-1234"),
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
      token_endpoint: "https://auth.openai.com/oauth/token",
      audience: "https://api.openai.com/v1",
    },
  } as any);

  assert.equal(
    auth.headers.Authorization,
    `Bearer ${createTokenWithAccountId("user-1234")}`,
  );
  assert.equal(auth.headers["chatgpt-account-id"], "user-1234");
  assert.deepEqual(seenProviders, [
    {
      clientId: "custom-client-id",
      tokenEndpoint: "https://auth.openai.com/oauth/token",
      audience: "https://api.openai.com/v1",
    },
  ]);
  assert.deepEqual(seenRefreshInputs, [
    {
      accountId: "user-1234",
      refreshToken: "refresh-token",
    },
  ]);
});

test("beginAuthorization includes configured authorization endpoint and extra params", async () => {
  const service = new OAuthService({
    vault: {
      async save() {},
      async get() {
        return null;
      },
      async list() {
        return [];
      },
      async markInvalid() {
        return false;
      },
    } as any,
    stateFactory: () => "state-1",
  } as any);

  const started = await service.beginAuthorization({
    auth_strategy: "openai-oauth",
    oauth: {
      client_id: "client-123",
      redirect_uri: "http://127.0.0.1:3456/oauth/callback",
      scopes: ["openid", "email", "offline_access"],
      authorization_endpoint: "https://auth.openai.com/api/accounts/authorize",
      authorize_params: {
        issuer: "https://auth.openai.com",
        audience: "https://api.openai.com/v1",
        response_mode: "query",
      },
    },
  } as any);

  const authorizeUrl = new URL(started.authorizationUrl);
  assert.equal(authorizeUrl.origin, "https://auth.openai.com");
  assert.equal(authorizeUrl.pathname, "/api/accounts/authorize");
  assert.equal(authorizeUrl.searchParams.get("issuer"), "https://auth.openai.com");
  assert.equal(authorizeUrl.searchParams.get("audience"), "https://api.openai.com/v1");
  assert.equal(authorizeUrl.searchParams.get("response_mode"), "query");
});

test("beginAuthorization uses Codex-compatible defaults for the OpenAI authorize request", async () => {
  const service = new OAuthService({
    vault: {
      async save() {},
      async get() {
        return null;
      },
      async list() {
        return [];
      },
      async markInvalid() {
        return false;
      },
    } as any,
    stateFactory: () => "state-1",
  } as any);

  const started = await service.beginAuthorization({
    auth_strategy: "openai-oauth",
    oauth: {
      client_id: "client-123",
      redirect_uri: "http://127.0.0.1:3456/oauth/callback",
      scopes: ["openid", "email", "offline_access"],
    },
  } as any);

  const authorizeUrl = new URL(started.authorizationUrl);
  assert.equal(authorizeUrl.origin, "https://auth.openai.com");
  assert.equal(authorizeUrl.pathname, "/oauth/authorize");
  assert.equal(authorizeUrl.searchParams.get("id_token_add_organizations"), "true");
  assert.equal(authorizeUrl.searchParams.get("codex_cli_simplified_flow"), "true");
  assert.equal(authorizeUrl.searchParams.get("originator"), "pi");
});

test("beginAuthorization issues an OpenAI authorize URL and completes with a one-time state", async () => {
  const exchanged: Array<{ code: string; codeVerifier: string; redirectUri: string }> = [];
  const service = new OAuthService({
    vault: {
      async save() {},
      async get() {
        return null;
      },
      async list() {
        return [];
      },
      async markInvalid() {
        return false;
      },
    } as any,
    openAIClientFactory() {
      return {
        async refresh() {
          throw new Error("refresh should not be called");
        },
        async exchangeAuthorizationCode(input: {
          code: string;
          codeVerifier: string;
          redirectUri: string;
        }) {
          exchanged.push(input);
          return {
            accountId: "acct_123",
            email: "person@example.com",
            expiresAt: "2026-03-19T00:00:00.000Z",
          };
        },
      };
    },
  } as any);

  const started = await service.beginAuthorization({
    auth_strategy: "openai-oauth",
    oauth: {
      client_id: "client-123",
      redirect_uri: "http://127.0.0.1:3456/oauth/callback",
      scopes: ["openid", "email", "offline_access"],
    },
  } as any);

  const startedUrl = new URL(started.authorizationUrl);
  const state = startedUrl.searchParams.get("state");
  assert.ok(state);

  const completed = await service.completeAuthorization({
    provider: {
      auth_strategy: "openai-oauth",
      oauth: {
        client_id: "client-123",
        redirect_uri: "http://127.0.0.1:3456/oauth/callback",
      },
    } as any,
    state,
    code: "auth-code",
    stateCookieValue: state,
  });

  assert.deepEqual(completed, {
    accountId: "acct_123",
    email: "person@example.com",
    expiresAt: "2026-03-19T00:00:00.000Z",
  });
  assert.equal(exchanged.length, 1);
  assert.equal(exchanged[0]?.code, "auth-code");
  assert.equal(exchanged[0]?.redirectUri, "http://127.0.0.1:3456/oauth/callback");
  assert.ok(exchanged[0]?.codeVerifier);

  await assert.rejects(
    service.completeAuthorization({
      provider: {
        auth_strategy: "openai-oauth",
        oauth: {
          client_id: "client-123",
          redirect_uri: "http://127.0.0.1:3456/oauth/callback",
        },
      } as any,
      state,
      code: "auth-code",
      stateCookieValue: state,
    }),
    /state/i,
  );
});

test("beginAuthorization keeps the registered OpenAI redirect URI when the provider does not override it", async () => {
  const service = new OAuthService({
    vault: {
      async save() {},
      async get() {
        return null;
      },
      async list() {
        return [];
      },
      async markInvalid() {
        return false;
      },
    } as any,
    defaultRedirectUri: "http://localhost:4567/oauth/callback",
    stateFactory: () => "state-1",
  } as any);

  const started = await service.beginAuthorization({
    auth_strategy: "openai-oauth",
    oauth: {
      client_id: "client-123",
    },
  } as any);

  const authorizeUrl = new URL(started.authorizationUrl);
  assert.equal(
    authorizeUrl.searchParams.get("redirect_uri"),
    "http://localhost:1455/auth/callback",
  );
});

test("getStatus redacts tokens and reports reauth metadata only", async () => {
  const service = new OAuthService({
    vault: {
      async save() {},
      async get() {
        return null;
      },
      async list() {
        return [
          {
            accountId: "acct_123",
            accessToken: "secret-access",
            refreshToken: "secret-refresh",
            idToken: "secret-id",
            email: "person@example.com",
            expiresAt: "2026-03-19T00:00:00.000Z",
            invalid: true,
          },
        ];
      },
      async markInvalid() {
        return false;
      },
    } as any,
  });

  const status = await service.getStatus();

  assert.deepEqual(status, {
    accounts: [
      {
        accountKey: "182d1cfdc619",
        accountHint: "ac...23",
        emailHint: "p...n@e...e.com",
        expiresAt: "2026-03-19T00:00:00.000Z",
        invalid: true,
        reauthRequired: true,
      },
    ],
  });
});
