import { normalizeOpenAICodexBaseUrl } from "./openai-codex";

export interface OAuthProviderConfig {
  name?: string;
  auth_strategy?: "api-key" | "codex-auth";
  api_base_url?: string;
  api_key?: string;
  account_id?: string;
  models?: string[];
  transformer?: {
    use?: any[];
    [key: string]: any;
  };
  oauth?: {
    client_id?: string;
    scopes?: string[];
    authorization_endpoint?: string;
    token_endpoint?: string;
    jwks_url?: string;
    issuer?: string;
    audience?: string;
    authorize_params?: Record<string, string>;
    token_params?: Record<string, string>;
  };
}

const DEFAULT_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const DEFAULT_SCOPES = ["openid", "email", "profile", "offline_access"];
const DEFAULT_AUTHORIZE_PARAMS = {
  id_token_add_organizations: "true",
  codex_cli_simplified_flow: "true",
  originator: "pi",
};

const DEFAULT_BOOTSTRAP_PROVIDER_NAME = "codex-auth";
const DEFAULT_BOOTSTRAP_MODEL = "gpt-5.4";
const LEGACY_BOOTSTRAP_PROVIDER_NAME = "openai-oauth";

export const CODEX_AUTH_SINGLE_PROVIDER_ERROR =
  "Only one codex-auth provider is supported at a time. Use account_id to bind different authorized Codex accounts.";
export function getAutoBootstrappedCodexAuthConfig(
  config: {
    providers?: OAuthProviderConfig[];
    Providers?: OAuthProviderConfig[];
    Router?: Record<string, any>;
  },
  options: { hasImportedCredential: boolean; defaultRedirectUri?: string },
) {
  const existingProviders = Array.isArray(config.providers ?? config.Providers)
    ? [...(config.providers ?? config.Providers ?? [])]
    : [];
  const existingRouter = config.Router ?? {};
  const hasOAuthProvider = existingProviders.some(
    (provider) => provider.auth_strategy === "codex-auth",
  );
  if (hasOAuthProvider) {
    return null;
  }

  const shouldAddBuiltInProvider =
    existingProviders.length === 0
      ? !existingRouter.default || options.hasImportedCredential || routerReferencesBuiltInProvider(existingRouter)
      : options.hasImportedCredential || routerReferencesBuiltInProvider(existingRouter);

  if (!shouldAddBuiltInProvider) {
    return null;
  }

  const provider = normalizeOAuthProviderConfig(
    {
      name: DEFAULT_BOOTSTRAP_PROVIDER_NAME,
      auth_strategy: "codex-auth",
      api_base_url: normalizeOpenAICodexBaseUrl(undefined),
      api_key: "",
      account_id: "",
      models: [DEFAULT_BOOTSTRAP_MODEL],
    },
  );

  return {
    providers: [...existingProviders, provider],
    Router: {
      ...existingRouter,
      default:
        existingRouter.default ??
        `${DEFAULT_BOOTSTRAP_PROVIDER_NAME},${DEFAULT_BOOTSTRAP_MODEL}`,
    },
  };
}

export function syncCodexAuthProviderWithCodexAccount(
  config: {
    providers?: OAuthProviderConfig[];
    Providers?: OAuthProviderConfig[];
    Router?: Record<string, any>;
  },
  options: {
    importedAccountId?: string | null;
    previousCodexAccountIds?: string[];
  },
) {
  const importedAccountId = options.importedAccountId ?? null;
  if (!importedAccountId) {
    return null;
  }

  const previousCodexAccountIds = new Set(options.previousCodexAccountIds ?? []);
  if (previousCodexAccountIds.size === 0) {
    return null;
  }

  const existingProviders = config.providers ?? config.Providers ?? [];
  const oauthProvider = existingProviders.find(
    (provider) => provider.auth_strategy === "codex-auth",
  );
  if (!oauthProvider?.name) {
    return null;
  }

  if (!oauthProvider.account_id || !previousCodexAccountIds.has(oauthProvider.account_id)) {
    return null;
  }

  if (oauthProvider.account_id === importedAccountId) {
    return null;
  }

  return {
    providerName: oauthProvider.name,
    accountId: importedAccountId,
  };
}

export function normalizeOAuthProviderConfig(
  provider: OAuthProviderConfig,
  options: { defaultRedirectUri?: string } = {},
) {
  const isCodexAuthProvider =
    provider.auth_strategy === "codex-auth" ||
    provider.auth_strategy === LEGACY_BOOTSTRAP_PROVIDER_NAME;
  if (!isCodexAuthProvider) return provider;

  const transformer = provider.transformer;
  const normalizedTransformer =
    Array.isArray(transformer?.use) && transformer.use.length > 0
      ? transformer
      : {
          ...transformer,
          use: ["openai-codex-responses"],
        };

  return {
    ...provider,
    name:
      provider.name === LEGACY_BOOTSTRAP_PROVIDER_NAME
        ? DEFAULT_BOOTSTRAP_PROVIDER_NAME
        : provider.name,
    auth_strategy: "codex-auth",
    api_base_url: normalizeOpenAICodexBaseUrl(provider.api_base_url),
    transformer: normalizedTransformer,
    oauth: {
      client_id: provider.oauth?.client_id ?? DEFAULT_CLIENT_ID,
      scopes: provider.oauth?.scopes ?? DEFAULT_SCOPES,
      authorization_endpoint: provider.oauth?.authorization_endpoint,
      token_endpoint: provider.oauth?.token_endpoint,
      jwks_url: provider.oauth?.jwks_url,
      issuer: provider.oauth?.issuer,
      audience: provider.oauth?.audience,
      authorize_params: {
        ...DEFAULT_AUTHORIZE_PARAMS,
        ...(provider.oauth?.authorize_params ?? {}),
      },
      token_params: provider.oauth?.token_params,
    },
  };
}

export function getCodexAuthProviders<T extends OAuthProviderConfig>(providers: T[] = []) {
  return providers.filter((provider) => provider.auth_strategy === "codex-auth");
}

export function assertSingleCodexAuthProvider<T extends OAuthProviderConfig>(providers: T[] = []) {
  if (getCodexAuthProviders(providers).length > 1) {
    throw new Error(CODEX_AUTH_SINGLE_PROVIDER_ERROR);
  }
}

export function assertCodexAuthProviderLimit<T extends OAuthProviderConfig>(
  providers: T[] = [],
  candidate: T,
  currentProviderName?: string,
) {
  if (candidate.auth_strategy !== "codex-auth") {
    return;
  }

  const remainingProviders = currentProviderName
    ? providers.filter((provider) => provider.name !== currentProviderName)
    : providers;
  assertSingleCodexAuthProvider([...remainingProviders, candidate]);
}

function routerReferencesBuiltInProvider(router: Record<string, any>) {
  return Object.values(router).some((value) =>
    typeof value === "string" &&
      (value.startsWith(`${DEFAULT_BOOTSTRAP_PROVIDER_NAME},`) ||
        value.startsWith(`${LEGACY_BOOTSTRAP_PROVIDER_NAME},`)),
  );
}
