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

## Codex-auth workflow

Legacy `ccr oauth` commands have been removed in this fork.

To use the built-in Codex provider:

1. Sign in with Codex on the same machine.
2. Start CCR with `ccr start`.
3. Use `ccr switch` if you need to bind a different local Codex account.

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

### Switch the active Codex-auth account

```bash
ccr switch
```

## Related Documentation

- [Getting Started](/docs/intro) - Introduction to Claude Code Router
- [Configuration](/docs/config/basic) - Configuration guide
