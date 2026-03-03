# Command Reference

Storyforge is keyboard-first. Commands are entered directly in the prompt lane.

## Slash Commands

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

## `/exit`

Exit the app.

## Prompt Submission

When a provider and model are both configured:

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
