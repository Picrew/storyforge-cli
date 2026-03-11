# Command Reference

Storyforge is keyboard-first. Commands are entered directly in the prompt lane.

## Slash Commands

## `/init`

Create a new story project or refresh the current one.

Examples:

```text
/init
/init reset
/init refresh
/init refresh world
```

Behavior:

- `/init` creates a new blank project in the local story library and makes it active
- `/init reset` resets only the active project to a fresh blank scaffold
- `/init refresh` reruns all generated story tables from the saved brief
- `/init refresh world|char|timeline|outline` reruns only one section
- after `/init`, the next normal prompt is consumed as the story brief

## `/projects`

List local story projects or reopen a saved one.

Examples:

```text
/projects
/projects open 2
```

Behavior:

- `/projects` shows every saved project in the current working directory
- rows are 1-based and mark the active project with `*`
- `/projects open <row>` switches the active project without deleting the others

## `/connect`

Open the provider flow.

Examples:

```text
/connect
/connect deepseek <api-key>
/connect google <api-key>
```

Behavior:

- with no arguments, opens the provider picker
- with `<provider> <api-key>`, saves an API-key connection immediately
- for OAuth providers, use the interactive flow instead of passing a token inline

## `/models`

Open the model picker for the connected provider.

Examples:

```text
/models
/model deepseek/deepseek-chat
```

Behavior:

- `/models` opens the interactive picker
- `/model <provider/model>` sets the model directly
- if no provider is connected yet, Storyforge shows a setup warning instead

## `/world`

View or edit world state.

Examples:

```text
/world
/world set premise A comic conference disaster
```

Behavior:

- `/world` opens the world-state table
- `/world set <field> <value...>` updates one world field and saves immediately

## `/char`

View or edit character rows.

Examples:

```text
/char
/char add Mira Vale
/char set 1 role Protagonist
/char rm 1
```

Behavior:

- `/char` opens the character table
- `/char add <name...>` appends a blank character row
- `/char set <row> <field> <value...>` updates a character row by 1-based index
- `/char rm <row>` removes a character row

## `/timeline`

View or edit timeline beats.

Examples:

```text
/timeline
/timeline add Lobby reveal
/timeline set 1 stakes Funding is at risk
/timeline rm 1
```

Behavior:

- `/timeline` opens the timeline table
- `/timeline add <event...>` appends a blank beat
- `/timeline set <row> <field> <value...>` updates a beat by 1-based index
- `/timeline rm <row>` removes a beat

## `/outline`

View or edit chapter plans.

Examples:

```text
/outline
/outline set 1 title Opening Pitch
/outline rm 1
```

Behavior:

- `/outline` opens the chapter-plan table
- `/outline set <row> <field> <value...>` updates a chapter row by 1-based index
- `/outline rm <row>` removes a chapter row

## `/commit`

Commit one chapter event patch into the structured world state.

Examples:

```text
/commit --chapter ch03 Mira finds the coded ledger in the basement
/commit --chapter ch03 --patch-file ./patches/ch03.json
/commit --chapter ch03 Mira finds the coded ledger --force
```

Behavior:

- `--chapter` is required and must be `chNN` format
- with plain event text, Storyforge plans a structured event patch through the current model
- with `--patch-file`, Storyforge loads patch JSON directly
- deterministic CI runs after patch application
- CI failures block persistence by default, unless `--force` is used

## `/status`

Show the narrative health summary.

Examples:

```text
/status
```

Behavior:

- reports commit count, dirty chapters, open foreshadows, and CI health snapshot

## `/log`

Show event commit history and optional dependency graph.

Examples:

```text
/log
/log --chapter ch03 --limit 10
/log --visual
```

Behavior:

- prints commit timeline with read/write dimensions
- `--chapter` filters by chapter id
- `--limit` controls the number of visible entries
- `--visual` appends text DAG edges from dependency graph

## `/ci`

Run deterministic story CI checks.

Examples:

```text
/ci run
/ci run --all
/ci run --commit 1a2b3c4d
```

Behavior:

- executes timeline monotonicity, entity existence, inventory conservation, and foreshadow due checks
- writes report into project CI history

## `/render`

Render chapter prose from current world state snapshot and chapter patches.

Examples:

```text
/render ch03
/render ch01..ch05 --style hardboiled
/render all --force
```

Behavior:

- renders only dirty chapters by default
- `--force` rerenders even clean chapters
- writes chapter markdown files to `./.storyforge/chapters/chNN.md`

## `/compile`

Compile rendered chapter files into one manuscript.

Examples:

```text
/compile all
/compile ch01..ch10 --output .storyforge/manuscript/story.md
```

Behavior:

- concatenates rendered chapter markdown in chapter order
- default output is `./.storyforge/manuscript/story.md`
- does not call a model

## `/exit`

Exit the app.

## Prompt Submission

When the current project is in `awaiting_brief`:

- the next normal prompt is used as the story brief instead of normal chat
- Storyforge runs a staged bootstrap for `world`, `characters`, `timeline`, and `outline`
- progress appears in the transcript panel and the story tables are saved section by section

When the current project is already initialized and a provider and model are both configured:

- typing normal text and pressing `Enter` sends the prompt
- the response streams into the transcript panel

When setup is incomplete:

- Storyforge shows a transient notice such as `Run /connect first.`

## Keyboard Controls

- `Enter`: submit the current command, selection, or prompt
- `Tab`: autocomplete the highlighted command
- `Esc`: close the active modal, clear command preview, cancel generation, or exit
- `Up` and `Down`: move through command lists, modal lists, or transcript scroll
- `Backspace`: delete the last typed character
- `Ctrl+C`: exit immediately
