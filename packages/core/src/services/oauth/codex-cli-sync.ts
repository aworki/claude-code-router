import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir, platform as osPlatform } from "node:os";
import { join } from "node:path";
import type { StoredTokenBundle, TokenVault } from "./types";

const DEFAULT_CODEX_HOME = join(homedir(), ".codex");
const CODEX_AUTH_KEYCHAIN_SERVICE = "Codex Auth";

interface CodexCliSyncOptions {
  codexHome?: string;
  platform?: NodeJS.Platform;
  existsSync?: typeof existsSync;
  readFileSync?: typeof readFileSync;
  statSync?: typeof statSync;
  execFileSync?: typeof execFileSync;
}

export async function syncCodexCliCredentialToVault(
  vault: TokenVault,
  options: CodexCliSyncOptions = {},
) {
  const credential = readCodexCliCredential(options);
  if (!credential) {
    return null;
  }

  await vault.save(credential);
  return credential;
}

export function readCodexCliCredential(
  options: CodexCliSyncOptions = {},
): StoredTokenBundle | null {
  return (
    readCodexCliCredentialFromKeychain(options) ??
    readCodexCliCredentialFromFile(options)
  );
}

export function selectCodexImportedAccountId(bundles: StoredTokenBundle[]) {
  const validBundles = bundles.filter((bundle) => !bundle.invalid);
  if (validBundles.length !== 1) {
    return null;
  }

  return validBundles[0]?.accountId ?? null;
}

function readCodexCliCredentialFromFile(options: CodexCliSyncOptions) {
  const authPath = join(options.codexHome ?? DEFAULT_CODEX_HOME, "auth.json");
  const fileExists = options.existsSync ?? existsSync;
  const readText = options.readFileSync ?? readFileSync;
  const readStat = options.statSync ?? statSync;

  if (!fileExists(authPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readText(authPath, "utf8"));
    const tokens = parsed?.tokens;
    if (!tokens?.access_token || !tokens?.refresh_token) {
      return null;
    }

    const expiryMs =
      decodeJwtExpiryMs(tokens.access_token) ??
      readStat(authPath).mtimeMs + 60 * 60 * 1000;

    return {
      accountId: tokens.account_id ?? decodeJwtSubject(tokens.access_token) ?? "codex-cli",
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      email: decodeJwtEmail(tokens.id_token) ?? decodeJwtEmail(tokens.access_token) ?? undefined,
      expiresAt: new Date(expiryMs).toISOString(),
      invalid: false,
      source: "codex-cli",
    };
  } catch {
    return null;
  }
}

function readCodexCliCredentialFromKeychain(options: CodexCliSyncOptions) {
  const platform = options.platform ?? osPlatform();
  if (platform !== "darwin") {
    return null;
  }

  const runExec = options.execFileSync ?? execFileSync;
  const codexHome = options.codexHome ?? DEFAULT_CODEX_HOME;
  const account = `cli|${createHash("sha256").update(codexHome).digest("hex").slice(0, 16)}`;

  try {
    const raw = runExec(
      "security",
      [
        "find-generic-password",
        "-s",
        CODEX_AUTH_KEYCHAIN_SERVICE,
        "-a",
        account,
        "-w",
      ],
      {
        encoding: "utf8",
        timeout: 5000,
      },
    ).trim();
    const parsed = JSON.parse(raw);
    const tokens = parsed?.tokens;
    if (!tokens?.access_token || !tokens?.refresh_token) {
      return null;
    }

    const expiryMs =
      decodeJwtExpiryMs(tokens.access_token) ??
      Date.now() + 60 * 60 * 1000;

    return {
      accountId: tokens.account_id ?? decodeJwtSubject(tokens.access_token) ?? "codex-cli",
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      email: decodeJwtEmail(tokens.id_token) ?? decodeJwtEmail(tokens.access_token) ?? undefined,
      expiresAt: new Date(expiryMs).toISOString(),
      invalid: false,
      source: "codex-cli",
    };
  } catch {
    return null;
  }
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
