import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { OAuthService } from "../../../core/src/services/oauth/service";
import { apiKeyAuth } from "../middleware/auth";
import { registerOAuthRoutes } from "./routes";

function createTestApp() {
  const app = Fastify();
  const config = {
    APIKEY: "test-api-key",
    PORT: 3456,
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

  const oauthService = new OAuthService({
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
  });

  app.addHook("preHandler", async (req, reply) => {
    return new Promise<void>((resolve, reject) => {
      apiKeyAuth(config)(req as any, reply as any, (error?: Error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      }).catch(reject);
    });
  });

  app.register(registerOAuthRoutes, {
    config,
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
    assert.equal(authorizeUrl.origin, "https://auth0.openai.com");
    assert.equal(authorizeUrl.pathname, "/authorize");
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
