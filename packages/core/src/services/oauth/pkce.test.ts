import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createPkcePair } from "./pkce";

test("pkce pair derives the challenge from the verifier", () => {
  const pair = createPkcePair();
  assert.match(pair.codeVerifier, /^[A-Za-z0-9._~-]{43,128}$/);
  assert.match(pair.codeChallenge, /^[A-Za-z0-9_-]+$/);
  assert.equal(
    pair.codeChallenge,
    createHash("sha256").update(pair.codeVerifier).digest("base64url"),
  );
  assert.equal(pair.method, "S256");
});
