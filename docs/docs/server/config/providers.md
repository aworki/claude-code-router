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
| `api_key` | string | Usually | Provider API key. Leave empty for `openai-oauth`. |
| `models` | string[] | Yes | Models exposed through this provider |
| `auth_strategy` | string | No | `api-key` or `openai-oauth` |
| `account_id` | string | No | OAuth account binding for `openai-oauth` providers |
| `oauth.client_id` | string | No | OAuth client ID override |
| `oauth.redirect_uri` | string | No | Local OAuth callback URI override |
| `oauth.scopes` | string[] | No | OAuth scope override |
| `transformer` | object | No | Request/response transformer configuration |

## OpenAI OAuth Example

Use `auth_strategy: "openai-oauth"` when you want CCR to obtain and refresh OpenAI tokens through the local OAuth flow instead of storing a raw OpenAI API key. In this fork, that provider is wired to the Codex backend transport.

```json
{
  "name": "openai-oauth",
  "auth_strategy": "openai-oauth",
  "account_id": "",
  "api_base_url": "https://chatgpt.com/backend-api/codex/responses",
  "api_key": "",
  "models": ["gpt-5.4"],
  "oauth": {
    "client_id": "app_EMoamEEZ73f0CkXaXp7hrann",
    "redirect_uri": "http://localhost:1455/auth/callback",
    "scopes": ["openid", "email", "profile", "offline_access"]
  }
}
```

Authorize the account before routing traffic to it:

```bash
ccr oauth login
ccr oauth complete "http://localhost:1455/auth/callback?code=...&state=..."
ccr oauth status
```

`ccr oauth status` returns redacted account metadata only. It never prints tokens.

Notes:

- Leave `account_id` empty when you want CCR to auto-select the imported Codex/OpenAI account and there is only one valid OAuth bundle.
- `api_base_url` is normalized to the Codex backend route, not the public OpenAI `chat/completions` endpoint.
- On macOS, CCR can import credentials from Codex CLI (`~/.codex/auth.json` or the `Codex Auth` keychain record).

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
openai-oauth,gpt-5.4
```

## Next Steps

- [Routing Configuration](/docs/config/routing) - Configure how requests are routed
- [Transformers](/docs/config/transformers) - Apply transformations to requests
