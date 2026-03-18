import assert from "node:assert/strict";
import { constants } from "node:fs";
import { access, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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

test("vault reads a valid keychain record when the fallback file is corrupt", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "ccr-oauth-test-"));
  const keychainRecord: StoredTokenRecord = {
    bundle: {
      accountId: "user-1234",
      accessToken: "keychain-access-token",
      refreshToken: "keychain-refresh-token",
      expiresAt: "2026-03-19T14:00:00Z",
    },
    savedAt: "2026-03-19T12:00:00.000Z",
    writeOrder: 1,
  };

  const keychain: TokenVaultKeychain = {
    async save() {},
    async get() {
      return keychainRecord;
    },
    async list() {
      return [keychainRecord];
    },
  };

  const vault = new FileTokenVault({
    rootDir,
    passphrase: "test-passphrase",
    keychain,
  });

  try {
    await writeFile(
      join(rootDir, "e6073eb3928f3de3536af8b80c7e945215fb9aec71f8216d8a4c67e5c09cb94b.json"),
      "{not-valid-json",
      "utf8",
    );

    const bundle = await vault.get("user-1234");
    assert.equal(bundle?.accessToken, "keychain-access-token");

    const listed = await vault.list();
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.refreshToken, "keychain-refresh-token");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("same-millisecond writes still prefer the newer fallback file over stale keychain data", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "ccr-oauth-test-"));
  const fixedNow = Date.parse("2026-03-19T12:00:00.000Z");
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
    now: () => fixedNow,
  });

  try {
    await vault.save({
      accountId: "user-1234",
      accessToken: "old-access-token",
      refreshToken: "old-refresh-token",
      expiresAt: "2026-03-19T13:00:00Z",
    });

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
