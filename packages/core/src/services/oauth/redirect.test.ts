import assert from "node:assert/strict";
import test from "node:test";
import { assertAllowedLoopbackRedirect } from "./redirect";

test("rejects non-loopback redirect without allowlist", () => {
  assert.throws(
    () => assertAllowedLoopbackRedirect("http://example.com/oauth/callback"),
    /loopback/i,
  );
});
