export interface OAuthProviderConfig {
    name?: string;
    auth_strategy?: "api-key" | "codex-auth";
    account_id?: string;
    oauth?: {
        client_id?: string;
        scopes?: string[];
    };
}
export declare const CODEX_AUTH_SINGLE_PROVIDER_ERROR = "Only one codex-auth provider is supported at a time. Use account_id to bind different authorized Codex accounts.";
export declare function getAutoBootstrappedCodexAuthConfig(config: {
    providers?: OAuthProviderConfig[];
    Providers?: OAuthProviderConfig[];
    Router?: Record<string, any>;
}, options: {
    hasImportedCredential: boolean;
    defaultRedirectUri?: string;
}): {
    providers: OAuthProviderConfig[];
    Router: {
        [x: string]: any;
        default: any;
    };
} | null;
export declare function syncCodexAuthProviderWithCodexAccount(config: {
    providers?: OAuthProviderConfig[];
    Providers?: OAuthProviderConfig[];
    Router?: Record<string, any>;
}, options: {
    importedAccountId?: string | null;
    previousCodexAccountIds?: string[];
}): {
    providerName: string;
    accountId: string;
} | null;
export declare function normalizeOAuthProviderConfig(provider: OAuthProviderConfig, options?: {
    defaultRedirectUri?: string;
}): OAuthProviderConfig;
export declare function getCodexAuthProviders<T extends OAuthProviderConfig>(providers?: T[]): T[];
export declare function assertSingleCodexAuthProvider<T extends OAuthProviderConfig>(providers?: T[]): void;
export declare function assertCodexAuthProviderLimit<T extends OAuthProviderConfig>(providers: T[] | undefined, candidate: T, currentProviderName?: string): void;
