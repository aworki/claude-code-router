import http from "node:http";
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
  source?: "oauth" | "codex-cli";
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

export interface OAuthCompleteResponse {
  success?: boolean;
  accountId?: string;
  email?: string;
  expiresAt?: string;
}

export interface OAuthCallbackWaitOptions {
  timeoutMs?: number;
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

export function getOAuthRedirectUriFromAuthorizationUrl(authorizationUrl: string) {
  return new URL(authorizationUrl).searchParams.get("redirect_uri");
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
    throw new Error(await formatOAuthError(response, `OAuth login failed (${response.status})`));
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
    throw new Error(await formatOAuthError(response, `Failed to load OAuth status (${response.status})`));
  }

  return (await response.json()) as OAuthStatusResponse;
}

export async function postOAuthComplete(
  baseUrl: string,
  callbackUrl: string,
  options?: OAuthStorageOptions,
): Promise<OAuthCompleteResponse> {
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

  return payload as OAuthCompleteResponse;
}

async function formatOAuthError(response: Response, fallbackMessage: string) {
  const payload = await readOAuthErrorJson(response);
  if (typeof payload?.error === "string" && payload.error.trim()) {
    return payload.error;
  }

  const text = await readOAuthErrorText(response);
  if (text.trim()) {
    return text.trim();
  }

  return fallbackMessage;
}

async function readOAuthErrorJson(response: Response) {
  const clone = typeof response.clone === "function" ? response.clone() : response;
  return clone.json().catch(() => null);
}

async function readOAuthErrorText(response: Response) {
  const clone = typeof response.clone === "function" ? response.clone() : response;
  return clone.text().catch(() => "");
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
    if (account.source) {
      lines.push(`  source: ${account.source}`);
    }
    lines.push(`  expiresAt: ${account.expiresAt}`);
    lines.push(`  invalid: ${account.invalid ? "yes" : "no"}`);
    lines.push(`  reauthRequired: ${account.reauthRequired ? "yes" : "no"}`);
  }

  return lines.join("\n");
}

export function bindOAuthProviderAccount(config: any, accountId: string) {
  const nextConfig = structuredClone(config);
  const providers = nextConfig.Providers || nextConfig.providers || [];

  for (const provider of providers) {
    if (provider?.auth_strategy === "openai-oauth") {
      provider.account_id = accountId;
      break;
    }
  }

  return nextConfig;
}

export function getOAuthLoginGuidance() {
  return [
    "Authorize in your browser, then copy the callback URL from the address bar.",
    'Finish the flow with: `ccr oauth complete "<callback-url>"`',
  ].join("\n");
}

export function getOAuthCallbackListenerMessage(redirectUri: string) {
  return `Waiting for OAuth callback on ${redirectUri}`;
}

export async function waitForOAuthCallback(
  redirectUri: string,
  options: OAuthCallbackWaitOptions = {},
) {
  const redirectUrl = new URL(redirectUri);
  const timeoutMs = options.timeoutMs ?? 180_000;

  return await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const requestUrl = new URL(req.url ?? "/", redirectUrl);
      if (requestUrl.pathname !== redirectUrl.pathname) {
        res.statusCode = 404;
        res.setHeader("content-type", "text/plain; charset=utf-8");
        res.end("Not found");
        return;
      }

      const callbackUrl = new URL(redirectUri);
      callbackUrl.search = requestUrl.search;

      res.statusCode = 200;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(renderOAuthCallbackPage("Authentication received. Finishing authorization in Claude Code Router..."));
      cleanup();
      resolve(callbackUrl.toString());
    });

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for OAuth callback on ${redirectUri}`));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      server.close(() => {});
    };

    server.once("error", (error) => {
      cleanup();
      reject(error);
    });

    server.listen(Number(redirectUrl.port), redirectUrl.hostname);
  });
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

function renderOAuthCallbackPage(message: string) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>OAuth Callback</title>
  </head>
  <body>
    <p>${message}</p>
  </body>
</html>`;
}
