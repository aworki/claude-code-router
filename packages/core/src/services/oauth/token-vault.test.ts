import assert from "node:assert/strict";
import { constants } from "node:fs";
import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileTokenVault } from "./token-vault";
import type { StoredTokenRecord, TokenVaultKeychain } from "./types";

test("vault round-trips a token bundle without exposing plaintext on disk", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "ccr-oauth-test-"));
  const vault = new FileTokenVault({
    rootDir,
    passphrase: "test-passphrase",
  });

  try {
    await vault.save({
      accountId: "user-1234",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: "2026-03-19T12:00:00Z",
    });

    const bundle = await vault.get("user-1234");
    assert.equal(bundle?.refreshToken, "refresh-token");

    const [entry] = await readdir(rootDir);
    assert.match(entry ?? "", /^[a-f0-9]{64}\.json$/);

    const disk = await readFile(join(rootDir, entry!), "utf8");
    assert.ok(!disk.includes("access-token"));
    assert.ok(!disk.includes("refresh-token"));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("vault hashes account ids so traversal input cannot escape root", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "ccr-oauth-test-"));
  const rootDir = join(baseDir, "vault");
  const vault = new FileTokenVault({
    rootDir,
    passphrase: "test-passphrase",
  });

  try {
    await vault.save({
      accountId: "../escape",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: "2026-03-19T12:00:00Z",
    });

    const bundle = await vault.get("../escape");
    assert.equal(bundle?.accountId, "../escape");

    const entries = await readdir(rootDir);
    assert.equal(entries.length, 1);
    assert.match(entries[0] ?? "", /^[a-f0-9]{64}\.json$/);
    await assert.rejects(
      access(join(baseDir, "escape.json"), constants.F_OK),
      /ENOENT/,
    );
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("vault falls back to the encrypted file when a newer save misses keychain", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "ccr-oauth-test-"));
  let now = Date.parse("2026-03-19T12:00:00.000Z");
  let saves = 0;
  let keychainRecord: StoredTokenRecord | null = null;

  const keychain: TokenVaultKeychain = {
    async save(record) {
      saves += 1;
      if (saves === 2) {
        throw new Error("keychain unavailable");
      }
      keychainRecord = record;
    },
    async get() {
      return keychainRecord;
    },
    async list() {
      return keychainRecord ? [keychainRecord] : [];
    },
  };

  const vault = new FileTokenVault({
    rootDir,
    passphrase: "test-passphrase",
    keychain,
    now: () => now,
  });

  try {
    await vault.save({
      accountId: "user-1234",
      accessToken: "old-access-token",
      refreshToken: "old-refresh-token",
      expiresAt: "2026-03-19T13:00:00Z",
    });

    now += 1_000;

    await vault.save({
      accountId: "user-1234",
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token",
      expiresAt: "2026-03-19T14:00:00Z",
    });

    const bundle = await vault.get("user-1234");
    assert.equal(bundle?.accessToken, "new-access-token");
    assert.equal(bundle?.refreshToken, "new-refresh-token");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
