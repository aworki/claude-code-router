import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { OAuthService } from "../../../core/src/services/oauth/service";
import { apiKeyAuth } from "../middleware/auth";
import { registerOAuthRoutes } from "./routes";

function createTestApp(options?: {
  routeConfig?: any | (() => any);
  authConfig?: any;
  vaultList?: Array<Record<string, unknown>>;
  openAIClientFactory?: any;
}) {
  const app = Fastify();
  const authConfig = options?.authConfig ?? {
    APIKEY: "test-api-key",
    PORT: 3456,
    OAUTH_COOKIE_SECRET: "signed-cookie-secret",
    providers: [
      {
        name: "openai-oauth",
        auth_strategy: "openai-oauth",
        oauth: {
          client_id: "client-123",
          redirect_uri: "http://127.0.0.1:3456/oauth/callback",
          scopes: ["openid", "email", "offline_access"],
        },
      },
    ],
  };
  const routeConfig = options?.routeConfig ?? authConfig;
  const resolvedRouteConfig = typeof routeConfig === "function" ? routeConfig() : routeConfig;
  const effectivePort = resolvedRouteConfig?.initialConfig?.PORT ?? resolvedRouteConfig?.PORT ?? 3456;

  const oauthService = new OAuthService({
    vault: {
      async save() {},
      async get() {
        return null;
      },
      async list() {
        return options?.vaultList ?? [];
      },
      async markInvalid() {
        return false;
      },
    } as any,
    defaultRedirectUri: `http://localhost:${effectivePort}/auth/callback`,
    openAIClientFactory: options?.openAIClientFactory,
    stateFactory: (() => {
      let counter = 0;
      return () => `state-${++counter}`;
    })(),
  });

  app.addHook("preHandler", async (req, reply) => {
    return new Promise<void>((resolve, reject) => {
      apiKeyAuth(authConfig)(req as any, reply as any, (error?: Error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      }).catch(reject);
    });
  });

  app.register(registerOAuthRoutes, {
    config: routeConfig,
    oauthService,
  });

  return app;
}

test("GET /oauth/login redirects to the OpenAI authorize URL and sets signed state cookie", async () => {
  const app = createTestApp();

  try {
    const response = await app.inject({
      method: "GET",
      url: "/oauth/login",
    });

    assert.equal(response.statusCode, 302);

    const location = response.headers.location;
    assert.ok(location);

    const authorizeUrl = new URL(location);
    assert.equal(authorizeUrl.origin, "https://auth.openai.com");
    assert.equal(authorizeUrl.pathname, "/oauth/authorize");
    assert.equal(authorizeUrl.searchParams.get("id_token_add_organizations"), "true");
    assert.equal(authorizeUrl.searchParams.get("codex_cli_simplified_flow"), "true");
    assert.equal(authorizeUrl.searchParams.get("originator"), "pi");
    assert.equal(authorizeUrl.searchParams.get("client_id"), "client-123");
    assert.equal(
      authorizeUrl.searchParams.get("redirect_uri"),
      "http://127.0.0.1:3456/oauth/callback",
    );
    assert.ok(authorizeUrl.searchParams.get("state"));
    assert.ok(authorizeUrl.searchParams.get("code_challenge"));

    const setCookieHeader = response.headers["set-cookie"];
    const firstCookie = Array.isArray(setCookieHeader)
      ? setCookieHeader[0]
      : setCookieHeader;
    assert.ok(firstCookie?.includes("ccr_oauth_state="));
    assert.ok(firstCookie?.includes("HttpOnly"));
  } finally {
    await app.close();
  }
});

test("GET /oauth/login resolves providers from the real startup initialConfig shape and preserves the registered default callback", async () => {
  const app = createTestApp({
    authConfig: {
      APIKEY: "test-api-key",
      PORT: 4567,
      providers: [],
    },
    routeConfig: {
      initialConfig: {
        PORT: 4567,
        OAUTH_COOKIE_SECRET: "signed-cookie-secret",
        providers: [
          {
            name: "openai-oauth",
            auth_strategy: "openai-oauth",
            oauth: {
              client_id: "client-123",
            },
          },
        ],
      },
    },
  });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/oauth/login",
    });

    assert.equal(response.statusCode, 302);
    const location = response.headers.location;
    assert.ok(location);

    const authorizeUrl = new URL(location);
    assert.equal(
      authorizeUrl.searchParams.get("redirect_uri"),
      "http://localhost:1455/auth/callback",
    );
  } finally {
    await app.close();
  }
});

