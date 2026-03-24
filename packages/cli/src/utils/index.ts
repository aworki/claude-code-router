import fs from "node:fs/promises";
import readline from "node:readline";
import JSON5 from "json5";
import path from "node:path";
import { createHash } from "node:crypto";
import os from "node:os";
import {
  CONFIG_FILE,
  HOME_DIR, PID_FILE,
  PLUGINS_DIR,
  PRESETS_DIR,
} from "@CCR/shared";
import { getServer } from "@CCR/server";
import { writeFileSync } from "fs";
import { checkForUpdates, performUpdate } from "./update";
import { version } from "../../package.json";
import { spawn } from "child_process";
import { getServiceInfo } from "./processCheck";
import { restartServiceWith } from "./restart";

// Function to interpolate environment variables in config values
const interpolateEnvVars = (obj: any): any => {
  if (typeof obj === "string") {
    // Replace $VAR_NAME or ${VAR_NAME} with environment variable values
    return obj.replace(/\$\{([^}]+)\}|\$([A-Z_][A-Z0-9_]*)/g, (match, braced, unbraced) => {
      const varName = braced || unbraced;
      return process.env[varName] || match; // Keep original if env var doesn't exist
    });
  } else if (Array.isArray(obj)) {
    return obj.map(interpolateEnvVars);
  } else if (obj !== null && typeof obj === "object") {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = interpolateEnvVars(value);
    }
    return result;
  }
  return obj;
};

const ensureDir = async (dir_path: string) => {
  try {
    await fs.access(dir_path);
  } catch {
    await fs.mkdir(dir_path, { recursive: true });
  }
};

export const initDir = async () => {
  await ensureDir(HOME_DIR);
  await ensureDir(PLUGINS_DIR);
  await ensureDir(PRESETS_DIR);
  await ensureDir(path.join(HOME_DIR, "logs"));
};

const createReadline = () => {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
};

