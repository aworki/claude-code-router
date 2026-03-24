---
sidebar_position: 2
---

# Providers Configuration

Detailed guide for configuring LLM providers.

## Provider Schema

Providers live under the top-level `Providers` array in `~/.claude-code-router/config.json`.

```json
{
  "name": "openrouter",
  "api_base_url": "https://openrouter.ai/api/v1/chat/completions",
  "api_key": "sk-or-v1-",
  "models": ["anthropic/claude-sonnet-4"]
}
```

## Common Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Unique provider identifier |
| `api_base_url` | string | Yes | Full upstream chat/completions URL |
| `api_key` | string | Usually | Provider API key. Leave empty for `codex-auth`. |
| `models` | string[] | Yes | Models exposed through this provider |
| `auth_strategy` | string | No | `api-key` or `codex-auth` |
| `account_id` | string | No | Codex account binding for `codex-auth` providers |
| `transformer` | object | No | Request/response transformer configuration |

## Built-in Codex-auth Example

Use `auth_strategy: "codex-auth"` when you want CCR to use your local Codex auth instead of storing a raw OpenAI API key. In this fork, that provider is wired to the Codex backend transport.

```json
{
  "name": "codex-auth",
  "auth_strategy": "codex-auth",
  "account_id": "",
  "api_base_url": "https://chatgpt.com/backend-api/codex/responses",
  "api_key": "",
  "models": ["gpt-5.4"]
}
```

Before routing traffic to it, sign in with Codex on the same machine. CCR reads from:

- `~/.codex/accounts/registry.json` and per-account auth files
- fallback `~/.codex/auth.json`

Notes:

- Leave `account_id` empty when you want CCR to auto-select the current local Codex account.
- `api_base_url` is normalized to the Codex backend route, not the public OpenAI `chat/completions` endpoint.
- On startup, CCR can auto-add the built-in provider when the config references it or local Codex auth is available.
- CCR does not keep a separate auth vault for `codex-auth`.

## API-Key Examples

### DeepSeek

```json
{
  "name": "deepseek",
  "api_base_url": "https://api.deepseek.com/chat/completions",
  "api_key": "your-api-key",
  "models": ["deepseek-chat", "deepseek-coder"]
}
```

### Groq

```json
{
  "name": "groq",
  "api_base_url": "https://api.groq.com/openai/v1/chat/completions",
  "api_key": "your-api-key",
  "models": ["llama-3.3-70b-versatile"]
}
```

### Gemini

```json
{
  "name": "gemini",
  "api_base_url": "https://generativelanguage.googleapis.com/v1beta/models/",
  "api_key": "your-api-key",
  "models": ["gemini-1.5-pro"]
}
```

## Model Selection

When selecting a model in routing, use the format:

```
{provider-name},{model-name}
```

For example:

```
codex-auth,gpt-5.4
```

## Next Steps

- [Routing Configuration](/docs/config/routing) - Configure how requests are routed
- [Transformers](/docs/config/transformers) - Apply transformations to requests
