import { randomBytes } from "node:crypto";
import type { LLMProvider } from "@/types/llm";
import { OpenAIOAuthClient } from "./openai-client";
import { normalizeOAuthProviderConfig } from "./config";
import { createPkcePair } from "./pkce";
import { assertAllowedLoopbackRedirect } from "./redirect";
import { InMemoryOAuthSessionStore } from "./session-store";
import type {
  OAuthAuthorizationRequest,
  OAuthAuthorizationResult,
  OAuthStatusResponse,
  StoredTokenBundle,
  TokenVault,
} from "./types";

interface OAuthRequestAuth {
  headers: Record<string, string>;
}

interface OAuthServiceDependencies {
  vault: TokenVault & {
    getValidAccessToken?: (accountId: string) => Promise<StoredTokenBundle | { accessToken: string } | null>;
  };
  openAIClientFactory?: (
    clientId: string
  ) => Pick<OpenAIOAuthClient, "refresh" | "exchangeAuthorizationCode">;
  sessionStore?: Pick<InMemoryOAuthSessionStore, "issue" | "consume">;
  logger?: {
    warn?: (...args: any[]) => void;
  };
  now?: () => number;
  stateFactory?: () => string;
  authorizeEndpoint?: string;
  redirectAllowlist?: readonly string[];
}

export class OAuthService {
  private readonly now: () => number;
  private readonly openAIClients = new Map<
    string,
    Pick<OpenAIOAuthClient, "refresh" | "exchangeAuthorizationCode">
  >();
  private readonly sessionStore: Pick<InMemoryOAuthSessionStore, "issue" | "consume">;
  private readonly stateFactory: () => string;
  private readonly authorizeEndpoint: string;
  private readonly redirectAllowlist: readonly string[];

  constructor(private readonly deps: OAuthServiceDependencies) {
    this.now = deps.now ?? Date.now;
    this.sessionStore = deps.sessionStore ?? new InMemoryOAuthSessionStore({ now: this.now });
    this.stateFactory = deps.stateFactory ?? (() => randomBytes(32).toString("base64url"));
    this.authorizeEndpoint = deps.authorizeEndpoint ?? "https://auth0.openai.com/authorize";
    this.redirectAllowlist = deps.redirectAllowlist ?? [];
  }

