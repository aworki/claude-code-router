import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  bindOAuthProviderAccount,
  captureOAuthLoginSession,
  extractOAuthStateCookie,
  formatOAuthAccounts,
  getOAuthLoginUrl,
  getOAuthLoginGuidance,
  loadOAuthLoginCookie,
  postOAuthComplete,
  storeOAuthLoginCookie,
} from "./oauth";

test("status formatter renders redacted oauth account metadata", () => {
  const output = formatOAuthAccounts([
    {
      accountKey: "e77b122d95cf",
      accountHint: "ac...89",
      emailHint: "p...n@e...e.com",
      source: "codex-cli",
      expiresAt: "2026-03-19T00:00:00.000Z",
      invalid: false,
      reauthRequired: false,
    },
  ]);

  assert.match(output, /OAuth Accounts/);
  assert.match(output, /e77b122d95cf/);
  assert.match(output, /ac\.\.\.89/);
  assert.match(output, /p\.\.\.n@e\.\.\.e\.com/);
  assert.match(output, /source: codex-cli/);
  assert.doesNotMatch(output, /acct_123456789/);
  assert.doesNotMatch(output, /person@example\.com/);
});

test("oauth login path targets the local server route", () => {
  assert.equal(
    getOAuthLoginUrl("http://127.0.0.1:3456"),
    "http://127.0.0.1:3456/oauth/login",
  );
});

test("oauth login guidance tells the user to complete manually", () => {
  const guidance = getOAuthLoginGuidance();

  assert.match(guidance, /copy the callback URL/i);
  assert.match(guidance, /ccr oauth complete/i);
});

test("captures and persists the signed oauth login cookie", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "ccr-oauth-"));
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async () =>
      ({
        ok: false,
        status: 302,
        headers: {
          get(header: string) {
            if (header === "location") {
              return "https://auth.openai.com/api/accounts/authorize?state=state-1";
            }

            if (header === "set-cookie") {
              return "ccr_oauth_state=signed-cookie; Path=/; HttpOnly; SameSite=Lax";
            }

            return null;
          },
        },
      }) as any;

    const authorizationUrl = await captureOAuthLoginSession("http://127.0.0.1:3456", {
      rootDir,
    });

    assert.equal(
      authorizationUrl,
      "https://auth.openai.com/api/accounts/authorize?state=state-1",
    );
    assert.equal(
      await loadOAuthLoginCookie({ rootDir }),
      "ccr_oauth_state=signed-cookie",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("post oauth complete reuses the stored login cookie", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "ccr-oauth-"));
  const originalFetch = globalThis.fetch;
  await storeOAuthLoginCookie("ccr_oauth_state=signed-cookie", { rootDir });

  try {
    globalThis.fetch = async (_url, init) => {
      assert.equal(init?.method, "POST");
      assert.equal((init?.headers as Record<string, string>).Cookie, "ccr_oauth_state=signed-cookie");
      assert.equal(
        init?.body,
        JSON.stringify({ callbackUrl: "http://127.0.0.1:3456/oauth/callback?code=code-1&state=state-1" }),
      );

      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, accountId: "acct_123" }),
      } as any;
    };

    const response = await postOAuthComplete(
      "http://127.0.0.1:3456",
      "http://127.0.0.1:3456/oauth/callback?code=code-1&state=state-1",
      { rootDir },
    );

    assert.deepEqual(response, { success: true, accountId: "acct_123" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("binds the authorized account id back onto the openai-oauth provider config", () => {
  const updated = bindOAuthProviderAccount(
    {
      PORT: 1455,
      Providers: [
        {
          name: "openai-oauth",
          auth_strategy: "openai-oauth",
          account_id: "",
        },
      ],
    },
    "windowslive|ccda259a13fff370",
  );

  assert.equal(
    updated.Providers[0].account_id,
    "windowslive|ccda259a13fff370",
  );
});

test("oauth login surfaces the server error payload when capture fails", async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async () =>
      ({
        ok: false,
        status: 400,
        headers: {
          get() {
            return null;
          },
        },
        json: async () => ({
          error: "OpenAI OAuth provider is not configured",
        }),
        text: async () => "OpenAI OAuth provider is not configured",
      }) as any;

    await assert.rejects(
      captureOAuthLoginSession("http://127.0.0.1:3456"),
      /OpenAI OAuth provider is not configured/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("extracts the signed oauth state cookie from set-cookie headers", () => {
  assert.equal(
    extractOAuthStateCookie("ccr_oauth_state=signed-cookie; Path=/; HttpOnly"),
    "ccr_oauth_state=signed-cookie",
  );
});
