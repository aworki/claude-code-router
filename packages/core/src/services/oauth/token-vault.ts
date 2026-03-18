import argon2 from "argon2";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  StoredTokenBundle,
  StoredTokenRecord,
  TokenVault,
  TokenVaultKeychain,
} from "./types";

const DEFAULT_ROOT_DIR = join(homedir(), ".claude-code-router", "oauth");
const DEFAULT_KEYCHAIN_SERVICE = "claude-code-router.oauth";
const KEY_LENGTH = 32;
const IV_LENGTH = 12;

let systemKeychainPromise: Promise<TokenVaultKeychain | null> | undefined;

interface EncryptedVaultRecord {
  version: 1;
  algorithm: "aes-256-gcm";
  kdf: "argon2id";
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

interface KeytarModule {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  findCredentials(service: string): Promise<Array<{ account: string; password: string }>>;
}

export interface FileTokenVaultOptions {
  rootDir?: string;
  passphrase: string;
  keychain?: TokenVaultKeychain | null;
  now?: () => number;
}

export function createTokenVault(options: FileTokenVaultOptions): TokenVault {
  return new FileTokenVault(options);
}

export class FileTokenVault implements TokenVault {
  private readonly rootDir: string;
  private readonly passphrase: string;
  private readonly now: () => number;
  private readonly keychain: Promise<TokenVaultKeychain | null>;

  constructor(options: FileTokenVaultOptions) {
    this.rootDir = options.rootDir ?? DEFAULT_ROOT_DIR;
    this.passphrase = options.passphrase;
    this.now = options.now ?? Date.now;
    this.keychain =
      options.keychain === undefined
        ? getSystemKeychain()
        : Promise.resolve(options.keychain);
  }

  async save(bundle: StoredTokenBundle): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });

    const record = createStoredTokenRecord(bundle, this.now);
    const keychain = await this.keychain;
    let keychainError: unknown = undefined;
    let keychainSaved = false;

    if (keychain) {
      try {
        await keychain.save(record);
        keychainSaved = true;
      } catch (error) {
        keychainError = error;
      }
    }

    try {
      await this.writeFileRecord(bundle.accountId, record);
    } catch (fileError) {
      if (!keychainSaved) {
        if (keychainError) {
          throw new AggregateError(
            [keychainError, fileError],
            "Failed to save token bundle",
          );
        }
        throw fileError;
      }
    }
  }

  async get(accountId: string): Promise<StoredTokenBundle | null> {
    const record = await this.getRecord(accountId);
    return record?.bundle ?? null;
  }

  async list(): Promise<StoredTokenBundle[]> {
    await mkdir(this.rootDir, { recursive: true });

    const [fileRecords, keychainRecords] = await Promise.all([
      this.readFileRecords(),
      this.readKeychainRecords(),
    ]);

    const merged = new Map<string, StoredTokenRecord>();
    for (const record of [...fileRecords, ...keychainRecords]) {
      const current = merged.get(record.bundle.accountId);
      if (!current || compareRecords(record, current) >= 0) {
        merged.set(record.bundle.accountId, record);
      }
    }

    return Array.from(merged.values()).map((record) => record.bundle);
  }

  async markInvalid(accountId: string, refreshToken: string): Promise<boolean> {
    const record = await this.getRecord(accountId);
    if (!record || record.bundle.refreshToken !== refreshToken) {
      return false;
    }

    await this.save({
      ...record.bundle,
      invalid: true,
    });
    return true;
  }

  private async getRecord(accountId: string): Promise<StoredTokenRecord | null> {
    const [fileRecord, keychainRecord] = await Promise.all([
      this.readFileRecord(accountId),
      this.readKeychainRecord(accountId),
    ]);
    return chooseNewestRecord(fileRecord, keychainRecord);
  }

  private async writeFileRecord(accountId: string, record: StoredTokenRecord): Promise<void> {
    const encrypted = await encryptRecord(record, this.passphrase);
    const destination = this.pathFor(accountId);
    const temporaryPath = `${destination}.${randomBytes(6).toString("hex")}.tmp`;

    await writeFile(temporaryPath, JSON.stringify(encrypted), { mode: 0o600 });
    await rename(temporaryPath, destination);
  }

  private async readFileRecord(accountId: string): Promise<StoredTokenRecord | null> {
    try {
      const raw = await readFile(this.pathFor(accountId), "utf8");
      const encrypted = JSON.parse(raw) as EncryptedVaultRecord;
      return decryptRecord(encrypted, this.passphrase);
    } catch (error) {
      if (isMissingFileError(error)) {
        return null;
      }
      throw error;
    }
  }

  private async readFileRecords(): Promise<StoredTokenRecord[]> {
    const entries = await readdir(this.rootDir, { withFileTypes: true });
    const records = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => this.readFileRecordByName(entry.name)),
    );
    return records.filter((record): record is StoredTokenRecord => record !== null);
  }

  private async readFileRecordByName(fileName: string): Promise<StoredTokenRecord | null> {
    try {
      const raw = await readFile(join(this.rootDir, fileName), "utf8");
      const encrypted = JSON.parse(raw) as EncryptedVaultRecord;
      return decryptRecord(encrypted, this.passphrase);
    } catch (error) {
      if (isMissingFileError(error)) {
        return null;
      }
      throw error;
    }
  }

  private async readKeychainRecord(accountId: string): Promise<StoredTokenRecord | null> {
    const keychain = await this.keychain;
    if (!keychain) {
      return null;
    }

    try {
      return await keychain.get(accountId);
    } catch {
      return null;
    }
  }

  private async readKeychainRecords(): Promise<StoredTokenRecord[]> {
    const keychain = await this.keychain;
    if (!keychain?.list) {
      return [];
    }

    try {
      return (await keychain.list()).filter(isStoredTokenRecord);
    } catch {
      return [];
    }
  }

  private pathFor(accountId: string) {
    return join(this.rootDir, `${hashAccountId(accountId)}.json`);
  }
}