test("GET /oauth/login resolves providers from live config after first-run bootstrap", async () => {
  const liveConfig = {
    initialConfig: {
      PORT: 3456,
      OAUTH_COOKIE_SECRET: "signed-cookie-secret",
      providers: [],
    },
  };
  const app = createTestApp({
    authConfig: {
      APIKEY: "test-api-key",
      PORT: 3456,
      providers: [],
    },
    routeConfig: () => liveConfig,
  });

  liveConfig.initialConfig.providers = [
    {
      name: "openai-oauth",
      auth_strategy: "openai-oauth",
      oauth: {
        client_id: "client-123",
        redirect_uri: "http://localhost:1455/auth/callback",
      },
    },
  ];

  try {
    const response = await app.inject({
      method: "GET",
      url: "/oauth/login",
    });

    assert.equal(response.statusCode, 302);
    const location = response.headers.location;
    assert.ok(location);

    const authorizeUrl = new URL(location);
    assert.equal(
      authorizeUrl.searchParams.get("redirect_uri"),
      "http://localhost:1455/auth/callback",
    );
  } finally {
    await app.close();
  }
});

test("GET /auth/callback completes the same OAuth flow as /oauth/callback", async () => {
  const app = createTestApp({
    routeConfig: {
      PORT: 1455,
      OAUTH_COOKIE_SECRET: "signed-cookie-secret",
      providers: [
        {
          name: "openai-oauth",
          auth_strategy: "openai-oauth",
          oauth: {
            client_id: "client-123",
            redirect_uri: "http://localhost:1455/auth/callback",
            scopes: ["openid", "email", "offline_access"],
          },
        },
      ],
    },
    openAIClientFactory() {
      return {
        async refresh() {
          throw new Error("refresh should not be called");
        },
        async exchangeAuthorizationCode() {
          return {
            accountId: "acct_123",
            email: "person@example.com",
            expiresAt: "2026-03-20T00:00:00.000Z",
          };
        },
      };
    },
  });

  try {
    const loginResponse = await app.inject({
      method: "GET",
      url: "/oauth/login",
    });

    const location = loginResponse.headers.location;
    assert.ok(location);

    const state = new URL(location).searchParams.get("state");
    assert.ok(state);

    const setCookieHeader = loginResponse.headers["set-cookie"];
    const firstCookie = Array.isArray(setCookieHeader)
      ? setCookieHeader[0]
      : setCookieHeader;
    assert.ok(firstCookie);

    const response = await app.inject({
      method: "GET",
      url: `/auth/callback?code=auth-code&state=${encodeURIComponent(state)}`,
      headers: {
        cookie: firstCookie.split(";")[0]!,
      },
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.body, /Authentication complete/i);
  } finally {
    await app.close();
  }
});

test("GET /oauth/login rejects ambiguous configs with multiple openai-oauth providers", async () => {
  const app = createTestApp({
    routeConfig: {
      PORT: 3456,
      OAUTH_COOKIE_SECRET: "signed-cookie-secret",
      providers: [
        {
          name: "openai-oauth-a",
          auth_strategy: "openai-oauth",
          oauth: {
            client_id: "client-a",
            redirect_uri: "http://127.0.0.1:3456/oauth/callback",
          },
        },
        {
          name: "openai-oauth-b",
          auth_strategy: "openai-oauth",
          oauth: {
            client_id: "client-b",
            redirect_uri: "http://127.0.0.1:3456/oauth/callback",
          },
        },
      ],
    },
  });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/oauth/login",
    });

    assert.equal(response.statusCode, 400);
    assert.match(response.body, /only one openai-oauth provider/i);
    assert.match(response.body, /account_id/i);
  } finally {
    await app.close();
  }
});

