# Storyforge CLI

**English** | [中文](./README.zh-CN.md)

![preview badge](https://img.shields.io/badge/preview-v0.1.0-f97316)
![node badge](https://img.shields.io/badge/node-%3E%3D20.0.0-16a34a)
![license badge](https://img.shields.io/badge/license-Apache%202.0-2563eb)

Writer-first terminal UI for scenes, arcs, and long-form fiction.

Storyforge is an open-source CLI interface for novel workflows. The repository now ships a real first writing feature: a persisted story project library, an `/init` bootstrap flow, and structured story tables inside the terminal UI.

> This is still an early build, but Storyforge can now initialize a story project, capture a story brief, and generate editable `world`, `characters`, `timeline`, and `outline` tables.

![Storyforge preview shell](./docs/assets/storyforge-preview-shell.jpg)

## Why Storyforge

- Built for fiction workflows instead of general coding tasks.
- Terminal-native and keyboard-first, with no browser dependency.
- Clean foundation with TypeScript, Ink, and a workspace structure that is easy to extend.

## What You Can Use Today

- A responsive ASCII Storyforge header with multiple viewport modes.
- A branded welcome card that frames the current session.
- An interactive input frame with typing, backspace, `Enter` submit, and `Esc` or `Ctrl+C` exit.
- A top command palette when you start typing `/`, with `Tab` autocomplete and `Enter` selection.
- A `/connect` provider picker that leads into saved credential entry.
- A `/models` model picker that uses the local `opencode models <provider>` list when available.
- Manual command support for `/connect <provider> <api-key> [base-url]` and `/model <provider/model>`.
- Automatic restore of the last saved provider and model on the next launch.
- A persisted per-directory story project library in `./.storyforge/workspace.json` plus per-project files in `./.storyforge/projects/`.
- `/init` to create a new blank story scaffold before any AI generation happens.
- `/projects` to list saved local story projects and reopen one by index.
- The first plain prompt after `/init` becomes the story brief and bootstraps:
  `world`, `characters`, `timeline`, and `outline`.
- Story tables render directly inside transcript history for:
  `/world`, `/char`, `/timeline`, and `/outline`.
- Command-based editing for structured story data, including add/set/remove flows.
- An adaptive footer for wide and narrow terminals.

After the initial story bootstrap is complete, normal prompts still stream through the transcript panel as free-form chat.

## Quick Start

### Prerequisites

- Node.js 20 or later
- pnpm 9 or later

### Install dependencies

```bash
pnpm install
```

### Run the preview shell

```bash
pnpm dev
```

### Build the CLI

```bash
pnpm build
```

### Run the built bundle

```bash
node packages/cli/dist/index.js
```

### Link the local command

```bash
pnpm link:global
storyforge
```

If `storyforge` is still not found after linking, run `pnpm setup` once and restart your shell so pnpm's global bin directory is added to your `PATH`.

## Documentation

- [Documentation Index](./docs/README.md)
- [Quickstart](./docs/quickstart.md)
- [Feature Overview](./docs/feature-overview.md)
- [Command Reference](./docs/command-reference.md)
- [Provider And Model Setup](./docs/provider-and-model-setup.md)
- [Troubleshooting](./docs/troubleshooting.md)

## Project Layout

```text
.
├── docs/
│   ├── assets/    # README images and supporting documentation assets
│   └── *.md       # User documentation for the preview shell
├── packages/
│   └── cli/       # Executable Storyforge CLI package
├── test/          # Root-level rendering and smoke tests
├── package.json   # Workspace orchestration
└── pnpm-workspace.yaml
```

## Development

Run these from the repository root:

```bash
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Testing

The project uses `Vitest` with `ink-testing-library`.

Current coverage focuses on the UI shell:

- header rendering across viewport modes
- input-frame behavior
- footer layout variants
- CLI smoke rendering

Run the full test suite with:

```bash
pnpm test
```

## Tech Stack

- TypeScript
- React 19
- Ink
- ink-gradient
- Vitest
- pnpm workspace

## Contributing

The project is still in its foundation stage.

If you extend it, keep the current bar:

- preserve clean module boundaries
- keep comments concise and in English
- avoid presenting placeholder behavior as a finished feature
- prefer tested UI changes over fast unverified churn

## License

Storyforge is available under the [Apache License 2.0](./LICENSE).

Copyright 2026 Jayden
