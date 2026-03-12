# Storyforge CLI

**English** | [中文](./README.zh-CN.md)

![preview badge](https://img.shields.io/badge/preview-v0.2.0-f97316)
![node badge](https://img.shields.io/badge/node-%3E%3D20.0.0-16a34a)
![python badge](https://img.shields.io/badge/python-%3E%3D3.10-3776ab)
![license badge](https://img.shields.io/badge/license-Apache%202.0-2563eb)

Storyforge is a terminal-first fiction workflow system.

V2 shifts long-form generation from “keep feeding longer context” to “maintain world state, then render text from state”.

## Core Workflow

```text
/init -> brief bootstrap
/commit -> structured event patch -> deterministic CI
/render -> chapter prose from chapter snapshot
/compile -> manuscript assembly
```

## What Is Implemented

- Persistent per-workspace story project library.
- Structured story bootstrap (`world`, `characters`, `timeline`, `outline`).
- V2 world-state schema with migration from legacy v1 projects.
- Python agent bridge for:
  - `plan_patch`
  - `apply_patch`
  - `run_ci`
  - `build_impact`
- Deterministic narrative CI rules:
  - timeline monotonicity
  - entity reference existence
  - inventory conservation
  - overdue unresolved foreshadow warnings
- Incremental dependency tracking and dirty chapter marking.
- Chapter rendering output to `.storyforge/chapters/chNN.md`.
- Manuscript compilation to `.storyforge/manuscript/story.md` (default).

## Command Set (V2)

- `/init`
- `/projects`
- `/world` `/char` `/timeline` `/outline`
- `/commit --chapter chNN <event_text>`
- `/commit --chapter chNN --patch-file <json_path>`
- `/commit --chapter chNN <event_text> --force`
- `/status`
- `/log [--chapter chNN] [--limit N] [--visual]`
- `/ci run [--all|--commit <id>]`
- `/render <chNN|chNN..chMM|all> [--force] [--style <name>]`
- `/compile <range|all> [--output <path>]`

See [Command Reference](./docs/command-reference.md) for details.

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- Python 3.10+ (for the local story agent)
- `opencode` installed and available in `PATH`

### Install

```bash
pnpm install
```

### Run

```bash
pnpm dev
```

### Build

```bash
pnpm build
node packages/cli/dist/index.js
```

### Build Installers (macOS + Linux)

```bash
pnpm build:installers
```

Installer artifacts are generated under `installers/v<version>/`.

## Typical V2 Session

```text
/connect deepseek <api-key>
/model deepseek/deepseek-chat
/init
<enter brief>
/commit --chapter ch01 Mira finds the coded ledger in the basement
/ci run
/render ch01
/compile all
```

## Testing

The suite uses `Vitest` + `ink-testing-library` and now includes:

- command parsing and workflow tests for V2
- migration tests (v1 -> v2)
- deterministic CI rule tests
- render/compile artifact tests
- online DeepSeek end-to-end test in default `pnpm test`

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

Quick offline regression (skips the online DeepSeek e2e case):

```bash
pnpm test:offline
```

## Documentation

- [Documentation Index](./docs/README.md)
- [Quickstart](./docs/quickstart.md)
- [Feature Overview](./docs/feature-overview.md)
- [Command Reference](./docs/command-reference.md)
- [Bash Workflow And Architecture](./docs/bash-architecture.md)
- [Architecture](./ARCHITECTURE.md)
- [V2 Feature Framework (ASCII)](./docs/v2-feature-framework.txt)

## License

[Apache License 2.0](./LICENSE)
