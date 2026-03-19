import assert from "node:assert/strict";
import test from "node:test";
import { isPortListening, isServiceReachable } from "./processCheck";

test("isServiceReachable returns true for a healthy endpoint", async () => {
  const result = await isServiceReachable("http://127.0.0.1:3456", async () => ({
    ok: true,
  }) as Response);

  assert.equal(result, true);
});

test("isServiceReachable returns false when the endpoint probe fails", async () => {
  const result = await isServiceReachable("http://127.0.0.1:3456", async () => {
    throw new Error("connect failed");
  });

  assert.equal(result, false);
});

test("isPortListening returns true when lsof reports a listener on the port", () => {
  const result = isPortListening(1455, () => "node 123 user 17u IPv4 0x0 0t0 TCP 127.0.0.1:1455 (LISTEN)\n");

  assert.equal(result, true);
});

test("isPortListening returns false when lsof fails", () => {
  const result = isPortListening(1455, () => {
    throw new Error("lsof failed");
  });

  assert.equal(result, false);
});
