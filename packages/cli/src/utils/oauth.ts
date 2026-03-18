import { mkdir, readFile, writeFile } from "node:fs/promises";
import { exec } from "node:child_process";
import path from "node:path";
import { HOME_DIR } from "@CCR/shared";

const OAUTH_STATE_COOKIE = "ccr_oauth_state";
const OAUTH_DIR = path.join(HOME_DIR, "oauth");

export interface OAuthAccountStatus {
  accountKey: string;
  accountHint: string;
  emailHint?: string;
  expiresAt: string;
  invalid: boolean;
  reauthRequired: boolean;
}

export interface OAuthStatusResponse {
  accounts: OAuthAccountStatus[];
}

export interface OAuthStorageOptions {
  rootDir?: string;
}

export function getOAuthLoginUrl(baseUrl: string) {
  return new URL("/oauth/login", baseUrl).toString();
}

export function getOAuthCompleteUrl(baseUrl: string) {
  return new URL("/oauth/complete", baseUrl).toString();
}

export function getOAuthStatusUrl(baseUrl: string) {
  return new URL("/api/oauth/status", baseUrl).toString();
}

function getOAuthLoginCookiePath(options?: OAuthStorageOptions) {
  return path.join(options?.rootDir ?? OAUTH_DIR, "login-cookie");
}

export function extractOAuthStateCookie(setCookieHeader?: string | string[] | null) {
  const headers = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : setCookieHeader
      ? [setCookieHeader]
      : [];

  for (const header of headers) {
    const cookie = header.split(";")[0]?.trim();
    if (cookie?.startsWith(`${OAUTH_STATE_COOKIE}=`)) {
      return cookie;
    }
  }

  return null;
}

export async function storeOAuthLoginCookie(cookieValue: string, options?: OAuthStorageOptions) {
  const cookiePath = getOAuthLoginCookiePath(options);
  await mkdir(path.dirname(cookiePath), { recursive: true });
  await writeFile(cookiePath, cookieValue, { mode: 0o600 });
}

export async function loadOAuthLoginCookie(options?: OAuthStorageOptions) {
  const cookiePath = getOAuthLoginCookiePath(options);
  try {
    const cookie = await readFile(cookiePath, "utf-8");
    return cookie.trim() || null;
  } catch {
    return null;
  }
}

export async function captureOAuthLoginSession(
  baseUrl: string,
  options?: OAuthStorageOptions,
) {
  const response = await fetch(getOAuthLoginUrl(baseUrl), {
    redirect: "manual",
  });

  if (response.status < 300 || response.status >= 400) {
    throw new Error(`OAuth login failed (${response.status})`);
  }

  const authorizationUrl = response.headers.get("location");
  if (!authorizationUrl) {
    throw new Error("OAuth login response did not include an authorization URL");
  }

  const cookie = extractOAuthStateCookie(response.headers.get("set-cookie"));
  if (!cookie) {
    throw new Error("OAuth login response did not include a signed state cookie");
  }

  await storeOAuthLoginCookie(cookie, options);
  return authorizationUrl;
}

export async function fetchOAuthStatus(baseUrl: string): Promise<OAuthStatusResponse> {
  const response = await fetch(getOAuthStatusUrl(baseUrl));
  if (!response.ok) {
    throw new Error(`Failed to load OAuth status (${response.status})`);
  }

  return (await response.json()) as OAuthStatusResponse;
}

export async function postOAuthComplete(
  baseUrl: string,
  callbackUrl: string,
  options?: OAuthStorageOptions,
) {
  const cookie = await loadOAuthLoginCookie(options);
  if (!cookie) {
    throw new Error("No stored OAuth login cookie found. Run `ccr oauth login` first.");
  }

  const response = await fetch(getOAuthCompleteUrl(baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ callbackUrl }),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      typeof payload?.error === "string" ? payload.error : `OAuth completion failed (${response.status})`,
    );
  }

  return payload;
}

export function formatOAuthAccounts(accounts: OAuthAccountStatus[]) {
  if (!accounts.length) {
    return "";
  }

  const lines = [
    "OAuth Accounts",
    "═".repeat("OAuth Accounts".length),
  ];

  for (const account of accounts) {
    lines.push(`- accountKey: ${account.accountKey}`);
    lines.push(`  accountHint: ${account.accountHint}`);
    if (account.emailHint) {
      lines.push(`  emailHint: ${account.emailHint}`);
    }
    lines.push(`  expiresAt: ${account.expiresAt}`);
    lines.push(`  invalid: ${account.invalid ? "yes" : "no"}`);
    lines.push(`  reauthRequired: ${account.reauthRequired ? "yes" : "no"}`);
  }

  return lines.join("\n");
}

export function openExternalUrl(url: string) {
  const escapedUrl = url.replace(/"/g, '\\"');
  let command = "";

  if (process.platform === "darwin") {
    command = `open "${escapedUrl}"`;
  } else if (process.platform === "win32") {
    command = `start "" "${escapedUrl}"`;
  } else {
    command = `xdg-open "${escapedUrl}"`;
  }

  return new Promise<void>((resolve, reject) => {
    exec(command, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
