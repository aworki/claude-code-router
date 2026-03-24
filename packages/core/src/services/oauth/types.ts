export interface CodexAuthAccount {
  accountId: string;
  email?: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  source: "codex-cli";
  invalid: boolean;
}

export interface CodexAuthSource {
  getActiveAccount(): Promise<CodexAuthAccount | null>;
  getAccountById(accountId: string): Promise<CodexAuthAccount | null>;
}
