# Storyforge Documentation

This folder is the documentation hub for the current Storyforge build.

The structure is intentionally lightweight, similar to CLI-first projects that keep a simple index plus focused topic guides.

![Storyforge preview shell](./assets/storyforge-preview-shell.jpg)

## Get Started

- [Quickstart](./quickstart.md): install dependencies, launch the preview shell, and run the built bundle.
- [Provider And Model Setup](./provider-and-model-setup.md): connect a provider, save credentials, and choose a model.

## Use The Shell

- [Feature Overview](./feature-overview.md): what the preview shell can do today.
- [Command Reference](./command-reference.md): slash commands, prompt behavior, and keyboard controls.
- [Bash Workflow And Architecture](./bash-architecture.md): feature map and serial/parallel batch-generation flow.

## Support

- [Troubleshooting](./troubleshooting.md): common local setup issues, `opencode` integration notes, and sandbox caveats.

## Current Scope

Storyforge is still early, but it now includes a real story bootstrap flow.

What is implemented now:

- interactive terminal UI with responsive layouts
- provider connection and saved credentials
- model switching and persistence
- per-directory story project library persistence
- multiple local story projects per working directory
- `/init` story bootstrap from a natural-language brief
- `/projects` listing and project switching inside the current working directory
- structured story tables for world, characters, timeline, and outline
- command-driven editing for story tables
- live transcript streaming through local `opencode`
- keyboard-first command entry and modal flows

What is not implemented yet:

- chapter drafting from the generated outline
- scene management
- export flows
- cross-directory project management
