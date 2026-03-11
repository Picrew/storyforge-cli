# Feature Overview

Storyforge now ships a terminal-first shell with a persisted story project layer and the first structured story bootstrap workflow.

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

## Story Project

- `/init` creates a new blank story scaffold in the current working directory
- story state is persisted as a local project library in `./.storyforge/workspace.json`
- each story project is stored as its own file under `./.storyforge/projects/`
- `/projects` lists saved local projects and reopens one by row number
- the first plain prompt after `/init` is consumed as the story brief
- Storyforge then generates structured tables for:
  world state, characters, timeline beats, and chapter outline
- story sections remain editable through command-driven updates
- event-based world simulation and deterministic CI workflow

## Story Tables

- `/world` shows a key-value world-state table
- `/char` shows the character table and supports add/set/remove edits
- `/timeline` shows the timeline table and supports add/set/remove edits
- `/outline` shows the chapter-plan table and supports set/remove edits
- `/init refresh` reruns all structured sections from the saved brief
- `/init refresh world|char|timeline|outline` reruns one section only
- story table snapshots are appended into transcript history, so earlier `/char` and `/timeline` views remain visible as you switch

## Story Simulation

- `/commit --chapter chNN <event...>` commits one structured event patch
- deterministic CI blocks inconsistent commits by default
- `/status` shows narrative health metrics
- `/log` shows chapter event timeline and dependency graph edges
- dependency tracking marks affected chapters as dirty for incremental rerendering

## Rendering And Compilation

- `/render chNN` or `/render chNN..chMM` renders prose from state snapshot + chapter patch
- rendered chapters are persisted in `./.storyforge/chapters/`
- `/compile` concatenates rendered chapters into a manuscript file

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

- after story bootstrap is complete, normal prompts stream through local `opencode run --format json`
- responses are shown in a live transcript panel
- transcript history is preserved inside the current app session
- active generations can be cancelled with `Esc`
- repeated prompts reuse the same `opencode` session when available

## Current Limits

Storyforge is still early. The current build does not include:

- inline table cell editing
- chapter drafting from the generated outline
- export flows
- cross-directory project libraries
