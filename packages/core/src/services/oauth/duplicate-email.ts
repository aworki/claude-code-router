import type { StoredTokenBundle, TokenVault } from "./types";

export async function assertNoDuplicateEmail(
  vault: TokenVault,
  incoming: Pick<StoredTokenBundle, "accountId" | "email" | "source">,
): Promise<void> {
  const normalizedIncomingEmail = normalizeEmail(incoming.email);
  if (!normalizedIncomingEmail) {
    return;
  }

  const existingBundles = await vault.list();
  for (const bundle of existingBundles) {
    if (bundle.accountId === incoming.accountId) {
      continue;
    }

    if (normalizeEmail(bundle.email) !== normalizedIncomingEmail) {
      continue;
    }

    const source = bundle.source ?? "unknown";
    throw new Error(
      `OAuth account import stopped: email '${normalizedIncomingEmail}' already exists on ${source} account '${bundle.accountId}'.`,
    );
  }
}

function normalizeEmail(email: string | undefined) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}
