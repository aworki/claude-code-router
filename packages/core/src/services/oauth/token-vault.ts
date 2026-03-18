import argon2 from "argon2";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { StoredTokenBundle, TokenVault, TokenVaultKeychain } from "./types";

const DEFAULT_ROOT_DIR = join(homedir(), ".claude-code-router", "oauth");
const KEY_LENGTH = 32;
const IV_LENGTH = 12;

interface EncryptedVaultRecord {
  version: 1;
  algorithm: "aes-256-gcm";
  kdf: "argon2id";
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

export interface FileTokenVaultOptions {
  rootDir?: string;
  passphrase: string;
  keychain?: TokenVaultKeychain | null;
}

export function createTokenVault(options: FileTokenVaultOptions): TokenVault {
  return new FileTokenVault(options);
}

export class FileTokenVault implements TokenVault {
  private readonly rootDir: string;
  private readonly passphrase: string;
  private readonly keychain: TokenVaultKeychain | null;

  constructor(options: FileTokenVaultOptions) {
    this.rootDir = options.rootDir ?? DEFAULT_ROOT_DIR;
    this.passphrase = options.passphrase;
    this.keychain = options.keychain ?? null;
  }

  async save(bundle: StoredTokenBundle): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });

    const record = await encryptBundle(bundle, this.passphrase);
    const destination = this.pathFor(bundle.accountId);
    const temporaryPath = `${destination}.${randomBytes(6).toString("hex")}.tmp`;

    await writeFile(temporaryPath, JSON.stringify(record), { mode: 0o600 });
    await rename(temporaryPath, destination);

    if (this.keychain) {
      try {
        await this.keychain.save(bundle);
      } catch {
        // Encrypted disk storage remains the durable fallback when keychain access fails.
      }
    }
  }

  async get(accountId: string): Promise<StoredTokenBundle | null> {
    if (this.keychain) {
      try {
        const keychainBundle = await this.keychain.get(accountId);
        if (keychainBundle) {
          return keychainBundle;
        }
      } catch {
        // Fall back to the encrypted file when keychain access is unavailable.
      }
    }

    try {
      const raw = await readFile(this.pathFor(accountId), "utf8");
      const record = JSON.parse(raw) as EncryptedVaultRecord;
      return decryptBundle(record, this.passphrase);
    } catch (error) {
      if (isMissingFileError(error)) {
        return null;
      }
      throw error;
    }
  }

  async list(): Promise<StoredTokenBundle[]> {
    await mkdir(this.rootDir, { recursive: true });
    const entries = await readdir(this.rootDir, { withFileTypes: true });
    const bundles = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => this.get(entry.name.slice(0, -".json".length))),
    );
    return bundles.filter((bundle): bundle is StoredTokenBundle => bundle !== null);
  }

  async markInvalid(accountId: string): Promise<void> {
    const bundle = await this.get(accountId);
    if (!bundle) {
      return;
    }

    await this.save({
      ...bundle,
      invalid: true,
    });
  }

  private pathFor(accountId: string) {
    return join(this.rootDir, `${accountId}.json`);
  }
}

async function encryptBundle(
  bundle: StoredTokenBundle,
  passphrase: string,
): Promise<EncryptedVaultRecord> {
  const salt = randomBytes(16);
  const iv = randomBytes(IV_LENGTH);
  const key = await deriveKey(passphrase, salt);

  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(bundle), "utf8"),
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

async function decryptBundle(
  record: EncryptedVaultRecord,
  passphrase: string,
): Promise<StoredTokenBundle> {
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
  return JSON.parse(plaintext.toString("utf8")) as StoredTokenBundle;
}

async function deriveKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  return (await argon2.hash(passphrase, {
    type: argon2.argon2id,
    salt,
    hashLength: KEY_LENGTH,
    raw: true,
  })) as Buffer;
}

function isMissingFileError(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT",
  );
}
