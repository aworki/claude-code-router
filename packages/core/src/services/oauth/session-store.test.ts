import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryOAuthSessionStore } from "./session-store";

test("session store consumes state exactly once", () => {
  const store = new InMemoryOAuthSessionStore();
  store.issue("state-1", { codeVerifier: "verifier", redirectUri: "http://localhost:1455/oauth/callback" });

  assert.deepStrictEqual(store.consume("state-1"), {
    codeVerifier: "verifier",
    redirectUri: "http://localhost:1455/oauth/callback",
  });
  assert.equal(store.consume("state-1"), undefined);
});

test("session store expires and prunes stale sessions", () => {
  let now = 1_000;
  const store = new InMemoryOAuthSessionStore({
    ttlMs: 100,
    now: () => now,
  });

  store.issue("state-1", { codeVerifier: "old", redirectUri: "http://localhost:1455/oauth/callback" });
  now = 1_101;
  store.issue("state-2", { codeVerifier: "fresh", redirectUri: "http://localhost:1455/oauth/callback" });

  assert.equal(store.consume("state-1"), undefined);
  assert.deepStrictEqual(store.consume("state-2"), {
    codeVerifier: "fresh",
    redirectUri: "http://localhost:1455/oauth/callback",
  });
});
