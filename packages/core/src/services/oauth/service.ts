import type { LLMProvider } from "@/types/llm";
import { OpenAIOAuthClient } from "./openai-client";
import { normalizeOAuthProviderConfig } from "./config";
import type { StoredTokenBundle, TokenVault } from "./types";

interface OAuthRequestAuth {
  headers: Record<string, string>;
}

interface OAuthServiceDependencies {
  vault: TokenVault & {
    getValidAccessToken?: (accountId: string) => Promise<StoredTokenBundle | { accessToken: string } | null>;
  };
  openAIClientFactory?: (clientId: string) => Pick<OpenAIOAuthClient, "refresh">;
  logger?: {
    warn?: (...args: any[]) => void;
  };
  now?: () => number;
}

export class OAuthService {
  private readonly now: () => number;
  private readonly openAIClients = new Map<string, Pick<OpenAIOAuthClient, "refresh">>();

  constructor(private readonly deps: OAuthServiceDependencies) {
    this.now = deps.now ?? Date.now;
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
