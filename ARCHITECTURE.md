# Storyforge Architecture

## Overview

Storyforge is a terminal-first fiction workflow CLI built with TypeScript, React, and Ink.

The current build has two real product layers:

- a persistent session layer for provider and model setup
- a per-workspace story library that supports multiple local story projects

Within one working directory, Storyforge now keeps a local project index plus individual story files, supports `/init` to create new projects, `/projects` to reopen older ones, and a staged AI bootstrap flow that fills structured story tables.

## Runtime Layers

### Shell UI

- `packages/cli/src/app/App.tsx` is the main interaction controller
- `packages/cli/src/app/AppShell.tsx` renders the terminal layout
- Ink components in `packages/cli/src/components/` render dialogs, transcript, header, footer, and input

This layer owns:

- keyboard handling
- modal state
- transcript history
- routing between slash commands and plain prompts

### Command Layer

Command parsing stays in `App.tsx`, but domain behavior is split:

- `packages/cli/src/commands/command-actions.ts` handles provider and model updates
- `packages/cli/src/commands/story-commands.ts` handles story-specific commands
- `packages/cli/src/commands/command-preview.ts` powers slash-command discovery and Tab autocomplete

Current story commands:

- `/init`
- `/projects`
- `/world`
- `/char`
- `/timeline`
- `/outline`
- `/commit`
- `/status`
- `/log`
- `/ci run`
- `/render`
- `/compile`

### Story Domain Layer

The story domain lives in `packages/cli/src/story/`.

- `types.ts`: story models and library entry types
- `project-store.ts`: workspace index + project file persistence
- `prompt-catalog.ts`: structured prompt templates
- `structured-run.ts`: buffered structured model execution + JSON extraction
- `bootstrap.ts`: staged story initialization and refresh pipeline

This keeps the story workflow isolated from generic shell concerns.

### Python Agent Layer

Storyforge V2 introduces a local Python agent process:

- `packages/cli/story_agent.py`

The TypeScript app talks to this process via JSON stdin/stdout for:

- `plan_patch`
- `apply_patch`
- `run_ci`
- `build_impact`

This isolates deterministic validation and impact analysis from UI command routing.

## Persistence Model

Storyforge uses two persistence scopes.

### Global Session Config

Global provider and model settings live in:

- `~/.storyforge/config.json`

This stores:

- connected provider metadata
- auth mode
- saved API key or oauth token reference
- selected model

### Per-Workspace Story Library

Each working directory has its own local story library under:

- `./.storyforge/workspace.json`
- `./.storyforge/projects/<project-id>.json`

`workspace.json` stores:

- the active project id
- a list of saved project entries
- each entry's title, status, timestamps, and relative file path

Each project file stores the structured story state:

- `meta`
- `brief`
- `world`
- `characters`
- `timeline`
- `outline`
- `eventCommits`
- `inventory`
- `foreshadows`
- `dependencyGraph`
- `chapterRenders`
- `ciHistory`
- `dirtyChapters`

This means one folder can now contain multiple separate novels without collisions.

## Story Lifecycle

### Project Creation

`/init` creates a new blank project in the current workspace library and makes it active.

The project starts in `awaiting_brief`.

If multiple blank projects are created, Storyforge auto-numbers untitled names:

- `Untitled Story`
- `Untitled Story 2`
- `Untitled Story 3`

### Project Selection

`/projects` lists every saved project in the current working directory.

`/projects open <row>` switches the active project by 1-based row index.

`/init reset` only resets the active project. It does not delete sibling projects.

### Story Bootstrap

When the active project is in `awaiting_brief`, the next normal prompt is treated as the story brief.

Storyforge then runs a four-stage structured pipeline:

1. `foundation`
2. `characters`
3. `timeline`
4. `outline`

Each stage:

- builds a stage-specific JSON-only prompt
- runs a buffered `opencode` request
- parses the structured JSON
- writes the updated project back to disk immediately

If a later stage fails, earlier completed sections remain saved and the project is marked `partial`.

## Rendering Model

Story data is no longer rendered as a fixed panel above the transcript.

Instead:

- `/world`, `/char`, `/timeline`, and `/outline` append compact story snapshots directly into transcript history
- this keeps command history visible while switching between tables
- local story entries are rendered in a condensed transcript format so multiple snapshots remain readable

The snapshot formatter lives in:

- `packages/cli/src/components/StoryPanel.tsx`

The transcript rendering rules live in:

- `packages/cli/src/components/ResponsePanel.tsx`

## Data Flow

The main interactive path is:

`User input -> parse command or prompt -> command handler or prompt runner -> state update -> transcript update -> Ink re-render`

For story bootstrap:

`Brief prompt -> staged structured runner -> section writeback -> transcript progress -> final project snapshot`

For project switching:

`/projects open <row> -> workspace index update -> active project reload -> transcript snapshot`

## Testing Strategy

The current test suite focuses on behavior that is visible to users:

- command palette and autocomplete
- story project storage and multi-project switching
- `/init` bootstrap behavior
- transcript rendering for story snapshots
- shell smoke and layout coverage

Primary tests live in:

- `test/input-frame.test.tsx`
- `test/story-project-store.test.ts`
- `test/story-init.test.tsx`

## Current Limits

The current architecture intentionally does not yet include:

- cross-directory global story libraries
- inline table cell editing
- chapter drafting from outline
- export workflows
- plugin hooks for story tools

## Last Updated

2026-03-04
