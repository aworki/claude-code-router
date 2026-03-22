import assert from "node:assert/strict";
import test from "node:test";
import { restartServiceWith } from "./restart";

test("restartServiceWith kills the listening process when the pid file is missing", async () => {
  const killCalls: Array<{ pid: number; signal?: NodeJS.Signals | number }> = [];
  const spawnCalls: Array<{ command: string; args: string[] }> = [];
  const logs: string[] = [];
  let runningChecks = 0;
  let now = 0;

  await restartServiceWith({
    cliPath: "/tmp/cli.js",
    getServiceInfo: async () => ({
      running: runningChecks++ === 0,
      pid: null,
      port: 3456,
      endpoint: "http://127.0.0.1:3456",
      pidFile: "/tmp/ccr.pid",
      referenceCount: 0,
    }),
    getListeningPid: () => 4321,
    killProcess: (pid, signal) => {
      killCalls.push({ pid, signal });
    },
    spawnProcess: (command, args) => {
      spawnCalls.push({ command, args });
      return {
        on() {
          return this;
        },
        unref() {},
      } as any;
    },
    cleanupPidFile: () => {
      logs.push("cleanupPidFile");
    },
    referenceCountFile: "/tmp/refcount",
    referenceCountExists: () => true,
    unlinkReferenceCount: async () => {
      logs.push("unlinkReferenceCount");
    },
    sleep: async () => {
      now += 10;
    },
    now: () => now,
    log: (message) => {
      logs.push(message);
    },
  });

  assert.deepEqual(killCalls, [{ pid: 4321, signal: "SIGTERM" }]);
  assert.deepEqual(spawnCalls, [{ command: "node", args: ["/tmp/cli.js", "start"] }]);
  assert.ok(logs.includes("claude code router service has been stopped."));
  assert.ok(logs.includes("cleanupPidFile"));
  assert.ok(logs.includes("unlinkReferenceCount"));
});

test("restartServiceWith escalates to SIGKILL before starting the replacement process", async () => {
  const killCalls: Array<{ pid: number; signal?: NodeJS.Signals | number }> = [];
  const spawnCalls: Array<{ command: string; args: string[] }> = [];
  let runningChecks = 0;
  let now = 0;

  await restartServiceWith({
    cliPath: "/tmp/cli.js",
    stopTimeoutMs: 20,
    stopPollIntervalMs: 10,
    getServiceInfo: async () => {
      runningChecks += 1;
      return {
        running: runningChecks < 6,
        pid: 5555,
        port: 3456,
        endpoint: "http://127.0.0.1:3456",
        pidFile: "/tmp/ccr.pid",
        referenceCount: 0,
      };
    },
    getListeningPid: () => null,
    killProcess: (pid, signal) => {
      killCalls.push({ pid, signal });
    },
    spawnProcess: (command, args) => {
      spawnCalls.push({ command, args });
      return {
        on() {
          return this;
        },
        unref() {},
      } as any;
    },
    cleanupPidFile: () => {},
    referenceCountFile: "/tmp/refcount",
    referenceCountExists: () => false,
    unlinkReferenceCount: async () => {},
    sleep: async () => {
      now += 10;
    },
    now: () => now,
    log: () => {},
  });

  assert.deepEqual(killCalls, [
    { pid: 5555, signal: "SIGTERM" },
    { pid: 5555, signal: "SIGKILL" },
  ]);
  assert.deepEqual(spawnCalls, [{ command: "node", args: ["/tmp/cli.js", "start"] }]);
});
