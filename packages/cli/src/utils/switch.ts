import argon2 from "argon2";
import { select } from "@inquirer/prompts";
import { createDecipheriv, createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { readConfigFile, writeConfigFile } from "./index";

interface ProviderConfig {
  name: string;
  auth_strategy?: string;
  account_id?: string;
  models?: string[];
  [key: string]: any;
}

interface RouterConfig {
  default?: string;
  [key: string]: any;
}

interface Config {
  Providers?: ProviderConfig[];
  providers?: ProviderConfig[];
  Router?: RouterConfig;
  [key: string]: any;
}

interface EncryptedVaultRecord {
  version: 1;
  algorithm: "aes-256-gcm";
  kdf: "argon2id";
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

interface StoredTokenBundle {
  accountId: string;
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  email?: string;
  source?: "oauth" | "codex-cli";
  expiresAt: string;
  invalid?: boolean;
}

interface StoredTokenRecord {
  bundle: StoredTokenBundle;
  savedAt: string;
  writeOrder?: number;
}

export interface LocalOAuthAccount {
  accountId: string;
  email?: string;
  source?: "oauth" | "codex-cli";
  expiresAt: string;
  invalid: boolean;
  reauthRequired: boolean;
  accountKey: string;
  accountHint: string;
  emailHint?: string;
}

export type SwitchSelection =
  | {
      kind: "provider";
      providerName: string;
    }
  | {
      kind: "oauth-account";
      providerName: string;
      accountId: string;
    };

export interface SwitchChoice {
  name: string;
  value: string;
  description?: string;
}

const DEFAULT_OAUTH_DIR = path.join(homedir(), ".claude-code-router", "oauth");
const DEFAULT_CODEX_AUTH_FILE = path.join(homedir(), ".codex", "auth.json");

export function buildSwitchChoices(config: Config, accounts: LocalOAuthAccount[]): SwitchChoice[] {
  const providers = getProviders(config);
  const current = getCurrentRoute(config);

  return providers.flatMap((provider) => {
    if (provider.auth_strategy === "openai-oauth") {
      return accounts.map((account) => {
        const label = account.email || account.emailHint || account.accountId;
        const isCurrent =
          current?.providerName === provider.name && provider.account_id === account.accountId;

        return {
          name: `${provider.name} -> ${label} [${account.source ?? "oauth"}]${isCurrent ? " (current)" : ""}`,
          value: `oauth-account:${provider.name}:${account.accountId}`,
          description: account.accountId,
        };
      });
    }

    const isCurrent = current?.providerName === provider.name;
    const model = provider.models?.[0];

    return [
      {
        name: `${provider.name}${model ? ` -> ${model}` : ""}${isCurrent ? " (current)" : ""}`,
        value: `provider:${provider.name}`,
        description: model,
      },
    ];
  });
}

export function resolveSwitchTarget(
  config: Config,
  accounts: LocalOAuthAccount[],
  target: string,
): SwitchSelection | null {
  const normalizedTarget = target.trim().toLowerCase();
  if (!normalizedTarget) {
    return null;
  }

  for (const provider of getProviders(config)) {
    if (provider.name.toLowerCase() === normalizedTarget) {
      return {
        kind: "provider",
        providerName: provider.name,
      };
    }
  }

  const oauthProvider = getProviders(config).find((provider) => provider.auth_strategy === "openai-oauth");
  if (!oauthProvider) {
    return null;
  }

  for (const account of accounts) {
    const candidates = [
      account.accountId,
      account.email,
      account.accountKey,
      account.emailHint,
      account.accountHint,
    ]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.toLowerCase());

    if (candidates.includes(normalizedTarget)) {
      return {
        kind: "oauth-account",
        providerName: oauthProvider.name,
        accountId: account.accountId,
      };
    }
  }

  return null;
}

export function applySwitchSelection(config: Config, selection: SwitchSelection): Config {
  const updated = structuredClone(config);
  const providers = getProviders(updated);

  if (!updated.Router) {
    updated.Router = {};
  }

  const provider = providers.find((entry) => entry.name === selection.providerName);
  if (!provider) {
    throw new Error(`Provider not found: ${selection.providerName}`);
  }

  const model = provider.models?.[0];
  if (!model) {
    throw new Error(`Provider ${provider.name} has no configured models`);
  }

  if (selection.kind === "oauth-account") {
    provider.account_id = selection.accountId;
  }

  updated.Router.default = `${provider.name},${model}`;
  return updated;
}

export async function loadLocalOAuthAccounts(
  options: { rootDir?: string; codexAuthFile?: string } = {},
): Promise<LocalOAuthAccount[]> {
  const rootDir = options.rootDir ?? DEFAULT_OAUTH_DIR;
  const codexAuthFile = options.codexAuthFile ?? DEFAULT_CODEX_AUTH_FILE;
  const accounts = new Map<string, LocalOAuthAccount>();

  for (const account of await loadVaultAccounts(rootDir)) {
    accounts.set(account.accountId, account);
  }

  const codexAccount = await loadCodexAuthAccount(codexAuthFile);
  if (codexAccount) {
    accounts.set(codexAccount.accountId, codexAccount);
  }

  return Array.from(accounts.values()).sort((left, right) => {
    const leftLabel = `${left.source ?? ""}:${left.email ?? left.accountId}`;
    const rightLabel = `${right.source ?? ""}:${right.email ?? right.accountId}`;
    return leftLabel.localeCompare(rightLabel);
  });
}

export async function runSwitchCommand(target?: string) {
  const config = (await readConfigFile()) as Config;
  const accounts = await loadLocalOAuthAccounts();
  const choices = buildSwitchChoices(config, accounts);

  if (!choices.length) {
    throw new Error("No switchable providers or OAuth accounts found in config.");
  }

  const selection =
    target && target.trim()
      ? resolveSwitchTarget(config, accounts, target)
      : parseSelectionValue(
          await select({
            message: "Select the provider or account to switch to:",
            choices,
            pageSize: 12,
          }),
        );

  if (!selection) {
    throw new Error(`No provider or account matched: ${target}`);
  }

  const updated = applySwitchSelection(config, selection);
  await writeConfigFile(updated);

  return {
    selection,
    config: updated,
  };
}

function parseSelectionValue(value: string): SwitchSelection {
  if (value.startsWith("provider:")) {
    return {
      kind: "provider",
      providerName: value.slice("provider:".length),
    };
  }

  if (value.startsWith("oauth-account:")) {
    const [, providerName, accountId] = value.split(":");
    return {
      kind: "oauth-account",
      providerName,
      accountId,
    };
  }

  throw new Error(`Unsupported switch selection: ${value}`);
}

function getProviders(config: Config): ProviderConfig[] {
  const providers = config.Providers ?? config.providers ?? [];
  return Array.isArray(providers) ? providers : [];
}

function getCurrentRoute(config: Config) {
  const route = config.Router?.default;
  if (!route || typeof route !== "string") {
    return null;
  }

  const [providerName, modelName] = route.split(",");
  return providerName ? { providerName, modelName } : null;
}

async function loadVaultAccounts(rootDir: string): Promise<LocalOAuthAccount[]> {
  const passphrase = await readInstallationSecret(rootDir);
  if (!passphrase) {
    return [];
  }

  let names: string[] = [];
  try {
    names = await readdir(rootDir);
  } catch {
    return [];
  }

  const records = await Promise.all(
    names
      .filter((name) => name.endsWith(".json"))
      .map(async (name) => {
        try {
          const raw = await readFile(path.join(rootDir, name), "utf8");
          const encrypted = JSON.parse(raw) as EncryptedVaultRecord;
          const record = await decryptRecord(encrypted, passphrase);
          return toLocalOAuthAccount(record.bundle);
        } catch {
          return null;
        }
      }),
  );

  return records.filter((record): record is LocalOAuthAccount => record !== null);
}

async function readInstallationSecret(rootDir: string) {
  try {
    const value = await readFile(path.join(rootDir, "installation-secret"), "utf8");
    return value.trim();
  } catch {
    return null;
  }
}

async function decryptRecord(record: EncryptedVaultRecord, passphrase: string): Promise<StoredTokenRecord> {
  const salt = Buffer.from(record.salt, "base64");
  const iv = Buffer.from(record.iv, "base64");
  const tag = Buffer.from(record.tag, "base64");
  const ciphertext = Buffer.from(record.ciphertext, "base64");
  const key = (await argon2.hash(passphrase, {
    type: argon2.argon2id,
    salt,
    hashLength: 32,
    raw: true,
  })) as Buffer;

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as StoredTokenRecord;
}

async function loadCodexAuthAccount(codexAuthFile: string): Promise<LocalOAuthAccount | null> {
  try {
    const raw = await readFile(codexAuthFile, "utf8");
    const parsed = JSON.parse(raw);
    const tokens = parsed?.tokens;
    const accessToken = tokens?.access_token;
    const refreshToken = tokens?.refresh_token;
    const accountId = tokens?.account_id;

    if (!accessToken || !refreshToken || !accountId) {
      return null;
    }

    return toLocalOAuthAccount({
      accountId,
      accessToken,
      refreshToken,
      email: decodeJwtEmail(tokens.id_token) ?? decodeJwtEmail(accessToken) ?? undefined,
      source: "codex-cli",
      expiresAt:
        decodeJwtExpiryIso(accessToken) ??
        parsed?.last_refresh ??
        new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      invalid: false,
    });
  } catch {
    return null;
  }
}

function toLocalOAuthAccount(bundle: StoredTokenBundle): LocalOAuthAccount {
  return {
    accountId: bundle.accountId,
    email: bundle.email,
    source: bundle.source,
    expiresAt: bundle.expiresAt,
    invalid: Boolean(bundle.invalid),
    reauthRequired: Boolean(bundle.invalid) || isExpired(bundle.expiresAt),
    accountKey: createHash("sha256").update(bundle.accountId).digest("hex").slice(0, 12),
    accountHint: redactAccountId(bundle.accountId),
    emailHint: bundle.email ? redactEmail(bundle.email) : undefined,
  };
}

function redactAccountId(accountId: string) {
  if (accountId.length <= 4) {
    return `${accountId[0] ?? ""}...${accountId.at(-1) ?? ""}`;
  }

  return `${accountId.slice(0, 2)}...${accountId.slice(-2)}`;
}

function redactEmail(email: string) {
  const [localPart = "", domain = ""] = email.split("@");
  const [domainName = "", tld = ""] = domain.split(".");
  return `${redactSegment(localPart)}@${redactSegment(domainName)}${tld ? `.${tld}` : ""}`;
}

function redactSegment(value: string) {
  if (value.length <= 2) {
    return `${value[0] ?? ""}...${value.at(-1) ?? ""}`;
  }

  return `${value[0]}...${value.at(-1)}`;
}

function isExpired(expiresAt: string) {
  const expiresAtMs = Date.parse(expiresAt);
  return Number.isFinite(expiresAtMs) ? expiresAtMs <= Date.now() : false;
}

function decodeJwtEmail(token?: string | null) {
  const payload = decodeJwtPayload(token);
  return typeof payload?.email === "string" ? payload.email : null;
}

function decodeJwtExpiryIso(token?: string | null) {
  const payload = decodeJwtPayload(token);
  return typeof payload?.exp === "number" ? new Date(payload.exp * 1000).toISOString() : null;
}

function decodeJwtPayload(token?: string | null) {
  if (!token) {
    return null;
  }

  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}
