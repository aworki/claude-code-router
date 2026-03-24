# Codex Auth Without Vault Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove CCR vault reads from all auth-related flows so `codex-auth` reads directly from the local Codex account store and becomes the only runtime auth source.

**Architecture:** Introduce a single read-only `CodexAuthSource` that loads account metadata and tokens from `~/.codex/accounts/registry.json`, per-account `*.auth.json` files, and legacy `~/.codex/auth.json` fallback. Refactor runtime auth, `switch`, and `status` to consume this source directly. Then delete CCR vault-backed sync logic, vault-based auth reads, and related dead tests/docs while keeping `account_id` binding semantics unchanged.

**Tech Stack:** TypeScript, Node.js, pnpm workspaces, CLI + server monorepo, Node test runner via `tsx --test`

---

### Task 1: Add a Shared Codex Auth Source

**Files:**
- Create: `packages/core/src/services/oauth/codex-auth-source.ts`
- Create: `packages/core/src/services/oauth/codex-auth-source.test.ts`
- Modify: `packages/core/src/services/oauth/types.ts`

**Step 1: Write the failing tests**

Add tests for these cases in `packages/core/src/services/oauth/codex-auth-source.test.ts`:

```ts
test("listAccounts reads all accounts from registry.json", async () => {
  // fixture registry with 2 account keys and 2 auth files
  // expect both accounts with accountId/email/source/expiresAt
});

test("getActiveAccount prefers registry active_account_key", async () => {
  // fixture registry with active account key
  // expect returned account matches active key
});

test("getAccountById resolves a specific codex account", async () => {
  // fixture 2 accounts
  // expect exact accountId lookup to work
});

test("falls back to ~/.codex/auth.json when registry is missing", async () => {
  // fixture only auth.json
  // expect one fallback account
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec tsx --test packages/core/src/services/oauth/codex-auth-source.test.ts
```

Expected: FAIL because the source module does not exist yet.

**Step 3: Write minimal implementation**

Implement `packages/core/src/services/oauth/codex-auth-source.ts` with:

- `listCodexAuthAccounts(options?)`
- `getActiveCodexAuthAccount(options?)`
- `getCodexAuthAccountById(accountId, options?)`
- shared JWT decode helpers for `email`, `exp`, and fallback timestamps

Define a shared account type in `packages/core/src/services/oauth/types.ts`, for example:

```ts
export interface CodexAuthAccount {
  accountId: string;
  email?: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  source: "codex-cli";
  invalid: boolean;
}
```

Keep the module read-only. Do not write to vault, keychain, or Codex files.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm exec tsx --test packages/core/src/services/oauth/codex-auth-source.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/services/oauth/codex-auth-source.ts packages/core/src/services/oauth/codex-auth-source.test.ts packages/core/src/services/oauth/types.ts
git commit -m "refactor: add read-only codex auth source"
```

### Task 2: Refactor Runtime Auth To Read Codex Directly

**Files:**
- Modify: `packages/core/src/services/oauth/service.ts`
- Modify: `packages/core/src/services/oauth/service.test.ts` or replace with new focused tests if reintroduced
- Modify: `packages/core/src/server.ts`
- Modify: `packages/core/src/api/routes.ts`

**Step 1: Write the failing tests**

Add tests covering:

```ts
test("buildRequestAuth uses the active codex account when account_id is empty", async () => {
  // source returns active account
  // expect Authorization and chatgpt-account-id headers
});

test("buildRequestAuth uses the requested codex account when account_id is set", async () => {
  // source resolves target account
});

