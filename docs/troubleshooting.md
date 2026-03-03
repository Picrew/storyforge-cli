# Troubleshooting

This page covers the most common issues in the current preview build.

## `pnpm dev` Fails In Restricted Environments

Storyforge uses `tsx` for the development entrypoint.

In restricted sandboxes, `tsx` can fail while opening its local IPC pipe or socket.

Use the compiled bundle instead:

```bash
pnpm build
node packages/cli/dist/index.js
```

## `opencode` Is Missing

If `opencode` is not installed:

- provider model lists fall back to the built-in catalog
- prompt execution will not work until `opencode` is available

Check whether it is installed:

```bash
opencode --version
```

## `No models found`

This usually means:

- the provider has no built-in fallback models
- `opencode models <provider>` failed
- the current provider id is invalid

Reconnect the provider and try `/models` again.

## Credential Writes Fail

Storyforge writes its config and auth cache under `~/.storyforge`.

If the process cannot write there, you can still use the current session, but settings will not persist.

Check:

- filesystem permissions for your home directory
- sandbox restrictions in your runtime environment

## OAuth Import Does Not Appear

Some OAuth flows depend on local `opencode` auth files being present.

If the app cannot find reusable OAuth credentials:

- complete the provider login once in `opencode`
- reopen Storyforge and run `/connect` again

## Prompt Does Not Send

Before a normal prompt can run, all three must be true:

- a provider is connected
- a model is selected
- `opencode run` can execute successfully

If one of those is missing, Storyforge shows a transient notice in the shell instead of starting generation.
