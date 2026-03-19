import { normalizeOpenAICodexBaseUrl } from "./openai-codex";

export interface OAuthProviderConfig {
  name?: string;
  auth_strategy?: "api-key" | "openai-oauth";
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
    redirect_uri?: string;
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
const DEFAULT_REDIRECT_URI = "http://localhost:1455/auth/callback";
const DEFAULT_SCOPES = ["openid", "email", "profile", "offline_access"];
const DEFAULT_AUTHORIZE_PARAMS = {
  id_token_add_organizations: "true",
  codex_cli_simplified_flow: "true",
  originator: "pi",
};

const DEFAULT_BOOTSTRAP_PROVIDER_NAME = "openai-oauth";
const DEFAULT_BOOTSTRAP_MODEL = "gpt-5.4";

export const OPENAI_OAUTH_SINGLE_PROVIDER_ERROR =
  "Only one openai-oauth provider is supported at a time. Use account_id to bind different authorized OpenAI accounts.";
export function getAutoBootstrappedOpenAIOAuthConfig(
  config: {
    providers?: OAuthProviderConfig[];
    Providers?: OAuthProviderConfig[];
    Router?: Record<string, any>;
  },
  options: { hasImportedCredential: boolean; defaultRedirectUri?: string },
) {
  const existingProviders = config.providers ?? config.Providers ?? [];
  if (Array.isArray(existingProviders) && existingProviders.length > 0) {
    return null;
  }

  const existingRouter = config.Router ?? {};
  if (existingRouter.default) {
    return null;
  }

  const provider = normalizeOAuthProviderConfig(
    {
      name: DEFAULT_BOOTSTRAP_PROVIDER_NAME,
      auth_strategy: "openai-oauth",
      api_base_url: normalizeOpenAICodexBaseUrl(undefined),
      api_key: "",
      account_id: "",
      models: [DEFAULT_BOOTSTRAP_MODEL],
    },
  );

  return {
    providers: [provider],
    Router: {
      ...existingRouter,
      default: `${DEFAULT_BOOTSTRAP_PROVIDER_NAME},${DEFAULT_BOOTSTRAP_MODEL}`,
    },
  };
}

export function normalizeOAuthProviderConfig(
  provider: OAuthProviderConfig,
  options: { defaultRedirectUri?: string } = {},
) {
  if (provider.auth_strategy !== "openai-oauth") return provider;

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
    api_base_url: normalizeOpenAICodexBaseUrl(provider.api_base_url),
    transformer: normalizedTransformer,
    oauth: {
      client_id: provider.oauth?.client_id ?? DEFAULT_CLIENT_ID,
      redirect_uri: provider.oauth?.redirect_uri ?? options.defaultRedirectUri ?? DEFAULT_REDIRECT_URI,
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

export function getOpenAIOAuthProviders<T extends OAuthProviderConfig>(providers: T[] = []) {
  return providers.filter((provider) => provider.auth_strategy === "openai-oauth");
}

export function assertSingleOpenAIOAuthProvider<T extends OAuthProviderConfig>(providers: T[] = []) {
  if (getOpenAIOAuthProviders(providers).length > 1) {
    throw new Error(OPENAI_OAUTH_SINGLE_PROVIDER_ERROR);
  }
}

export function assertOpenAIOAuthProviderLimit<T extends OAuthProviderConfig>(
  providers: T[] = [],
  candidate: T,
  currentProviderName?: string,
) {
  if (candidate.auth_strategy !== "openai-oauth") {
    return;
  }

  const remainingProviders = currentProviderName
    ? providers.filter((provider) => provider.name !== currentProviderName)
    : providers;
  assertSingleOpenAIOAuthProvider([...remainingProviders, candidate]);
}
