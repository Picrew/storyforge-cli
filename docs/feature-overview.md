# Feature Overview

Storyforge currently ships a terminal-first preview shell with a functional provider and model setup loop.

## Shell UI

- responsive ASCII header with multiple viewport modes
- branded welcome card for empty-state sessions
- adaptive footer for wide and narrow terminals
- modal overlays for provider, auth, and model flows

## Input And Commands

- text input with typing, backspace, and clear empty-state placeholder
- slash-command palette when typing `/`
- `Tab` autocomplete for supported commands
- `Enter` to submit commands or prompts
- `Esc` to close overlays, clear command preview, cancel generation, or exit
- `Ctrl+C` to exit immediately

## Provider Setup

- `/connect` opens an interactive provider picker
- API-key providers save credentials locally in `~/.storyforge`
- OAuth providers can import or reuse local `opencode` credentials
- OpenAI supports both OAuth and API-key flows

## Model Selection

- `/models` opens a model picker for the current provider
- local `opencode models <provider>` output is used when available
- built-in fallback model lists are used when `opencode` is unavailable
- the selected model is persisted and restored on the next launch

## Prompt Execution

- prompts stream through local `opencode run --format json`
- responses are shown in a live transcript panel
- transcript history is preserved inside the current app session
- active generations can be cancelled with `Esc`
- repeated prompts reuse the same `opencode` session when available

## Preview Limits

Storyforge is not a full writing tool yet.

The current build does not include:

- story drafting workflows beyond raw prompt sending
- outline management
- project files, notes, or chapter storage
- export flows