  async buildRequestAuth(provider: Partial<LLMProvider>): Promise<OAuthRequestAuth> {
    const normalizedProvider = normalizeOAuthProviderConfig(provider as any) as Partial<LLMProvider>;

    if (normalizedProvider.auth_strategy !== "openai-oauth") {
      return {
        headers: normalizedProvider.apiKey
          ? { Authorization: `Bearer ${normalizedProvider.apiKey}` }
          : {},
      };
    }

    if (!normalizedProvider.account_id) {
      throw this.createReauthRequiredError();
    }

    const token = await this.getValidAccessToken(normalizedProvider as Partial<LLMProvider> & { account_id: string });
    if (!token?.accessToken) {
      throw this.createReauthRequiredError();
    }

    return {
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
      },
    };
  }

  async beginAuthorization(provider: Partial<LLMProvider>): Promise<OAuthAuthorizationRequest> {
    const normalizedProvider = this.requireOAuthProvider(provider);
    const redirectUri = normalizedProvider.oauth!.redirect_uri!;

    assertAllowedLoopbackRedirect(redirectUri, this.redirectAllowlist);

    const { codeVerifier, codeChallenge, method } = createPkcePair();
    const state = this.stateFactory();
    this.sessionStore.issue(state, {
      codeVerifier,
      redirectUri,
    });

    const authorizationUrl = new URL(this.authorizeEndpoint);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("client_id", normalizedProvider.oauth!.client_id!);
    authorizationUrl.searchParams.set("redirect_uri", redirectUri);
    authorizationUrl.searchParams.set("scope", normalizedProvider.oauth!.scopes!.join(" "));
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("code_challenge", codeChallenge);
    authorizationUrl.searchParams.set("code_challenge_method", method);

    return {
      authorizationUrl: authorizationUrl.toString(),
      state,
    };
  }

  async completeAuthorization(input: {
    provider: Partial<LLMProvider>;
    state?: string | null;
    code?: string | null;
    error?: string | null;
    errorDescription?: string | null;
    stateCookieValue?: string;
    callbackUrl?: string;
  }): Promise<OAuthAuthorizationResult> {
    const normalizedProvider = this.requireOAuthProvider(input.provider);

    if (input.callbackUrl) {
      const parsedCallbackUrl = new URL(input.callbackUrl);
      this.assertCallbackRedirectMatches(normalizedProvider.oauth!.redirect_uri!, parsedCallbackUrl);
      input = {
        ...input,
        state: input.state ?? parsedCallbackUrl.searchParams.get("state"),
        code: input.code ?? parsedCallbackUrl.searchParams.get("code"),
        error: input.error ?? parsedCallbackUrl.searchParams.get("error"),
        errorDescription:
          input.errorDescription ?? parsedCallbackUrl.searchParams.get("error_description"),
      };
    }

    if (input.error) {
      throw new Error(input.errorDescription ?? input.error);
    }

    if (!input.state || !input.code) {
      throw new Error("OAuth callback must include both state and code");
    }

    if (!input.stateCookieValue || input.stateCookieValue !== input.state) {
      throw new Error("OAuth state did not match the signed session cookie");
    }

    const session = this.sessionStore.consume(input.state);
    if (!session) {
      throw new Error("OAuth state is invalid or has expired");
    }

    const bundle = await this.getOpenAIClient(
      normalizedProvider.oauth!.client_id!
    ).exchangeAuthorizationCode({
      code: input.code,
      codeVerifier: session.codeVerifier,
      redirectUri: session.redirectUri,
    });

    return {
      accountId: bundle.accountId,
      email: bundle.email,
      expiresAt: bundle.expiresAt,
    };
  }

  async getStatus(): Promise<OAuthStatusResponse> {
    const bundles = await this.deps.vault.list();
    return {
      accounts: bundles.map((bundle) => ({
        accountId: bundle.accountId,
        email: bundle.email,
        expiresAt: bundle.expiresAt,
        invalid: Boolean(bundle.invalid),
        reauthRequired: Boolean(bundle.invalid) || this.isExpired(bundle.expiresAt),
      })),
    };
  }

  private async getValidAccessToken(
    provider: Partial<LLMProvider> & { account_id: string }
  ) {
    const accountId = provider.account_id;

    if (typeof this.deps.vault.getValidAccessToken === "function") {
      return this.deps.vault.getValidAccessToken(accountId);
    }

    const token = await this.deps.vault.get(accountId);
    if (!token || token.invalid) {
      return null;
    }

    if (!this.isExpired(token.expiresAt)) {
      return token;
    }

    if (!token.refreshToken) {
      return null;
    }

    try {
      return await this.getOpenAIClient(provider.oauth?.client_id).refresh({
        accountId,
        refreshToken: token.refreshToken,
      });
    } catch (error) {
      this.deps.logger?.warn?.({ error, accountId }, "Failed to refresh OAuth access token");
      return null;
    }
  }

  private isExpired(expiresAt: string) {
    const expiresAtMs = Date.parse(expiresAt);
    if (!Number.isFinite(expiresAtMs)) {
      return true;
    }

    return expiresAtMs <= this.now() + 60_000;
  }

  private createReauthRequiredError() {
    const error = new Error("reauth_required");
    (error as Error & { code?: string }).code = "reauth_required";
    return error;
  }

  private requireOAuthProvider(provider: Partial<LLMProvider>) {
    const normalizedProvider = normalizeOAuthProviderConfig(provider as any) as Partial<LLMProvider>;
    if (normalizedProvider.auth_strategy !== "openai-oauth" || !normalizedProvider.oauth?.client_id || !normalizedProvider.oauth.redirect_uri) {
      throw new Error("OpenAI OAuth provider is not configured");
    }

    return normalizedProvider as Partial<LLMProvider> & {
      oauth: {
        client_id: string;
        redirect_uri: string;
        scopes: string[];
      };
    };
  }

  private assertCallbackRedirectMatches(expectedRedirectUri: string, callbackUrl: URL) {
    const expectedUrl = new URL(expectedRedirectUri);
    if (expectedUrl.origin !== callbackUrl.origin || expectedUrl.pathname !== callbackUrl.pathname) {
      throw new Error("OAuth callback URL redirect does not match the configured redirect URI");
    }
  }

  private getOpenAIClient(clientId: string) {
    const cachedClient = this.openAIClients.get(clientId);
    if (cachedClient) {
      return cachedClient;
    }

    const client =
      this.deps.openAIClientFactory?.(clientId) ??
      new OpenAIOAuthClient({
        clientId,
        vault: this.deps.vault,
      });

    this.openAIClients.set(clientId, client);
    return client;
  }
}
