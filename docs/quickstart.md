# Quickstart

This guide covers the fastest path to a working local Storyforge session.

## Prerequisites

- Node.js 20 or later
- pnpm 9 or later
- `opencode` installed locally if you want provider-backed model listing and prompt execution

## Install Dependencies

```bash
pnpm install
```

## Start The Preview Shell

For normal local development:

```bash
pnpm dev
```

If your environment blocks `tsx` IPC sockets or pipes, build first and run the compiled entrypoint instead:

```bash
pnpm build
node packages/cli/dist/index.js
```

## First Run

1. Launch Storyforge.
2. Run `/connect`.
3. Select a provider such as `openrouter` or `deepseek`.
4. Enter an API key or complete the OAuth flow, depending on the provider.
5. Run `/models` and choose a model.
6. Enter a prompt and press `Enter`.

## Example OpenRouter Flow

```text
/connect openrouter <api-key>
/model openrouter/stepfun/step-3.5-flash:free
Write a one-line premise about a city that remembers.
```

## Local Commands

From the repository root:

```bash
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```
