# Storyforge CLI

**English** | [中文](./README.zh-CN.md)

![preview badge](https://img.shields.io/badge/preview-v0.1.0-f97316)
![node badge](https://img.shields.io/badge/node-%3E%3D20.0.0-16a34a)
![license badge](https://img.shields.io/badge/license-pending-6b7280)

Writer-first terminal UI for scenes, arcs, and long-form fiction.

Storyforge is an open-source CLI interface for novel workflows. The repository currently ships the first interactive shell only: a polished startup screen, a branded input lane, and a responsive terminal layout that define the product's visual direction.

> This is a UI preview build. Only the interface shell is implemented right now.

![Storyforge preview shell](./docs/assets/storyforge-preview-shell.jpg)

## Why Storyforge

- Built for fiction workflows instead of general coding tasks.
- Terminal-native and keyboard-first, with no browser dependency.
- Clean foundation with TypeScript, Ink, and a workspace structure that is easy to extend.

## What You Can Use Today

- A responsive ASCII Storyforge header with multiple viewport modes.
- A branded welcome card that frames the current session.
- An interactive input frame with typing, backspace, `Enter` submit, and `Ctrl+C` exit.
- An adaptive footer for wide and narrow terminals.

If you press `Enter`, Storyforge clears the prompt and shows the current preview notice:

```text
UI preview only. Story actions are not implemented yet.
```

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

## Project Layout

```text
.
├── docs/
│   └── assets/    # README images and supporting documentation assets
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

No license file has been added yet.

Until a license is explicitly added, treat this repository as source-visible but not licensed for reuse.
