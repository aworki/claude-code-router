import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryOAuthSessionStore } from "./session-store";

test("session store consumes state exactly once", () => {
  const store = new InMemoryOAuthSessionStore();
  store.issue("state-1", { codeVerifier: "verifier", redirectUri: "http://localhost:1455/oauth/callback" });

  assert.ok(store.consume("state-1"));
  assert.equal(store.consume("state-1"), undefined);
});
