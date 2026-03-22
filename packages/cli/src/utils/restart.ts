import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "child_process";
import { existsSync } from "fs";
import { REFERENCE_COUNT_FILE } from "@CCR/shared";
import { cleanupPidFile, getServiceInfo } from "./processCheck";

export interface RestartServiceDeps {
  cliPath: string;
  stopTimeoutMs: number;
  stopPollIntervalMs: number;
  getServiceInfo: typeof getServiceInfo;
  getListeningPid: (port: number) => number | null;
  killProcess: (pid: number, signal?: NodeJS.Signals | number) => void;
  spawnProcess: typeof spawn;
  cleanupPidFile: typeof cleanupPidFile;
  referenceCountFile: string;
  referenceCountExists: (path: string) => boolean;
  unlinkReferenceCount: (path: string) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  log: (message: string) => void;
}

const DEFAULT_STOP_TIMEOUT_MS = 5_000;
const DEFAULT_STOP_POLL_INTERVAL_MS = 100;

export async function restartServiceWith(
  overrides: Partial<RestartServiceDeps> = {},
) {
  const deps: RestartServiceDeps = {
    cliPath: path.join(__dirname, "cli.js"),
    stopTimeoutMs: DEFAULT_STOP_TIMEOUT_MS,
    stopPollIntervalMs: DEFAULT_STOP_POLL_INTERVAL_MS,
    getServiceInfo,
    getListeningPid: getListeningPidForPort,
    killProcess: (pid, signal) => process.kill(pid, signal),
    spawnProcess: spawn,
    cleanupPidFile,
    referenceCountFile: REFERENCE_COUNT_FILE,
    referenceCountExists: existsSync,
    unlinkReferenceCount: (filePath) => fs.unlink(filePath),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    log: (message) => console.log(message),
    ...overrides,
  };

  const serviceInfo = await deps.getServiceInfo();
  if (serviceInfo.running) {
    const pid = serviceInfo.pid ?? deps.getListeningPid(serviceInfo.port);
    if (!pid) {
      throw new Error(
        `Service is running on port ${serviceInfo.port}, but CCR could not determine which process to stop.`,
      );
    }

    deps.killProcess(pid, "SIGTERM");
    let stopped = await waitForServiceToStop(deps);
    if (!stopped) {
      deps.killProcess(pid, "SIGKILL");
      stopped = await waitForServiceToStop(deps);
    }

    if (!stopped) {
      throw new Error(`Timed out waiting for service process ${pid} to stop.`);
    }

    deps.cleanupPidFile();
    if (deps.referenceCountExists(deps.referenceCountFile)) {
      try {
        await deps.unlinkReferenceCount(deps.referenceCountFile);
      } catch {
        // Ignore cleanup errors.
      }
    }
    deps.log("claude code router service has been stopped.");
  } else {
    deps.log("Service was not running or failed to stop.");
    deps.cleanupPidFile();
  }

  deps.log("Starting claude code router service...");
  const startProcess = deps.spawnProcess("node", [deps.cliPath, "start"], {
    detached: true,
    stdio: "ignore",
  });

  startProcess.on("error", (error) => {
    throw error;
  });

  startProcess.unref();
  deps.log("✅ Service started successfully in the background.");
}

async function waitForServiceToStop(deps: RestartServiceDeps) {
  const deadline = deps.now() + deps.stopTimeoutMs;
  while (deps.now() <= deadline) {
    const serviceInfo = await deps.getServiceInfo();
    if (!serviceInfo.running) {
      return true;
    }
    await deps.sleep(deps.stopPollIntervalMs);
  }

  return false;
}

function getListeningPidForPort(port: number): number | null {
  if (process.platform === "win32") {
    return null;
  }

  try {
    const { execFileSync } = require("child_process") as typeof import("child_process");
    const output = execFileSync(
      "lsof",
      ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"],
      { encoding: "utf8", stdio: "pipe" },
    ) as string;
    const pid = parseInt(output.trim().split("\n")[0] ?? "", 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}
