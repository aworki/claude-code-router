import type { JWTPayload } from "jose";

export interface StoredTokenBundle {
  accountId: string;
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  email?: string;
  expiresAt: string;
  invalid?: boolean;
}

export interface StoredTokenRecord {
  bundle: StoredTokenBundle;
  savedAt: string;
}

export interface TokenVault {
  save(bundle: StoredTokenBundle): Promise<void>;
  get(accountId: string): Promise<StoredTokenBundle | null>;
  list(): Promise<StoredTokenBundle[]>;
  markInvalid(accountId: string, refreshToken: string): Promise<boolean>;
}

export interface TokenVaultKeychain {
  save(record: StoredTokenRecord): Promise<void>;
  get(accountId: string): Promise<StoredTokenRecord | null>;
  list?(): Promise<StoredTokenRecord[]>;
}

export interface RefreshTokenInput {
  accountId: string;
  refreshToken: string;
}

export interface RefreshTokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

export type IdTokenValidator = (idToken: string, clientId: string) => Promise<JWTPayload>;