const question = (query: string): Promise<string> => {
  return new Promise((resolve) => {
    const rl = createReadline();
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
};

const confirm = async (query: string): Promise<boolean> => {
  const answer = await question(query);
  return answer.toLowerCase() !== "n";
};

const normalizeLegacyCodexAuthConfig = (config: any): any => {
  if (!config || typeof config !== "object") {
    return config;
  }

  const normalizeProvider = (provider: any) => {
    if (!provider || typeof provider !== "object") {
      return provider;
    }

    const isLegacyCodexAuth =
      provider.auth_strategy === "openai-oauth" || provider.name === "openai-oauth";
    if (!isLegacyCodexAuth) {
      return provider;
    }

    const nextProvider = { ...provider };
    if (nextProvider.name === "openai-oauth") {
      nextProvider.name = "codex-auth";
    }
    if (nextProvider.auth_strategy === "openai-oauth") {
      nextProvider.auth_strategy = "codex-auth";
    }
    if (nextProvider.oauth && typeof nextProvider.oauth === "object") {
      const { redirect_uri: _redirectUri, ...restOAuth } = nextProvider.oauth;
      nextProvider.oauth = restOAuth;
    }
    return nextProvider;
  };

  const normalizeRoute = (route: unknown) =>
    typeof route === "string" ? route.replaceAll("openai-oauth,", "codex-auth,") : route;

  const nextConfig = { ...config };
  if (Array.isArray(nextConfig.Providers)) {
    nextConfig.Providers = nextConfig.Providers.map(normalizeProvider);
  }
  if (Array.isArray(nextConfig.providers)) {
    nextConfig.providers = nextConfig.providers.map(normalizeProvider);
  }
  if (nextConfig.Router && typeof nextConfig.Router === "object") {
    nextConfig.Router = Object.fromEntries(
      Object.entries(nextConfig.Router).map(([key, value]) => [key, normalizeRoute(value)]),
    );
  }
  return nextConfig;
};

export const readConfigFile = async () => {
  try {
    const config = await fs.readFile(CONFIG_FILE, "utf-8");
    try {
      // Try to parse with JSON5 first (which also supports standard JSON)
      const parsedConfig = JSON5.parse(config);
      // Interpolate environment variables in the parsed config
      return normalizeLegacyCodexAuthConfig(interpolateEnvVars(parsedConfig));
    } catch (parseError) {
      console.error(`Failed to parse config file at ${CONFIG_FILE}`);
      console.error("Error details:", (parseError as Error).message);
      console.error("Please check your config file syntax.");
      process.exit(1);
    }
  } catch (readError: any) {
    if (readError.code === "ENOENT") {
      // Config file doesn't exist, prompt user for initial setup
      try {
        // Initialize directories
        await initDir();

        // Backup existing config file if it exists
        const backupPath = await backupConfigFile();
        if (backupPath) {
          console.log(
              `Backed up existing configuration file to ${backupPath}`
          );
        }
        const config = {
          PORT: 3456,
          Providers: [],
          Router: {},
        }
        // Create a minimal default config file
        await writeConfigFile(config);
        console.log(
            "Created minimal default configuration file at ~/.claude-code-router/config.json"
        );
        console.log(
            "Please edit this file with your actual configuration."
        );
        return config
      } catch (error: any) {
        console.error(
            "Failed to create default configuration:",
            error.message
        );
        process.exit(1);
      }
    } else {
      console.error(`Failed to read config file at ${CONFIG_FILE}`);
      console.error("Error details:", readError.message);
      process.exit(1);
    }
  }
};

export const backupConfigFile = async () => {
  try {
    if (await fs.access(CONFIG_FILE).then(() => true).catch(() => false)) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = `${CONFIG_FILE}.${timestamp}.bak`;
      await fs.copyFile(CONFIG_FILE, backupPath);

      // Clean up old backups, keeping only the 3 most recent
      try {
        const configDir = path.dirname(CONFIG_FILE);
        const configFileName = path.basename(CONFIG_FILE);
        const files = await fs.readdir(configDir);

        // Find all backup files for this config
        const backupFiles = files
          .filter(file => file.startsWith(configFileName) && file.endsWith('.bak'))
          .sort()
          .reverse(); // Sort in descending order (newest first)

        // Delete all but the 3 most recent backups
        if (backupFiles.length > 3) {
          for (let i = 3; i < backupFiles.length; i++) {
            const oldBackupPath = path.join(configDir, backupFiles[i]);
            await fs.unlink(oldBackupPath);
          }
        }
      } catch (cleanupError) {
        console.warn("Failed to clean up old backups:", cleanupError);
      }

      return backupPath;
    }
  } catch (error) {
    console.error("Failed to backup config file:", error);
  }
  return null;
};

export const writeConfigFile = async (config: any) => {
  await ensureDir(HOME_DIR);
  const configWithComment = `${JSON.stringify(config, null, 2)}`;
  await fs.writeFile(CONFIG_FILE, configWithComment);
};

export const initConfig = async () => {
  const config = await readConfigFile();
  Object.assign(process.env, config);
  return config;
};

interface SyncCodexAuthDeps {
  getServiceInfo: typeof getServiceInfo;
  getServer: typeof getServer;
  log?: (message: string) => void;
}

export const syncCodexAuthWithRunningService = async (
  deps: SyncCodexAuthDeps = {
    getServiceInfo,
    getServer,
  },
) => {
  const serviceInfo = await deps.getServiceInfo();
  return serviceInfo;
};

export const run = async (args: string[] = []) => {
  const serviceInfo = await syncCodexAuthWithRunningService({
    getServiceInfo,
    getServer,
    log: (message) => console.warn(message),
  });
  if (serviceInfo.running) {
    console.log('claude-code-router server is running');
    return;
  }
  const server = await getServer();
  const app = server.app;
  // Save the PID of the background process
  writeFileSync(PID_FILE, process.pid.toString());

  app.post('/api/update/perform', async () => {
    return await performUpdate();
  })

  app.get('/api/update/check', async () => {
    return await checkForUpdates(version);
  })

  app.post("/api/restart", async () => {
    setTimeout(async () => {
      spawn("ccr", ["restart"], {
        detached: true,
        stdio: "ignore",
      }).unref();
    }, 100);

    return { success: true, message: "Service restart initiated" }
  });

  // await server.start() to ensure it starts successfully and keep process alive
  await server.start();
}

export const restartService = async () => restartServiceWith();


/**
 * Get a temporary path for the settings file
 * Hash the content and return the file path if it already exists in temp directory,
 * otherwise create a new file with the content
 * @param content Settings content string
 * @returns Full path to the temporary file
 */
export const getSettingsPath = async (content: string): Promise<string> => {
  // Hash the content using SHA256 algorithm
  const hash = createHash('sha256').update(content, 'utf-8').digest('hex');

  // Create claude-code-router directory in system temp folder
  const tempDir = path.join(os.tmpdir(), 'claude-code-router');
  const fileName = `ccr-settings-${hash}.json`;
  const tempFilePath = path.join(tempDir, fileName);

  // Ensure the directory exists
  try {
    await fs.access(tempDir);
  } catch {
    await fs.mkdir(tempDir, { recursive: true });
  }

  // Check if the file already exists
  try {
    await fs.access(tempFilePath);
    return tempFilePath;
  } catch {
    // File doesn't exist, create and write content
    await fs.writeFile(tempFilePath, content, 'utf-8');
    return tempFilePath;
  }
}
