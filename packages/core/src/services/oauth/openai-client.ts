import { validateIdToken } from "./jwks";
import { assertNoDuplicateEmail } from "./duplicate-email";
import type {
  ExchangeAuthorizationCodeInput,
  IdTokenValidator,
  RefreshTokenInput,
  RefreshTokenResponse,
  StoredTokenBundle,
  TokenVault,
} from "./types";

export const DEFAULT_OPENAI_AUTHORIZE_ENDPOINT = "https://auth.openai.com/oauth/authorize";
export const DEFAULT_OPENAI_TOKEN_ENDPOINT = "https://auth.openai.com/oauth/token";

export interface OpenAIOAuthClientOptions {
  clientId: string;
  vault: TokenVault;
  fetch?: typeof fetch;
  tokenEndpoint?: string;
  tokenParams?: Record<string, string>;
  issuer?: string;
  audience?: string;
  jwksUrl?: string;
  now?: () => number;
  validateIdToken?: IdTokenValidator;
}

export class OpenAIOAuthClient {
  private readonly clientId: string;
  private readonly vault: TokenVault;
  private readonly fetchImpl: typeof fetch;
  private readonly tokenEndpoint: string;
  private readonly tokenParams?: Record<string, string>;
  private readonly issuer?: string;
  private readonly audience?: string;
  private readonly jwksUrl?: string;
  private readonly now: () => number;
  private readonly validateIdTokenImpl: IdTokenValidator;

  constructor(options: OpenAIOAuthClientOptions) {
    this.clientId = options.clientId;
    this.vault = options.vault;
    this.fetchImpl = options.fetch ?? fetch;
    this.tokenEndpoint = options.tokenEndpoint ?? DEFAULT_OPENAI_TOKEN_ENDPOINT;
    this.tokenParams = options.tokenParams;
    this.issuer = options.issuer;
    this.audience = options.audience;
    this.jwksUrl = options.jwksUrl;
    this.now = options.now ?? Date.now;
    this.validateIdTokenImpl = options.validateIdToken ?? validateIdToken;
  }

  async refresh(input: RefreshTokenInput): Promise<StoredTokenBundle> {
    const response = await this.fetchImpl(this.tokenEndpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: this.clientId,
        refresh_token: input.refreshToken,
        ...(this.tokenParams ?? {}),
      }),
    });

    const payload = await parseTokenResponse(response);
    if (!response.ok || !payload.access_token) {
      if (payload.error === "invalid_grant") {
        await this.vault.markInvalid(input.accountId, input.refreshToken);
      }
      throw new Error(payload.error_description ?? payload.error ?? "Failed to refresh OAuth token");
    }

    const idTokenClaims = payload.id_token
      ? await this.validateIdTokenImpl(payload.id_token, this.clientId, {
        issuer: this.issuer,
        audience: this.audience,
        jwksUrl: this.jwksUrl,
      })
      : undefined;

    const bundle: StoredTokenBundle = {
      accountId: input.accountId,
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? input.refreshToken,
      idToken: payload.id_token,
      email: typeof idTokenClaims?.email === "string" ? idTokenClaims.email : undefined,
      source: "oauth",
      expiresAt: new Date(this.now() + resolveExpiresIn(payload.expires_in) * 1000).toISOString(),
      invalid: false,
    };

    await this.vault.save(bundle);
    return bundle;
  }

  async exchangeAuthorizationCode(input: ExchangeAuthorizationCodeInput): Promise<StoredTokenBundle> {
    const response = await this.fetchImpl(this.tokenEndpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: this.clientId,
        code: input.code,
        code_verifier: input.codeVerifier,
        redirect_uri: input.redirectUri,
        ...(this.tokenParams ?? {}),
      }),
    });

    const payload = await parseTokenResponse(response);
    if (!response.ok || !payload.access_token) {
      throw new Error(payload.error_description ?? payload.error ?? "Failed to exchange OAuth authorization code");
    }

    if (!payload.refresh_token) {
      throw new Error("OAuth token response did not include a refresh token");
    }

    const idTokenClaims = payload.id_token
      ? await this.validateIdTokenImpl(payload.id_token, this.clientId, {
        issuer: this.issuer,
        audience: this.audience,
        jwksUrl: this.jwksUrl,
      })
      : undefined;
    const accountId =
      typeof idTokenClaims?.sub === "string"
        ? idTokenClaims.sub
        : typeof idTokenClaims?.email === "string"
          ? idTokenClaims.email
          : undefined;

    if (!accountId) {
      throw new Error("OAuth ID token did not include a usable account identifier");
    }

    const bundle: StoredTokenBundle = {
      accountId,
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      idToken: payload.id_token,
      email: typeof idTokenClaims?.email === "string" ? idTokenClaims.email : undefined,
      source: "oauth",
      expiresAt: new Date(this.now() + resolveExpiresIn(payload.expires_in) * 1000).toISOString(),
      invalid: false,
    };

    await assertNoDuplicateEmail(this.vault, bundle);
    await this.vault.save(bundle);
    return bundle;
  }
}

async function parseTokenResponse(response: Response): Promise<RefreshTokenResponse> {
  try {
    return (await response.clone().json()) as RefreshTokenResponse;
  } catch {
    const text = await response.text().catch(() => "");
    return text.trim()
      ? { error: text.trim() }
      : {};
  }
}

function resolveExpiresIn(expiresIn: number | undefined) {
  return typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0
    ? expiresIn
    : 3600;
}
