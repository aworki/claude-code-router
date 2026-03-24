import type { LLMProvider } from "@/types/llm";
import { normalizeOAuthProviderConfig } from "./config";
import {
  buildOpenAICodexUserAgent,
  extractChatGPTAccountIdFromToken,
} from "./openai-codex";
import {
  getActiveCodexAuthAccount,
  getCodexAuthAccountById,
} from "./codex-auth-source";
import type { CodexAuthSource } from "./types";

interface OAuthRequestAuth {
  headers: Record<string, string>;
}

interface OAuthServiceDependencies {
  codexAuthSource?: CodexAuthSource;
  logger?: {
    warn?: (...args: any[]) => void;
  };
}

const defaultCodexAuthSource: CodexAuthSource = {
  getActiveAccount: () => getActiveCodexAuthAccount(),
  getAccountById: (accountId: string) => getCodexAuthAccountById(accountId),
};

export class OAuthService {
  constructor(private readonly deps: OAuthServiceDependencies = {}) {}

  async buildRequestAuth(provider: Partial<LLMProvider>): Promise<OAuthRequestAuth> {
    const normalizedProvider = normalizeOAuthProviderConfig(provider as any) as Partial<LLMProvider>;

    if (normalizedProvider.auth_strategy !== "codex-auth") {
      return {
        headers: normalizedProvider.apiKey
          ? { Authorization: `Bearer ${normalizedProvider.apiKey}` }
          : {},
      };
    }

    const codexAuthSource = this.deps.codexAuthSource ?? defaultCodexAuthSource;
    const account = normalizedProvider.account_id
      ? await codexAuthSource.getAccountById(normalizedProvider.account_id)
      : await codexAuthSource.getActiveAccount();

    if (!account?.accessToken) {
      throw this.createReauthRequiredError();
    }

    return {
      headers: {
        Authorization: `Bearer ${account.accessToken}`,
        "chatgpt-account-id":
          extractChatGPTAccountIdFromToken(account.accessToken) ?? account.accountId,
        originator: "pi",
        "User-Agent": buildOpenAICodexUserAgent(),
      },
    };
  }

  private createReauthRequiredError() {
    const error = new Error("reauth_required");
    (error as Error & { code?: string }).code = "reauth_required";
    return error;
  }
}
