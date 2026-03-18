import type { LLMProvider } from "@/types/llm";
import type { OpenAIOAuthClient } from "./openai-client";
import type { StoredTokenBundle, TokenVault } from "./types";

interface OAuthRequestAuth {
  headers: Record<string, string>;
}

interface OAuthServiceDependencies {
  vault: TokenVault & {
    getValidAccessToken?: (accountId: string) => Promise<StoredTokenBundle | { accessToken: string } | null>;
  };
  openAIClient?: Pick<OpenAIOAuthClient, "refresh">;
  logger?: {
    warn?: (...args: any[]) => void;
  };
  now?: () => number;
}

export class OAuthService {
  private readonly now: () => number;

  constructor(private readonly deps: OAuthServiceDependencies) {
    this.now = deps.now ?? Date.now;
  }

  async buildRequestAuth(provider: Partial<LLMProvider>): Promise<OAuthRequestAuth> {
    if (provider.auth_strategy !== "openai-oauth") {
      return {
        headers: provider.apiKey
          ? { Authorization: `Bearer ${provider.apiKey}` }
          : {},
      };
    }

    if (!provider.account_id) {
      throw this.createReauthRequiredError();
    }

    const token = await this.getValidAccessToken(provider.account_id);
    if (!token?.accessToken) {
      throw this.createReauthRequiredError();
    }

    return {
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
      },
    };
  }

  private async getValidAccessToken(accountId: string) {
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

    if (!this.deps.openAIClient || !token.refreshToken) {
      return null;
    }

    try {
      return await this.deps.openAIClient.refresh({
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
}
