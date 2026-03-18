---
sidebar_position: 4
---

# Other Commands

Additional CLI commands for managing Claude Code Router.

## ccr stop

Stop the running server.

```bash
ccr stop
```

## ccr restart

Restart the server.

```bash
ccr restart
```

## ccr code

Execute a claude command through the router.

```bash
ccr code [args...]
```

## ccr ui

Open the Web UI in your browser.

```bash
ccr ui
```

## ccr activate

Output shell environment variables for integration with external tools.

```bash
ccr activate
```

## ccr oauth

Manage the local OpenAI OAuth flow used by `openai-oauth` providers.

### Start browser authorization

```bash
ccr oauth login
```

This starts the local OAuth flow and opens the authorization page in your browser.

### Finish with a pasted callback URL

```bash
ccr oauth complete "http://localhost:3456/oauth/callback?code=...&state=..."
```

Use this command when you want to complete the callback exchange manually from the CLI.

### Show OAuth account status

```bash
ccr oauth status
```

This prints redacted account metadata, expiry, and whether re-authentication is required.

## Global Options

These options can be used with any command:

| Option | Description |
|--------|-------------|
| `-h, --help` | Show help |
| `-v, --version` | Show version number |
| `--config <path>` | Path to configuration file |
| `--verbose` | Enable verbose output |

## Examples

### Stop the server

```bash
ccr stop
```

### Restart with custom config

```bash
ccr restart --config /path/to/config.json
```

### Open Web UI

```bash
ccr ui
```

### Run the OAuth flow

```bash
ccr oauth login
ccr oauth complete "http://localhost:3456/oauth/callback?code=...&state=..."
ccr oauth status
```

## Related Documentation

- [Getting Started](/docs/intro) - Introduction to Claude Code Router
- [Configuration](/docs/config/basic) - Configuration guide
