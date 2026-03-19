export interface OAuthProviderConfig {
    name?: string;
    auth_strategy?: "api-key" | "openai-oauth";
    account_id?: string;
    oauth?: {
        client_id?: string;
        redirect_uri?: string;
        scopes?: string[];
    };
}
export declare const OPENAI_OAUTH_SINGLE_PROVIDER_ERROR = "Only one openai-oauth provider is supported at a time. Use account_id to bind different authorized OpenAI accounts.";
export declare function normalizeOAuthProviderConfig(provider: OAuthProviderConfig, options?: {
    defaultRedirectUri?: string;
}): OAuthProviderConfig;
export declare function getOpenAIOAuthProviders<T extends OAuthProviderConfig>(providers?: T[]): T[];
export declare function assertSingleOpenAIOAuthProvider<T extends OAuthProviderConfig>(providers?: T[]): void;
export declare function assertOpenAIOAuthProviderLimit<T extends OAuthProviderConfig>(providers: T[] | undefined, candidate: T, currentProviderName?: string): void;
