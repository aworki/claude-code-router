import cookie from "@fastify/cookie";
import type { FastifyPluginAsync } from "fastify";

export const OAUTH_STATE_COOKIE = "ccr_oauth_state";
const OPENAI_OAUTH_SINGLE_PROVIDER_ERROR =
  "Only one openai-oauth provider is supported at a time. Use account_id to bind different authorized OpenAI accounts.";

interface OAuthProviderConfig {
  auth_strategy?: string;
  oauth?: {
    client_id?: string;
    redirect_uri?: string;
    scopes?: string[];
  };
  [key: string]: unknown;
}

interface OAuthRouteService {
  beginAuthorization(provider: OAuthProviderConfig): Promise<{
    authorizationUrl: string;
    state: string;
  }>;
  completeAuthorization(input: {
    provider: OAuthProviderConfig;
    state?: string | null;
    code?: string | null;
    error?: string | null;
    errorDescription?: string | null;
    stateCookieValue?: string;
    callbackUrl?: string;
  }): Promise<Record<string, unknown>>;
  getStatus(): Promise<unknown>;
}

interface OAuthRoutesOptions {
  config: any;
  oauthService: OAuthRouteService;
  cookieSecret?: string;
}

export const registerOAuthRoutes: FastifyPluginAsync<OAuthRoutesOptions> = async (app, options) => {
  const resolvedConfig = getOAuthConfigRoot(options.config);
  const cookieSecret =
    options.cookieSecret ??
    resolvedConfig.OAUTH_COOKIE_SECRET;

  if (!cookieSecret) {
    throw new Error("OAUTH_COOKIE_SECRET must be configured before registering OAuth routes");
  }

  await app.register(cookie, {
    secret: cookieSecret,
  });

  app.get("/oauth/login", async (_req, reply) => {
    try {
      const provider = getConfiguredOAuthProvider(options.config);
      const started = await options.oauthService.beginAuthorization(provider);

      reply
        .setCookie(OAUTH_STATE_COOKIE, started.state, {
          httpOnly: true,
          path: "/",
          sameSite: "lax",
          signed: true,
          maxAge: 10 * 60,
        })
        .redirect(started.authorizationUrl);
    } catch (error) {
      reply.code(400).send({
        error: toErrorMessage(error),
      });
    }
  });

  const handleOAuthCallback: FastifyPluginAsync<OAuthRoutesOptions> extends never ? never : any = async (req: any, reply: any) => {
    try {
      const provider = getConfiguredOAuthProvider(options.config);
      await options.oauthService.completeAuthorization({
        provider,
        state: (req.query as Record<string, string | undefined>).state,
        code: (req.query as Record<string, string | undefined>).code,
        error: (req.query as Record<string, string | undefined>).error,
        errorDescription: (req.query as Record<string, string | undefined>).error_description,
        stateCookieValue: readSignedStateCookie(req.cookies[OAUTH_STATE_COOKIE], req.unsignCookie.bind(req)),
      });

      reply
        .clearCookie(OAUTH_STATE_COOKIE, { path: "/" })
        .type("text/html; charset=utf-8")
        .send(renderCompletionPage("Authentication complete. You can close this tab and return to Claude Code Router."));
    } catch (error) {
      reply
        .code(400)
        .clearCookie(OAUTH_STATE_COOKIE, { path: "/" })
        .type("text/html; charset=utf-8")
        .send(renderCompletionPage(`Authentication failed: ${escapeHtml(toErrorMessage(error))}`));
    }
  };

  app.get("/oauth/callback", handleOAuthCallback);
  app.get("/auth/callback", handleOAuthCallback);

  app.post("/oauth/complete", async (req, reply) => {
    try {
      const provider = getConfiguredOAuthProvider(options.config);
      const body = (req.body ?? {}) as { callbackUrl?: string };
      const completed = await options.oauthService.completeAuthorization({
        provider,
        callbackUrl: body.callbackUrl,
        stateCookieValue: readSignedStateCookie(req.cookies[OAUTH_STATE_COOKIE], req.unsignCookie.bind(req)),
      });

      reply.clearCookie(OAUTH_STATE_COOKIE, { path: "/" }).send({ success: true, ...completed });
    } catch (error) {
      reply.code(400).send({
        error: toErrorMessage(error),
      });
    }
  });

  app.get("/api/oauth/status", async (_req, reply) => {
    try {
      reply.send(await options.oauthService.getStatus());
    } catch (error) {
      reply.code(500).send({
        error: toErrorMessage(error),
      });
    }
  });
};

function getConfiguredOAuthProvider(config: any): OAuthProviderConfig {
  const resolvedConfig = getOAuthConfigRoot(config);
  const providers = resolvedConfig.Providers || resolvedConfig.providers || [];
  const oauthProviders = providers.filter(
    (candidate: OAuthProviderConfig) => candidate.auth_strategy === "openai-oauth",
  );
  if (oauthProviders.length > 1) {
    throw new Error(OPENAI_OAUTH_SINGLE_PROVIDER_ERROR);
  }
  const provider = oauthProviders[0];
  if (!provider) {
    throw new Error("OpenAI OAuth provider is not configured");
  }

  return provider;
}

function getOAuthConfigRoot(config: any) {
  return config?.initialConfig ?? config;
}

function readSignedStateCookie(
  rawCookieValue: string | undefined,
  unsignCookie: (value: string) => { valid: boolean; value: string | null },
) {
  if (!rawCookieValue) {
    return undefined;
  }

  const unsigned = unsignCookie(rawCookieValue);
  if (!unsigned.valid || !unsigned.value) {
    return undefined;
  }

  return unsigned.value;
}

function renderCompletionPage(message: string) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>OAuth Complete</title>
  </head>
  <body>
    <p>${message}</p>
  </body>
</html>`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected OAuth error";
}