test("buildRequestAuth throws reauth_required when no codex account exists", async () => {
  // source returns null/[]
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec tsx --test packages/core/src/services/oauth/service.test.ts
```

Expected: FAIL until `OAuthService` no longer depends on `TokenVault`.

**Step 3: Write minimal implementation**

Refactor `packages/core/src/services/oauth/service.ts` so:

- constructor depends on a Codex auth reader abstraction instead of `TokenVault`
- `syncExternalCredentials()` is removed entirely
- `buildRequestAuth()` resolves:
  - explicit `account_id`, else
  - active Codex account, else
  - `reauth_required`
- token refresh and vault invalidation paths are removed

Update `packages/core/src/server.ts`:

- stop constructing `createTokenVault(...)`
- wire `OAuthService` to the new `CodexAuthSource`
- remove startup sync logic and follow-up mutations that existed only because of vault sync state

Update `packages/core/src/api/routes.ts` only if route handling or provider normalization still references removed auth behaviors.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm exec tsx --test packages/core/src/services/oauth/service.test.ts packages/core/src/server.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/services/oauth/service.ts packages/core/src/server.ts packages/core/src/api/routes.ts packages/core/src/services/oauth/service.test.ts packages/core/src/server.test.ts
git commit -m "refactor: read codex auth directly at runtime"
```

### Task 3: Move CLI Status And Switch Off Vault Reads

**Files:**
- Modify: `packages/cli/src/utils/switch.ts`
- Modify: `packages/cli/src/utils/switch.test.ts`
- Modify: `packages/cli/src/utils/status.ts`
- Modify: `packages/cli/src/utils/index.ts`

**Step 1: Write the failing tests**

Add or update tests so they assert:

```ts
test("loadLocalOAuthAccounts reads only codex registry and auth files", async () => {
  // no vault fixture
  // expect accounts from registry
});

test("switch choices de-duplicate by account_id and render codex accounts only", async () => {
  // codex fixture only
});

test("status prints codex accounts without reading ~/.claude-code-router/oauth", async () => {
  // inject reader dependency or mock helper
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec tsx --test packages/cli/src/utils/switch.test.ts packages/cli/src/utils/index.test.ts
```

Expected: FAIL until vault-dependent paths are removed.

**Step 3: Write minimal implementation**

Refactor CLI auth helpers:

- remove vault decryption and `installation-secret` reads from `packages/cli/src/utils/switch.ts`
- make `loadLocalOAuthAccounts()` a thin wrapper around `CodexAuthSource`
- keep `account_id` binding and `codex-account:` selection format
- update `packages/cli/src/utils/status.ts` to show only Codex accounts
- simplify `packages/cli/src/utils/index.ts` so `ccr start` no longer performs vault sync; it may still refresh config normalization if needed

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm exec tsx --test packages/cli/src/utils/switch.test.ts packages/cli/src/utils/index.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/cli/src/utils/switch.ts packages/cli/src/utils/switch.test.ts packages/cli/src/utils/status.ts packages/cli/src/utils/index.ts packages/cli/src/utils/index.test.ts
git commit -m "refactor: move cli codex auth flows off vault"
```

### Task 4: Delete Vault-Based Auth Implementation

**Files:**
- Delete: `packages/core/src/services/oauth/token-vault.ts`
- Delete: `packages/core/src/services/oauth/token-vault.test.ts`
- Delete: any now-unused keychain helper code under `packages/core/src/services/oauth/`
- Modify: `packages/core/src/services/oauth/types.ts`
- Modify: `packages/core/src/services/oauth/openai-client.ts`
- Modify: `packages/core/src/services/oauth/openai-client.test.ts`

**Step 1: Write the failing tests**

Before deletion, add or update tests so the build fails if anything still imports `TokenVault`:

```ts
test("openai client auth refresh path is no longer used by codex-auth runtime", () => {
  assert.ok(true);
});
```

This is mainly a safety checkpoint: after deleting vault code, the TypeScript build should identify stale imports.

**Step 2: Run test/build to verify it fails**

Run:

```bash
pnpm build:server
```

Expected: FAIL if any source still imports `TokenVault` or `createTokenVault`.

**Step 3: Write minimal implementation**

Remove vault-only code:

- delete `token-vault.ts` and its tests
- remove `TokenVault`, `TokenVaultKeychain`, and `StoredTokenRecord` types if no longer needed
- slim `openai-client.ts` down to only what still matters, or delete it if runtime refresh is fully gone
- remove any leftover invalidation, save, list, remove logic that only existed for CCR-local persistence

Do not delete Codex auth file-reading helpers added in Task 1.

**Step 4: Run build to verify it passes**

Run:

```bash
pnpm build:server
pnpm build:cli
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/services/oauth/types.ts packages/core/src/services/oauth/openai-client.ts packages/core/src/services/oauth/openai-client.test.ts
git rm packages/core/src/services/oauth/token-vault.ts packages/core/src/services/oauth/token-vault.test.ts
git commit -m "refactor: remove ccr auth vault implementation"
```

### Task 5: Preserve Config Compatibility While Removing Vault Semantics

**Files:**
- Modify: `packages/core/src/services/oauth/config.ts`
- Modify: `packages/core/src/services/oauth/config.test.ts`
- Modify: `packages/cli/src/utils/index.ts`
- Modify: `packages/ui/config.example.json`

**Step 1: Write the failing tests**

Add tests for:

```ts
test("legacy openai-oauth config is normalized to codex-auth", () => {
  // keep previous compatibility behavior
});

test("codex-auth config no longer includes vault-only fields", () => {
  // no redirect_uri, no oauth callback assumptions
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec tsx --test packages/core/src/services/oauth/config.test.ts
```

Expected: FAIL if normalization still assumes vault sync or refresh metadata.

**Step 3: Write minimal implementation**

Ensure config normalization:

- still migrates legacy `openai-oauth` names to `codex-auth`
- keeps `account_id` support
- drops all vault semantics from examples and defaults
- updates CLI config normalization to treat Codex files as the only auth source

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm exec tsx --test packages/core/src/services/oauth/config.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/services/oauth/config.ts packages/core/src/services/oauth/config.test.ts packages/cli/src/utils/index.ts packages/ui/config.example.json
git commit -m "chore: remove vault semantics from codex auth config"
```

### Task 6: Update Docs And Verification Matrix

**Files:**
- Modify: `README.md`
- Modify: `README_zh.md`
- Modify: `docs/docs/server/config/providers.md`
- Modify: `docs/docs/cli/commands/status.md`
- Modify: `docs/docs/cli/commands/other.md`

**Step 1: Write the failing doc checklist**

Create a quick checklist in the PR or notes:

- no docs mention `~/.claude-code-router/oauth` as an auth source
- no docs mention CCR-managed token vault for `codex-auth`
- docs clearly say Codex local account store is the only auth source

**Step 2: Run search to verify stale docs remain**

Run:

```bash
rg -n "vault|installation-secret|~/.claude-code-router/oauth|token vault" README.md README_zh.md docs
```

Expected: FIND stale mentions before edits.

**Step 3: Write the documentation changes**

Update docs to say:

- `codex-auth` reads from local Codex account files
- CCR does not maintain its own auth vault anymore
- if Codex account changes, rerun `ccr start` or `ccr switch`
- `account_id` binds to a Codex account id, otherwise CCR follows the active Codex account

**Step 4: Run doc search to verify cleanup**

Run:

```bash
rg -n "vault|installation-secret|~/.claude-code-router/oauth|token vault" README.md README_zh.md docs
```

Expected: no auth-related vault mentions remain.

**Step 5: Commit**

```bash
git add README.md README_zh.md docs/docs/server/config/providers.md docs/docs/cli/commands/status.md docs/docs/cli/commands/other.md
git commit -m "docs: describe codex auth as the only auth source"
```

### Task 7: Final Verification

**Files:**
- Verify only, no intended edits

**Step 1: Run targeted tests**

Run:

```bash
pnpm exec tsx --test \
  packages/core/src/services/oauth/codex-auth-source.test.ts \
  packages/core/src/services/oauth/config.test.ts \
  packages/core/src/services/oauth/service.test.ts \
  packages/cli/src/utils/index.test.ts \
  packages/cli/src/utils/switch.test.ts \
  packages/core/src/server.test.ts \
  packages/core/src/transformer/openai.codex.responses.transformer.test.ts
```

Expected: PASS.

**Step 2: Run builds**

Run:

```bash
pnpm build:server
pnpm build:cli
pnpm build:ui
```

Expected: PASS.

**Step 3: Run manual smoke checks**

Run:

```bash
ccr start
ccr status
ccr switch
```

Expected:

- `status` shows only Codex accounts from local Codex files
- `switch` shows only Codex accounts plus normal providers
- deleting `~/.claude-code-router/oauth` does not break auth

**Step 4: Record migration notes**

Summarize:

- old CCR vault directory is no longer read
- legacy configs are still normalized to `codex-auth`
- active Codex account tracking remains intact

**Step 5: Commit**

```bash
git add .
git commit -m "refactor: remove vault reads from codex auth flows"
```