test("POST /oauth/complete rejects a callback URL whose redirect does not match the issued session", async () => {
  const app = createTestApp();

  try {
    const loginResponse = await app.inject({
      method: "GET",
      url: "/oauth/login",
    });

    const location = loginResponse.headers.location;
    assert.ok(location);

    const state = new URL(location).searchParams.get("state");
    assert.ok(state);

    const setCookieHeader = loginResponse.headers["set-cookie"];
    const firstCookie = Array.isArray(setCookieHeader)
      ? setCookieHeader[0]
      : setCookieHeader;
    assert.ok(firstCookie);

    const response = await app.inject({
      method: "POST",
      url: "/oauth/complete",
      headers: {
        "content-type": "application/json",
        cookie: firstCookie.split(";")[0]!,
      },
      payload: {
        callbackUrl: `http://127.0.0.1:9999/not-the-configured-callback?code=auth-code&state=${encodeURIComponent(state)}`,
      },
    });

    assert.equal(response.statusCode, 400);
    assert.match(response.body, /redirect/i);
  } finally {
    await app.close();
  }
});

test("POST /oauth/complete returns the authorized account metadata", async () => {
  const app = createTestApp({
    routeConfig: {
      PORT: 1455,
      OAUTH_COOKIE_SECRET: "signed-cookie-secret",
      providers: [
        {
          name: "openai-oauth",
          auth_strategy: "openai-oauth",
          oauth: {
            client_id: "client-123",
            redirect_uri: "http://localhost:1455/auth/callback",
            scopes: ["openid", "email", "offline_access"],
          },
        },
      ],
    },
    openAIClientFactory() {
      return {
        async refresh() {
          throw new Error("refresh should not be called");
        },
        async exchangeAuthorizationCode() {
          return {
            accountId: "windowslive|ccda259a13fff370",
            email: "person@example.com",
            expiresAt: "2026-03-20T00:00:00.000Z",
          };
        },
      };
    },
  });

  try {
    const loginResponse = await app.inject({
      method: "GET",
      url: "/oauth/login",
    });

    const location = loginResponse.headers.location;
    assert.ok(location);

    const state = new URL(location).searchParams.get("state");
    assert.ok(state);

    const setCookieHeader = loginResponse.headers["set-cookie"];
    const firstCookie = Array.isArray(setCookieHeader)
      ? setCookieHeader[0]
      : setCookieHeader;
    assert.ok(firstCookie);

    const response = await app.inject({
      method: "POST",
      url: "/oauth/complete",
      headers: {
        "content-type": "application/json",
        cookie: firstCookie.split(";")[0]!,
      },
      payload: {
        callbackUrl: `http://localhost:1455/auth/callback?code=auth-code&state=${encodeURIComponent(state)}`,
      },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), {
      success: true,
      accountId: "windowslive|ccda259a13fff370",
      email: "person@example.com",
      expiresAt: "2026-03-20T00:00:00.000Z",
    });
  } finally {
    await app.close();
  }
});

test("GET /api/oauth/status returns only redacted account metadata", async () => {
  const app = createTestApp({
    vaultList: [
      {
        accountId: "acct_123456789",
        accessToken: "secret-access",
        refreshToken: "secret-refresh",
        email: "person@example.com",
        expiresAt: "2026-03-20T00:00:00.000Z",
        invalid: false,
        source: "codex-cli",
      },
    ],
  });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/oauth/status",
    });

    assert.equal(response.statusCode, 200);
    const payload = response.json();
    assert.deepEqual(payload, {
      accounts: [
        {
          accountKey: "e77b122d95cf",
          accountHint: "ac...89",
          emailHint: "p...n@e...e.com",
          source: "codex-cli",
          expiresAt: "2026-03-20T00:00:00.000Z",
          invalid: false,
          reauthRequired: false,
        },
      ],
    });
    assert.equal(JSON.stringify(payload).includes("acct_123456789"), false);
    assert.equal(JSON.stringify(payload).includes("person@example.com"), false);
  } finally {
    await app.close();
  }
});
