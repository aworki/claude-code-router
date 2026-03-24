import { select } from "@inquirer/prompts";
import { createHash } from "node:crypto";
import { listCodexAuthAccounts } from "../../../core/src/services/oauth/codex-auth-source";
import { readConfigFile, writeConfigFile } from "./index";

interface ProviderConfig {
  name: string;
  auth_strategy?: string;
  account_id?: string;
  models?: string[];
  [key: string]: any;
}

interface RouterConfig {
  default?: string;
  [key: string]: any;
}

interface Config {
  Providers?: ProviderConfig[];
  providers?: ProviderConfig[];
  Router?: RouterConfig;
  [key: string]: any;
}

export interface LocalOAuthAccount {
  accountId: string;
  email?: string;
  source?: "codex-cli";
  expiresAt: string;
  invalid: boolean;
  reauthRequired: boolean;
  accountKey: string;
  accountHint: string;
  emailHint?: string;
}

export type SwitchSelection =
  | {
      kind: "provider";
      providerName: string;
    }
  | {
      kind: "codex-account";
      providerName: string;
      accountId: string;
    };

export interface SwitchChoice {
  name: string;
  value: string;
  description?: string;
}

const DEFAULT_OAUTH_PROVIDER_NAME = "codex-auth";
const DEFAULT_OAUTH_MODEL = "gpt-5.4";

export function buildSwitchChoices(config: Config, accounts: LocalOAuthAccount[]): SwitchChoice[] {
  const providers = getProviders(withSynthesizedOAuthProvider(config, accounts));
  const current = getCurrentRoute(config);

  return providers.flatMap((provider) => {
    if (provider.auth_strategy === "codex-auth") {
      return accounts.map((account) => {
        const label = account.email || account.emailHint || account.accountId;
        const isCurrent =
          current?.providerName === provider.name && provider.account_id === account.accountId;

        return {
          name: `${provider.name} -> ${label} [${account.source ?? "codex-cli"}]${isCurrent ? " (current)" : ""}`,
          value: `codex-account:${provider.name}:${account.accountId}`,
          description: account.accountId,
        };
      });
    }

    const isCurrent = current?.providerName === provider.name;
    const model = provider.models?.[0];

    return [
      {
        name: `${provider.name}${model ? ` -> ${model}` : ""}${isCurrent ? " (current)" : ""}`,
        value: `provider:${provider.name}`,
        description: model,
      },
    ];
  });
}

export function resolveSwitchTarget(
  config: Config,
  accounts: LocalOAuthAccount[],
  target: string,
): SwitchSelection | null {
  const normalizedTarget = target.trim().toLowerCase();
  if (!normalizedTarget) {
    return null;
  }

  const effectiveConfig = withSynthesizedOAuthProvider(config, accounts);

  for (const provider of getProviders(effectiveConfig)) {
    if (provider.name.toLowerCase() === normalizedTarget) {
      return {
        kind: "provider",
        providerName: provider.name,
      };
    }
  }

  const oauthProvider = getProviders(effectiveConfig).find((provider) => provider.auth_strategy === "codex-auth");
  if (!oauthProvider) {
    return null;
  }

  for (const account of accounts) {
    const candidates = [
      account.accountId,
      account.email,
      account.accountKey,
      account.emailHint,
      account.accountHint,
    ]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.toLowerCase());

    if (candidates.includes(normalizedTarget)) {
      return {
        kind: "codex-account",
        providerName: oauthProvider.name,
        accountId: account.accountId,
      };
    }
  }

  return null;
}

export function applySwitchSelection(config: Config, selection: SwitchSelection): Config {
  const updated = structuredClone(config);
  if (
    selection.kind === "codex-account" &&
    !getProviders(updated).some((provider) => provider.auth_strategy === "codex-auth")
  ) {
    const nextProviders = getProviders(updated);
    nextProviders.push({
      name: selection.providerName,
      auth_strategy: "codex-auth",
      api_key: "",
      api_base_url: "https://chatgpt.com/backend-api",
      account_id: "",
      models: [DEFAULT_OAUTH_MODEL],
    });

    if (Array.isArray(updated.Providers)) {
      updated.Providers = nextProviders;
    } else {
      updated.providers = nextProviders;
    }
  }
  const providers = getProviders(updated);

  if (!updated.Router) {
    updated.Router = {};
  }

  const provider = providers.find((entry) => entry.name === selection.providerName);
  if (!provider) {
    throw new Error(`Provider not found: ${selection.providerName}`);
  }

  const model = provider.models?.[0];
  if (!model) {
    throw new Error(`Provider ${provider.name} has no configured models`);
  }

  if (selection.kind === "codex-account") {
    provider.account_id = selection.accountId;
  }

  updated.Router.default = `${provider.name},${model}`;
  return updated;
}

