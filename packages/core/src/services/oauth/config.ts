export interface OAuthProviderConfig {
  auth_strategy?: "api-key" | "openai-oauth";
  account_id?: string;
  oauth?: {
    client_id?: string;
    redirect_uri?: string;
    scopes?: string[];
  };
}

const DEFAULT_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const DEFAULT_REDIRECT_URI = "http://localhost:3456/oauth/callback";
const DEFAULT_SCOPES = ["openid", "email", "profile", "offline_access"];

export function normalizeOAuthProviderConfig(
  provider: OAuthProviderConfig,
  options: { defaultRedirectUri?: string } = {},
) {
  if (provider.auth_strategy !== "openai-oauth") return provider;

  return {
    ...provider,
    oauth: {
      client_id: provider.oauth?.client_id ?? DEFAULT_CLIENT_ID,
      redirect_uri: provider.oauth?.redirect_uri ?? options.defaultRedirectUri ?? DEFAULT_REDIRECT_URI,
      scopes: provider.oauth?.scopes ?? DEFAULT_SCOPES,
    },
  };
}
