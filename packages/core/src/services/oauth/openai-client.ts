import { validateIdToken } from "./jwks";
import type {
  IdTokenValidator,
  RefreshTokenInput,
  RefreshTokenResponse,
  StoredTokenBundle,
  TokenVault,
} from "./types";

export const DEFAULT_OPENAI_TOKEN_ENDPOINT = "https://auth0.openai.com/oauth/token";

export interface OpenAIOAuthClientOptions {
  clientId: string;
  vault: TokenVault;
  fetch?: typeof fetch;
  tokenEndpoint?: string;
  now?: () => number;
  validateIdToken?: IdTokenValidator;
}

export class OpenAIOAuthClient {
  private readonly clientId: string;
  private readonly vault: TokenVault;
  private readonly fetchImpl: typeof fetch;
  private readonly tokenEndpoint: string;
  private readonly now: () => number;
  private readonly validateIdTokenImpl: IdTokenValidator;

  constructor(options: OpenAIOAuthClientOptions) {
    this.clientId = options.clientId;
    this.vault = options.vault;
    this.fetchImpl = options.fetch ?? fetch;
    this.tokenEndpoint = options.tokenEndpoint ?? DEFAULT_OPENAI_TOKEN_ENDPOINT;
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
      }),
    });

    const payload = await parseRefreshResponse(response);
    if (!response.ok || !payload.access_token) {
      if (payload.error === "invalid_grant") {
        await this.vault.markInvalid(input.accountId, input.refreshToken);
      }
      throw new Error(payload.error_description ?? payload.error ?? "Failed to refresh OAuth token");
    }

    const idTokenClaims = payload.id_token
      ? await this.validateIdTokenImpl(payload.id_token, this.clientId)
      : undefined;

    const bundle: StoredTokenBundle = {
      accountId: input.accountId,
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? input.refreshToken,
      idToken: payload.id_token,
      email: typeof idTokenClaims?.email === "string" ? idTokenClaims.email : undefined,
      expiresAt: new Date(this.now() + resolveExpiresIn(payload.expires_in) * 1000).toISOString(),
      invalid: false,
    };

    await this.vault.save(bundle);
    return bundle;
  }
}

async function parseRefreshResponse(response: Response): Promise<RefreshTokenResponse> {
  try {
    return (await response.json()) as RefreshTokenResponse;
  } catch {
    return {};
  }
}

function resolveExpiresIn(expiresIn: number | undefined) {
  return typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0
    ? expiresIn
    : 3600;
}
