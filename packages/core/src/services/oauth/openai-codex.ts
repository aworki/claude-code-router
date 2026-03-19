import { arch, platform, release } from "node:os";

export const OPENAI_CODEX_BASE_URL = "https://chatgpt.com/backend-api";
export const OPENAI_AUTH_JWT_CLAIM_PATH = "https://api.openai.com/auth";

export function isOpenAIPublicApiBaseUrl(baseUrl?: string) {
  if (!baseUrl || !baseUrl.trim()) {
    return false;
  }

  return /^https?:\/\/api\.openai\.com(?:\/v1(?:\/(?:chat\/completions|responses))?)?\/?$/i.test(
    baseUrl.trim(),
  );
}

export function normalizeOpenAICodexBaseUrl(baseUrl?: string) {
  const trimmed = baseUrl?.trim();
  if (!trimmed || isOpenAIPublicApiBaseUrl(trimmed)) {
    return OPENAI_CODEX_BASE_URL;
  }

  return trimmed.replace(/\/+$/, "");
}

export function resolveOpenAICodexResponsesUrl(baseUrl?: string) {
  const normalizedBaseUrl = normalizeOpenAICodexBaseUrl(baseUrl);
  if (normalizedBaseUrl.endsWith("/codex/responses")) {
    return new URL(normalizedBaseUrl);
  }
  if (normalizedBaseUrl.endsWith("/codex")) {
    return new URL(`${normalizedBaseUrl}/responses`);
  }
  return new URL(`${normalizedBaseUrl}/codex/responses`);
}

export function extractChatGPTAccountIdFromToken(accessToken: string) {
  try {
    const [, payload] = accessToken.split(".");
    if (!payload) {
      return null;
    }
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const accountId = parsed?.[OPENAI_AUTH_JWT_CLAIM_PATH]?.chatgpt_account_id;
    return typeof accountId === "string" && accountId.length > 0 ? accountId : null;
  } catch {
    return null;
  }
}

export function buildOpenAICodexUserAgent() {
  return `pi (${platform()} ${release()}; ${arch()})`;
}
