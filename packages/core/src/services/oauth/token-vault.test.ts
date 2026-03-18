import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileTokenVault } from "./token-vault";

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

    const disk = await readFile(join(rootDir, "user-1234.json"), "utf8");
    assert.ok(!disk.includes("access-token"));
    assert.ok(!disk.includes("refresh-token"));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