function createStoredTokenRecord(
  bundle: StoredTokenBundle,
  now: () => number,
): StoredTokenRecord {
  return {
    bundle,
    savedAt: new Date(now()).toISOString(),
  };
}

async function encryptRecord(
  record: StoredTokenRecord,
  passphrase: string,
): Promise<EncryptedVaultRecord> {
  const salt = randomBytes(16);
  const iv = randomBytes(IV_LENGTH);
  const key = await deriveKey(passphrase, salt);

  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(record), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    version: 1,
    algorithm: "aes-256-gcm",
    kdf: "argon2id",
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

async function decryptRecord(
  record: EncryptedVaultRecord,
  passphrase: string,
): Promise<StoredTokenRecord> {
  if (record.version !== 1 || record.algorithm !== "aes-256-gcm" || record.kdf !== "argon2id") {
    throw new Error("Unsupported token vault record format");
  }

  const salt = Buffer.from(record.salt, "base64");
  const iv = Buffer.from(record.iv, "base64");
  const tag = Buffer.from(record.tag, "base64");
  const ciphertext = Buffer.from(record.ciphertext, "base64");
  const key = await deriveKey(passphrase, salt);

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const parsed = JSON.parse(plaintext.toString("utf8"));
  if (!isStoredTokenRecord(parsed)) {
    throw new Error("Invalid token vault record payload");
  }
  return parsed;
}

async function deriveKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  return (await argon2.hash(passphrase, {
    type: argon2.argon2id,
    salt,
    hashLength: KEY_LENGTH,
    raw: true,
  })) as Buffer;
}

function hashAccountId(accountId: string) {
  return createHash("sha256").update(accountId).digest("hex");
}

function chooseNewestRecord(
  fileRecord: StoredTokenRecord | null,
  keychainRecord: StoredTokenRecord | null,
) {
  if (!fileRecord) return keychainRecord;
  if (!keychainRecord) return fileRecord;
  return compareRecords(keychainRecord, fileRecord) >= 0 ? keychainRecord : fileRecord;
}

function compareRecords(left: StoredTokenRecord, right: StoredTokenRecord) {
  return parseSavedAt(left.savedAt) - parseSavedAt(right.savedAt);
}

function parseSavedAt(savedAt: string) {
  const timestamp = Date.parse(savedAt);
  return Number.isFinite(timestamp) ? timestamp : -Infinity;
}

async function getSystemKeychain(): Promise<TokenVaultKeychain | null> {
  systemKeychainPromise ??= createSystemKeychain();
  return systemKeychainPromise;
}

async function createSystemKeychain(): Promise<TokenVaultKeychain | null> {
  try {
    const imported = await import("keytar");
    const keytar = normalizeKeytar(imported);
    if (!keytar) {
      return null;
    }

    return {
      async save(record) {
        await keytar.setPassword(
          DEFAULT_KEYCHAIN_SERVICE,
          hashAccountId(record.bundle.accountId),
          JSON.stringify(record),
        );
      },
      async get(accountId) {
        const stored = await keytar.getPassword(
          DEFAULT_KEYCHAIN_SERVICE,
          hashAccountId(accountId),
        );
        if (!stored) {
          return null;
        }

        const parsed = JSON.parse(stored);
        return isStoredTokenRecord(parsed) ? parsed : null;
      },
      async list() {
        const credentials = await keytar.findCredentials(DEFAULT_KEYCHAIN_SERVICE);
        return credentials
          .map(({ password }) => {
            try {
              const parsed = JSON.parse(password);
              return isStoredTokenRecord(parsed) ? parsed : null;
            } catch {
              return null;
            }
          })
          .filter((record): record is StoredTokenRecord => record !== null);
      },
    };
  } catch {
    return null;
  }
}

function normalizeKeytar(imported: unknown): KeytarModule | null {
  const candidate =
    imported &&
    typeof imported === "object" &&
    "default" in imported &&
    imported.default
      ? imported.default
      : imported;

  if (
    candidate &&
    typeof candidate === "object" &&
    "getPassword" in candidate &&
    "setPassword" in candidate &&
    "findCredentials" in candidate
  ) {
    return candidate as KeytarModule;
  }

  return null;
}

function isStoredTokenRecord(value: unknown): value is StoredTokenRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<StoredTokenRecord>;
  return Boolean(
    record.bundle &&
      typeof record.savedAt === "string" &&
      typeof record.bundle.accountId === "string" &&
      typeof record.bundle.accessToken === "string" &&
      typeof record.bundle.refreshToken === "string" &&
      typeof record.bundle.expiresAt === "string",
  );
}

function isMissingFileError(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT",
  );
}
