import assert from "node:assert/strict";
import test from "node:test";
import { assertAllowedLoopbackRedirect } from "./redirect";

test("rejects non-loopback redirect without allowlist", () => {
  assert.throws(
    () => assertAllowedLoopbackRedirect("http://example.com/oauth/callback"),
    /loopback/i,
  );
});

test("accepts a valid loopback redirect", () => {
  assert.doesNotThrow(() => assertAllowedLoopbackRedirect("http://localhost:1455/oauth/callback"));
});

test("accepts bracketed IPv6 loopback redirect", () => {
  assert.doesNotThrow(() => assertAllowedLoopbackRedirect("http://[::1]:1455/oauth/callback"));
});

test("rejects invalid redirect scheme", () => {
  assert.throws(
    () => assertAllowedLoopbackRedirect("file:///oauth/callback"),
    /http/i,
  );
});

test("accepts allowlisted non-loopback redirect", () => {
  assert.doesNotThrow(() =>
    assertAllowedLoopbackRedirect("https://example.com/oauth/callback", ["example.com"]),
  );
});
