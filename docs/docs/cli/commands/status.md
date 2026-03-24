---
sidebar_position: 3
---

# ccr status

Show the current status of the Claude Code Router server, including local Codex account status when available.

## Usage

```bash
ccr status
```

## Output

### Running Server

When the server is running:

```
📊 Claude Code Router Status
════════════════════════════════════════
✅ Status: Running
🆔 Process ID: 12345
🌐 Port: 3456
📡 API Endpoint: http://127.0.0.1:3456
📄 PID File: ~/.claude-code-router/claude-code-router.pid

🚀 Ready to use! Run the following commands:
   ccr code    # Start coding with Claude
   ccr stop    # Stop the service

Codex Accounts
══════════════
- accountKey: e77b122d95cf
  accountHint: ac...89
  emailHint: p...n@e...e.com
  expiresAt: 2026-03-19T00:00:00.000Z
  invalid: no
  reauthRequired: no
```

### Stopped Server

When the server is not running:

```
📊 Claude Code Router Status
════════════════════════════════════════
❌ Status: Not Running

💡 To start the service:
   ccr start
```

## Codex Account Output

When local Codex accounts exist, `ccr status` appends a `Codex Accounts` section with redacted metadata:

- `accountKey`: stable non-PII identifier derived from the account ID
- `accountHint`: redacted account identifier
- `emailHint`: redacted email hint, when available
- `expiresAt`: token expiry timestamp
- `invalid`: whether the local Codex account metadata is marked invalid
- `reauthRequired`: whether the account needs re-authentication

This output is derived from local Codex auth files and never includes raw tokens or full email addresses.

## Examples

```bash
$ ccr status

📊 Claude Code Router Status
════════════════════════════════════════
✅ Status: Running
🆔 Process ID: 12345
🌐 Port: 3456
📡 API Endpoint: http://127.0.0.1:3456
```

## Related Commands

- [ccr start](/docs/cli/start) - Start the server
- [ccr stop](/docs/cli/other-commands#ccr-stop) - Stop the server
- [ccr restart](/docs/cli/other-commands#ccr-restart) - Restart the server
