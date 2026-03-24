import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CodexAuthAccount } from "./types";

const DEFAULT_CODEX_HOME = join(homedir(), ".codex");

interface CodexAuthSourceOptions {
  codexHome?: string;
  now?: () => number;
}

type CodexAuthPayload = {
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    account_id?: string;
  };
  last_refresh?: string;
};

type CodexRegistry = {
  active_account_key?: unknown;
  accounts?: Array<{
    account_key?: unknown;
  }>;
};

export async function listCodexAuthAccounts(
  options: CodexAuthSourceOptions = {},
): Promise<CodexAuthAccount[]> {
  const registryAccounts = await loadRegistryAccounts(options);
  if (registryAccounts.length > 0) {
    return registryAccounts;
  }

  const fallbackAccount = await loadFallbackAccount(options);
  return fallbackAccount ? [fallbackAccount] : [];
}

export async function getActiveCodexAuthAccount(
  options: CodexAuthSourceOptions = {},
): Promise<CodexAuthAccount | null> {
  const registry = await loadRegistry(options);
  const activeAccountKey =
    typeof registry?.active_account_key === "string" ? registry.active_account_key : null;
  if (activeAccountKey) {
    return (await loadAccountByRegistryKey(activeAccountKey, options)) ?? loadFallbackAccount(options);
  }

  return loadFallbackAccount(options);
}

export async function getCodexAuthAccountById(
  accountId: string,
  options: CodexAuthSourceOptions = {},
): Promise<CodexAuthAccount | null> {
  const accounts = await listCodexAuthAccounts(options);
  return accounts.find((account) => account.accountId === accountId) ?? null;
}

async function loadRegistryAccounts(options: CodexAuthSourceOptions): Promise<CodexAuthAccount[]> {
  const registry = await loadRegistry(options);
  if (!registry) {
    return [];
  }

  const accountKeys = Array.isArray(registry.accounts)
    ? registry.accounts
        .map((account) => (typeof account?.account_key === "string" ? account.account_key : null))
        .filter((value): value is string => Boolean(value))
    : [];

  if (accountKeys.length === 0) {
    const activeAccountKey =
      typeof registry.active_account_key === "string" ? registry.active_account_key : null;
    if (activeAccountKey) {
      accountKeys.push(activeAccountKey);
    }
  }

  const accounts = await Promise.all(accountKeys.map((accountKey) => loadAccountByRegistryKey(accountKey, options)));
  return accounts.filter((account): account is CodexAuthAccount => account !== null);
}

async function loadActiveRegistryAccount(
  options: CodexAuthSourceOptions,
): Promise<CodexAuthAccount | null> {
  const registry = await loadRegistry(options);
  const activeAccountKey =
    typeof registry?.active_account_key === "string" ? registry.active_account_key : null;
  if (!activeAccountKey) {
    return null;
  }

  return loadAccountByRegistryKey(activeAccountKey, options);
}

async function loadFallbackAccount(options: CodexAuthSourceOptions): Promise<CodexAuthAccount | null> {
  try {
    const raw = await readFile(join(options.codexHome ?? DEFAULT_CODEX_HOME, "auth.json"), "utf8");
    return parseCodexAuthPayload(JSON.parse(raw) as CodexAuthPayload, options.now);
  } catch {
    return null;
  }
}

async function loadAccountByRegistryKey(
  accountKey: string,
  options: CodexAuthSourceOptions,
): Promise<CodexAuthAccount | null> {
  try {
    const authPath = join(
      options.codexHome ?? DEFAULT_CODEX_HOME,
      "accounts",
      `${Buffer.from(accountKey).toString("base64url")}.auth.json`,
    );
    const raw = await readFile(authPath, "utf8");
    return parseCodexAuthPayload(JSON.parse(raw) as CodexAuthPayload, options.now);
  } catch {
    return null;
  }
}

async function loadRegistry(options: CodexAuthSourceOptions): Promise<CodexRegistry | null> {
  try {
    const raw = await readFile(
      join(options.codexHome ?? DEFAULT_CODEX_HOME, "accounts", "registry.json"),
      "utf8",
    );
    return JSON.parse(raw) as CodexRegistry;
  } catch {
    return null;
  }
}

function parseCodexAuthPayload(
  parsed: CodexAuthPayload,
  now: (() => number) | undefined,
): CodexAuthAccount | null {
  const tokens = parsed?.tokens;
  if (!tokens?.access_token || !tokens?.refresh_token) {
    return null;
  }

  const expiryMs = resolveExpiryMs(tokens.access_token, parsed?.last_refresh, now);

  const accountId =
    tokens.account_id ??
    decodeJwtSubject(tokens.access_token) ??
    decodeJwtEmail(tokens.id_token) ??
    decodeJwtEmail(tokens.access_token) ??
    "codex-cli";

  return {
    accountId,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    email: decodeJwtEmail(tokens.id_token) ?? decodeJwtEmail(tokens.access_token) ?? undefined,
    expiresAt: new Date(expiryMs).toISOString(),
    source: "codex-cli",
    invalid: false,
  };
}

function decodeIsoDateMs(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function resolveExpiryMs(
  accessToken: string,
  lastRefresh: string | undefined,
  now: (() => number) | undefined,
) {
  const jwtExpiryMs = decodeJwtExpiryMs(accessToken);
  if (jwtExpiryMs) {
    return jwtExpiryMs;
  }

  const lastRefreshMs = decodeIsoDateMs(lastRefresh);
  if (lastRefreshMs) {
    return lastRefreshMs + 60 * 60 * 1000;
  }

  return (now ?? Date.now)() + 60 * 60 * 1000;
}

function decodeJwtExpiryMs(token: string) {
  const payload = decodeJwtPayload(token);
  return typeof payload?.exp === "number" ? payload.exp * 1000 : null;
}

function decodeJwtSubject(token: string) {
  const payload = decodeJwtPayload(token);
  return typeof payload?.sub === "string" ? payload.sub : null;
}

function decodeJwtEmail(token: string | undefined) {
  if (!token) {
    return null;
  }

  const payload = decodeJwtPayload(token);
  return typeof payload?.email === "string" ? payload.email : null;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const [, payload] = token.split(".");
  if (!payload) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}