export async function loadLocalOAuthAccounts(
  options: { codexHome?: string } = {},
): Promise<LocalOAuthAccount[]> {
  const accounts = await listCodexAuthAccounts({
    codexHome: options.codexHome,
  });

  return accounts.map(toLocalOAuthAccount).sort((left, right) => {
    const leftLabel = `${left.source ?? ""}:${left.email ?? left.accountId}`;
    const rightLabel = `${right.source ?? ""}:${right.email ?? right.accountId}`;
    return leftLabel.localeCompare(rightLabel);
  });
}

export async function runSwitchCommand(target?: string) {
  const config = (await readConfigFile()) as Config;
  const accounts = await loadLocalOAuthAccounts();
  const choices = buildSwitchChoices(config, accounts);

  if (!choices.length) {
    throw new Error("No switchable providers or Codex accounts found in config.");
  }

  const selection =
    target && target.trim()
      ? resolveSwitchTarget(config, accounts, target)
      : parseSelectionValue(
          await select({
            message: "Select the provider or account to switch to:",
            choices,
            pageSize: 12,
          }),
        );

  if (!selection) {
    throw new Error(`No provider or account matched: ${target}`);
  }

  const updated = applySwitchSelection(config, selection);
  await writeConfigFile(updated);

  return {
    selection,
    config: updated,
  };
}

function parseSelectionValue(value: string): SwitchSelection {
  if (value.startsWith("provider:")) {
    return {
      kind: "provider",
      providerName: value.slice("provider:".length),
    };
  }

  if (value.startsWith("codex-account:")) {
    const [, providerName, accountId] = value.split(":");
    return {
      kind: "codex-account",
      providerName,
      accountId,
    };
  }

  throw new Error(`Unsupported switch selection: ${value}`);
}

function getProviders(config: Config): ProviderConfig[] {
  const providers = config.Providers ?? config.providers ?? [];
  return Array.isArray(providers) ? providers : [];
}

function withSynthesizedOAuthProvider(config: Config, accounts: LocalOAuthAccount[]): Config {
  const providers = getProviders(config);
  const hasOAuthProvider = providers.some((provider) => provider.auth_strategy === "codex-auth");
  if (hasOAuthProvider || accounts.length === 0) {
    return config;
  }

  const route = config.Router?.default;
  const shouldAddProvider =
    !route || route.startsWith(`${DEFAULT_OAUTH_PROVIDER_NAME},`);
  if (!shouldAddProvider) {
    return config;
  }

  const nextConfig = structuredClone(config);
  const nextProviders = getProviders(nextConfig);
  nextProviders.push({
    name: DEFAULT_OAUTH_PROVIDER_NAME,
    auth_strategy: "codex-auth",
    api_key: "",
    api_base_url: "https://chatgpt.com/backend-api",
    account_id: "",
    models: [DEFAULT_OAUTH_MODEL],
  });

  if (Array.isArray(nextConfig.Providers)) {
    nextConfig.Providers = nextProviders;
  } else {
    nextConfig.providers = nextProviders;
  }

  return nextConfig;
}

function getCurrentRoute(config: Config) {
  const route = config.Router?.default;
  if (!route || typeof route !== "string") {
    return null;
  }

  const [providerName, modelName] = route.split(",");
  return providerName ? { providerName, modelName } : null;
}

function toLocalOAuthAccount(bundle: {
  accountId: string;
  email?: string;
  source: "codex-cli";
  expiresAt: string;
  invalid: boolean;
}): LocalOAuthAccount {
  return {
    accountId: bundle.accountId,
    email: bundle.email,
    source: bundle.source,
    expiresAt: bundle.expiresAt,
    invalid: Boolean(bundle.invalid),
    reauthRequired: Boolean(bundle.invalid) || isExpired(bundle.expiresAt),
    accountKey: createHash("sha256").update(bundle.accountId).digest("hex").slice(0, 12),
    accountHint: redactAccountId(bundle.accountId),
    emailHint: bundle.email ? redactEmail(bundle.email) : undefined,
  };
}

function redactAccountId(accountId: string) {
  if (accountId.length <= 4) {
    return `${accountId[0] ?? ""}...${accountId.at(-1) ?? ""}`;
  }

  return `${accountId.slice(0, 2)}...${accountId.slice(-2)}`;
}

function redactEmail(email: string) {
  const [localPart = "", domain = ""] = email.split("@");
  const [domainName = "", tld = ""] = domain.split(".");
  return `${redactSegment(localPart)}@${redactSegment(domainName)}${tld ? `.${tld}` : ""}`;
}

function redactSegment(value: string) {
  if (value.length <= 2) {
    return `${value[0] ?? ""}...${value.at(-1) ?? ""}`;
  }

  return `${value[0]}...${value.at(-1)}`;
}

function isExpired(expiresAt: string) {
  const expiresAtMs = Date.parse(expiresAt);
  return Number.isFinite(expiresAtMs) ? expiresAtMs <= Date.now() : false;
}
