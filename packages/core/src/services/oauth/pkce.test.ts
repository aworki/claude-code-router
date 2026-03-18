import assert from "node:assert/strict";
import test from "node:test";
import { createPkcePair } from "./pkce";

test("pkce pair uses S256-safe characters", () => {
  const pair = createPkcePair();
  assert.match(pair.codeVerifier, /^[A-Za-z0-9._~-]{43,128}$/);
  assert.match(pair.codeChallenge, /^[A-Za-z0-9_-]+$/);
});
