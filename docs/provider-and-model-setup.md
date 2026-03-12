# Provider And Model Setup

Storyforge stores connection state in a local config file and uses `opencode` as the runtime bridge for model execution.

## Saved State

Storyforge persists the last selected connection and model in:

```text
~/.storyforge/config.json
```

API keys and managed `opencode` auth data are stored under:

```text
~/.storyforge/
```

## Supported Provider Flows

## API Key Providers

These providers use the credential-entry modal or `/connect <provider> <api-key>`:

- `deepseek`
- `openrouter`
- `google`
- `siliconflow-cn`
- `kimi-for-coding`
- `mixapi`

## OAuth Providers

These providers use browser or imported OAuth credentials:

- `opencode`
- `github-copilot`

## OpenAI

OpenAI supports both:

- ChatGPT Plus/Pro OAuth
- API key entry

The interactive flow lets you choose the auth mode first.

## Model Discovery

When you open `/models`, Storyforge tries this order:

1. Run `opencode models <provider>`.
2. If that fails, use the built-in fallback catalog for that provider.

## Switching Providers

Changing providers can invalidate the current model.

If the existing model belongs to a different provider, Storyforge clears it and asks you to pick a new one.

## Typical Setup Flow

1. Run `/connect`.
2. Select the provider.
3. Complete auth.
4. Run `/models`.
5. Choose the model.
6. Start sending prompts.
