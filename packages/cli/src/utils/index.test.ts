import assert from "node:assert/strict";
import test from "node:test";
import { syncCodexAuthWithRunningService } from "./index";

test("syncCodexAuthWithRunningService does not touch oauth state when the service is already running", async () => {
  let getServerCalls = 0;

  const serviceInfo = await syncCodexAuthWithRunningService({
    getServiceInfo: async () => ({
      running: true,
      pid: 1234,
      port: 3456,
      endpoint: "http://127.0.0.1:3456",
      pidFile: "/tmp/ccr.pid",
      referenceCount: 0,
    }),
    getServer: async () => {
      getServerCalls += 1;
      return {} as any;
    },
  });

  assert.equal(serviceInfo.running, true);
  assert.equal(getServerCalls, 0);
});

test("syncCodexAuthWithRunningService skips sync when the service is not running", async () => {
  let getServerCalls = 0;

  const serviceInfo = await syncCodexAuthWithRunningService({
    getServiceInfo: async () => ({
      running: false,
      pid: null,
      port: 3456,
      endpoint: "http://127.0.0.1:3456",
      pidFile: "/tmp/ccr.pid",
      referenceCount: 0,
    }),
    getServer: async () => {
      getServerCalls += 1;
      return {} as any;
    },
  });

  assert.equal(serviceInfo.running, false);
  assert.equal(getServerCalls, 0);
});
