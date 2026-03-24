import { getServiceInfo } from "./processCheck";
import { loadLocalOAuthAccounts } from "./switch";

export async function showStatus() {
  const info = await getServiceInfo();
  let oauthAccounts = "";

  try {
    const accounts = await loadLocalOAuthAccounts();
    oauthAccounts = formatCodexAccounts(accounts);
  } catch {
    oauthAccounts = "";
  }

  console.log("\n📊 Claude Code Router Status");
  console.log("═".repeat(40));

  if (info.running) {
    console.log("✅ Status: Running");
    console.log(`🆔 Process ID: ${info.pid}`);
    console.log(`🌐 Port: ${info.port}`);
    console.log(`📡 API Endpoint: ${info.endpoint}`);
    console.log(`📄 PID File: ${info.pidFile}`);
    console.log("");
      console.log("🚀 Ready to use! Run the following commands:");
      console.log("   ccr code    # Start coding with Claude");
      console.log("   ccr stop   # Stop the service");
    if (oauthAccounts) {
      console.log("");
      console.log(oauthAccounts);
    }
  } else {
    console.log("❌ Status: Not Running");
    console.log("");
    console.log("💡 To start the service:");
    console.log("   ccr start");
  }

  console.log("");
}

function formatCodexAccounts(
  accounts: Array<{
    accountKey: string;
    accountHint: string;
    emailHint?: string;
    source?: string;
    expiresAt: string;
    invalid: boolean;
    reauthRequired: boolean;
  }>,
) {
  if (!accounts.length) {
    return "";
  }

  const lines = [
    "Codex Accounts",
    "═".repeat("Codex Accounts".length),
  ];

  for (const account of accounts) {
    lines.push(`- accountKey: ${account.accountKey}`);
    lines.push(`  accountHint: ${account.accountHint}`);
    if (account.emailHint) {
      lines.push(`  emailHint: ${account.emailHint}`);
    }
    if (account.source) {
      lines.push(`  source: ${account.source}`);
    }
    lines.push(`  expiresAt: ${account.expiresAt}`);
    lines.push(`  invalid: ${account.invalid ? "yes" : "no"}`);
    lines.push(`  reauthRequired: ${account.reauthRequired ? "yes" : "no"}`);
  }

  return lines.join("\n");
}
