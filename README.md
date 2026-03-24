# Claude Code Router Fork for Codex + Local Search

This repository is a focused fork of `claude-code-router`.

The upstream project is still the base router, but this fork is opinionated around one workflow:

- run Claude Code through CCR
- route default traffic to Codex / GPT-5.4 style backends
- read and reuse local Codex auth instead of pasting raw OpenAI API keys
- add a CCR-managed local web search path backed by Tavily
- make provider/account switching and startup behavior smoother for daily use

## What This Fork Adds

The following items are extracted from the latest commits on this branch rather than copied from the upstream README.

### 1. Codex-auth transport support

This fork adds a built-in `codex-auth` provider path for Codex-style traffic, backed by your local Codex auth.

What that means in practice:

- CCR can route requests to `https://chatgpt.com/backend-api/codex/responses`
- the provider does not require a raw OpenAI API key in config
- Codex auth is read from your local Codex installation automatically
- the router can normalize public OpenAI base URLs to the Codex backend transport automatically

Relevant work landed in the `feat: add codex oauth transport support` commit.

### 2. Read local Codex authentication directly

CCR reads credentials from your local Codex installation directly.

Current auth sources in this fork:

- `~/.codex/accounts/registry.json` + per-account auth files
- fallback `~/.codex/auth.json`

CCR does not maintain a separate auth vault for `codex-auth`.

### 3. Fresh-start bootstrap for first-run setups

This fork improves the "fresh start" experience:

- CCR can bootstrap a minimal `codex-auth` config on first run
- the default route can come up as `codex-auth,gpt-5.4`
- the built-in Codex-auth provider is added automatically when needed

This came from the `fix: fresh start bug` series.

### 4. `ccr switch` command

This fork adds a dedicated switch flow for changing the active route without manually editing `config.json`.

You can switch:

- between normal providers
- between local Codex-auth accounts

The command updates `Router.default`, and for Codex-auth providers it also binds the selected `account_id`.

### 5. Local search sidecar backed by Tavily

This fork adds a CCR-managed local search flow instead of relying only on provider-native web search.

What was added:

- a local search sidecar process
- lazy startup and health management
- a search agent that replaces Anthropic-style `web_search` tool calls with a CCR-managed custom tool
- a local `POST /api/search` endpoint
- Tavily-backed normalization into DeerFlow-style results: `title`, `url`, `snippet`

This is the main addition from `feat: 添加本地搜索sidecar功能`.

### 6. Compatibility fixes around agents, sub-agents, and effort mapping

Recent commits also include smaller but important runtime fixes:

- sub-agent normal call compatibility
- better mapping from Claude thinking / effort values into router reasoning levels
- startup and Codex auth edge-case fixes
- account cleanup when importing credentials from different auth sources

## Quick Start

### Install

Install Claude Code first:

```bash
npm install -g @anthropic-ai/claude-code
```

Install this router fork:

```bash
npm install -g @musistudio/claude-code-router
```

### Minimal config

Create `~/.claude-code-router/config.json`:

```json
{
  "PORT": 3456,
  "SEARCH_SIDECAR_ENABLED": true,
  "SEARCH_SIDECAR_PORT": 3460,
  "TAVILY_API_KEY": "$TAVILY_API_KEY",
  "Providers": [
    {
      "name": "codex-auth",
      "auth_strategy": "codex-auth",
      "account_id": "",
      "api_base_url": "https://chatgpt.com/backend-api/codex/responses",
      "api_key": "",
      "models": ["gpt-5.4"]
    }
  ],
  "Router": {
    "default": "codex-auth,gpt-5.4"
  }
}
```

### Start CCR

```bash
ccr start
```

Or launch Claude Code through CCR directly:

```bash
ccr code
```

## Codex Auth Flow

This fork now uses local Codex auth as the only supported auth source for the built-in Codex provider.

Usage is simple:

- sign in with Codex on the same machine first
- start CCR
- CCR reads the current Codex account automatically
- `ccr switch` can bind a different local Codex account when needed

## Search Sidecar

When `SEARCH_SIDECAR_ENABLED` is `true`, CCR can intercept supported web-search tool calls and fulfill them through the local sidecar instead of relying only on upstream provider-native search.

Current behavior:

- sidecar starts lazily on first use
- search calls hit Tavily
- results are normalized into lightweight search records
- CCR can reuse the result inside the same request flow

Required environment or config value:

```bash
export TAVILY_API_KEY="..."
```

## Useful Commands

```bash
ccr code
ccr start
ccr stop
ccr restart
ccr status
ccr switch
ccr model
```

## Why This Fork Exists

The upstream router is a generic multi-provider request router.

This fork narrows the problem and makes a few workflows first-class:

- Codex-style OpenAI auth without managing raw API keys
- importing auth you already have locally
- using GPT-5.4 as a practical default route
- adding a local searchable web path that CCR owns
- switching active account/provider quickly from the CLI

If your use case is "I want plain upstream CCR behavior", use upstream.

If your use case is "I want CCR as a Codex-oriented router with local auth import and local search support", this fork is the version to look at.
