import assert from "node:assert/strict";
import test from "node:test";
import { SearchSidecarManager } from "./sidecar-manager";

test("SearchSidecarManager spawns the sidecar when health checks fail", async () => {
  let healthChecks = 0;
  let spawned = 0;

  const manager = new SearchSidecarManager({
    port: 3460,
    healthCheck: async () => {
      healthChecks += 1;
      return healthChecks > 1;
    },
    spawnProcess: () => {
      spawned += 1;
      return {
        pid: 123,
        kill() {
          return true;
        },
        once() {},
        on() {},
      } as any;
    },
    startupTimeoutMs: 50,
    startupPollIntervalMs: 1,
  });

  await manager.ensureStarted();

  assert.equal(spawned, 1);
  assert.equal(manager.getBaseUrl(), "http://127.0.0.1:3460");
});
