import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  captureOAuthLoginSession,
  extractOAuthStateCookie,
  formatOAuthAccounts,
  getOAuthLoginUrl,
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
      expiresAt: "2026-03-19T00:00:00.000Z",
      invalid: false,
      reauthRequired: false,
    },
  ]);

  assert.match(output, /OAuth Accounts/);
  assert.match(output, /e77b122d95cf/);
  assert.match(output, /ac\.\.\.89/);
  assert.match(output, /p\.\.\.n@e\.\.\.e\.com/);
  assert.doesNotMatch(output, /acct_123456789/);
  assert.doesNotMatch(output, /person@example\.com/);
});

test("oauth login path targets the local server route", () => {
  assert.equal(
    getOAuthLoginUrl("http://127.0.0.1:3456"),
    "http://127.0.0.1:3456/oauth/login",
  );
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
              return "https://auth.openai.com/oauth/authorize?state=state-1";
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
      "https://auth.openai.com/oauth/authorize?state=state-1",
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
        json: async () => ({ success: true }),
      } as any;
    };

    const response = await postOAuthComplete(
      "http://127.0.0.1:3456",
      "http://127.0.0.1:3456/oauth/callback?code=code-1&state=state-1",
      { rootDir },
    );

    assert.deepEqual(response, { success: true });
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
