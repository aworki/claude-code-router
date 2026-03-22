import { ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

interface ChildProcessLike {
  pid?: number;
  kill(signal?: NodeJS.Signals | number): boolean;
  once(event: string, listener: (...args: any[]) => void): any;
  on(event: string, listener: (...args: any[]) => void): any;
}

export interface SearchSidecarManagerOptions {
  port?: number;
  startupTimeoutMs?: number;
  startupPollIntervalMs?: number;
  healthCheck?: () => Promise<boolean>;
  spawnProcess?: () => ChildProcessLike;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class SearchSidecarManager {
  private static cleanupRegistered = false;
  private readonly port: number;
  private readonly startupTimeoutMs: number;
  private readonly startupPollIntervalMs: number;
  private readonly healthCheckFn?: () => Promise<boolean>;
  private readonly spawnProcessFn?: () => ChildProcessLike;
  private child?: ChildProcessLike;
  private startPromise?: Promise<void>;

  constructor(options: SearchSidecarManagerOptions = {}) {
    this.port = options.port || Number(process.env.SEARCH_SIDECAR_PORT || 3460);
    this.startupTimeoutMs = options.startupTimeoutMs ?? 10_000;
    this.startupPollIntervalMs = options.startupPollIntervalMs ?? 150;
    this.healthCheckFn = options.healthCheck;
    this.spawnProcessFn = options.spawnProcess;

    if (!this.spawnProcessFn && !SearchSidecarManager.cleanupRegistered) {
      SearchSidecarManager.cleanupRegistered = true;
      process.once("exit", () => {
        this.stop();
      });
      process.once("SIGINT", () => {
        this.stop();
      });
      process.once("SIGTERM", () => {
        this.stop();
      });
    }
  }

  getBaseUrl() {
    return `http://127.0.0.1:${this.port}`;
  }

  async ensureStarted(): Promise<void> {
    if (await this.isHealthy()) {
      return;
    }

    if (!this.startPromise) {
      this.startPromise = this.start();
    }

    try {
      await this.startPromise;
    } finally {
      this.startPromise = undefined;
    }
  }

  stop() {
    if (this.child) {
      this.child.kill("SIGTERM");
      this.child = undefined;
    }
  }

  private async isHealthy(): Promise<boolean> {
    if (this.healthCheckFn) {
      return this.healthCheckFn();
    }

    try {
      const response = await fetch(`${this.getBaseUrl()}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }

  private startSpawnedProcess(): ChildProcessLike {
    if (this.spawnProcessFn) {
      return this.spawnProcessFn();
    }

    const compiledEntrypoint = path.join(__dirname, "search-sidecar.js");
    const sourceEntrypoint = path.join(__dirname, "..", "search-sidecar.ts");
    const serverWorkdir = path.join(__dirname, "..", "..");

    if (existsSync(compiledEntrypoint)) {
      return spawn(process.execPath, [compiledEntrypoint], {
        cwd: serverWorkdir,
        env: process.env,
        stdio: "ignore",
      });
    }

    return spawn(
      process.execPath,
      ["-r", "ts-node/register/transpile-only", sourceEntrypoint],
      {
        cwd: serverWorkdir,
        env: process.env,
        stdio: "ignore",
      },
    );
  }

  private async start(): Promise<void> {
    const child = this.startSpawnedProcess();
    this.child = child;

    let exited = false;
    let exitError: Error | undefined;
    child.once("exit", (code, signal) => {
      exited = true;
      this.child = undefined;
      exitError = new Error(
        `Search sidecar exited before becoming healthy (code=${code}, signal=${signal})`,
      );
    });

    const deadline = Date.now() + this.startupTimeoutMs;
    while (Date.now() < deadline) {
      if (exited) {
        throw exitError;
      }
      if (await this.isHealthy()) {
        return;
      }
      await sleep(this.startupPollIntervalMs);
    }

    this.stop();
    throw new Error("Timed out waiting for the search sidecar to become healthy");
  }
}

export const searchSidecarManager = new SearchSidecarManager();
