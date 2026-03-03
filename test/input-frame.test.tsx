import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { App } from "../packages/cli/src/app/App.js";
import {
  applyConnectCommand,
  applyModelCommand
} from "../packages/cli/src/commands/command-actions.js";
import {
  getCommandAutocompleteValue,
  getCommandPreviewItems,
  shouldShowCommandPreview
} from "../packages/cli/src/commands/command-preview.js";
import { getProviderMatches } from "../packages/cli/src/data/provider-catalog.js";
import { AppShell } from "../packages/cli/src/app/AppShell.js";
import {
  appendInputCharacter,
  createInitialAppState,
  deleteInputCharacter,
  openConnectAuthModeModal,
  openConnectProviderModal,
  openModelPickerModal
} from "../packages/cli/src/state/app-state.js";

async function waitForCondition(
  check: () => boolean,
  timeoutMs: number = 1_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (check()) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  }

  throw new Error("Timed out waiting for render state.");
}

describe("Input frame interactions", () => {
  it("shows the placeholder when the input is empty", () => {
    const app = render(
      <AppShell state={createInitialAppState(100)} terminalWidth={100} cwd="/tmp/storyforge" />
    );

    expect(app.lastFrame()).toContain("Describe a premise, scene, or character...");
    app.unmount();
  });

  it("supports input edits", () => {
    let state = createInitialAppState(100);
    state = appendInputCharacter(state, "P");
    state = appendInputCharacter(state, "l");
    state = appendInputCharacter(state, "o");
    state = appendInputCharacter(state, "t");

    let app = render(<AppShell state={state} terminalWidth={100} cwd="/tmp/storyforge" />);
    expect(app.lastFrame()).toContain("Plot_");
    app.unmount();

    state = deleteInputCharacter(state);
    app = render(<AppShell state={state} terminalWidth={100} cwd="/tmp/storyforge" />);
    expect(app.lastFrame()).toContain("Plo_");
    app.unmount();
  });

  it("stores provider details when /connect is applied", () => {
    const result = applyConnectCommand(
      {
        connection: null,
        model: null
      },
      {
        provider: "deepseek",
        authMode: "api",
        apiKey: "sk-storyforge",
        baseUrl: null,
        authLabel: "Saved in .storyforge"
      }
    );

    expect(result.nextConfig).toEqual({
      connection: {
        provider: "deepseek",
        authMode: "api",
        apiKey: "sk-storyforge",
        baseUrl: null,
        authLabel: "Saved in .storyforge"
      },
      model: null
    });
    expect(result.message).toContain("Connected deepseek.");
  });

  it("stores a model for the connected provider when /model is applied", () => {
    const result = applyModelCommand(
      {
        connection: {
          provider: "openai",
          authMode: "oauth",
          apiKey: null,
          baseUrl: null,
          authLabel: "ChatGPT Plus/Pro"
        },
        model: null
      },
      "openai/gpt-4o"
    );

    expect("error" in result).toBe(false);
    expect("error" in result ? "" : result.nextConfig.model).toBe("openai/gpt-4o");
  });

  it("renders the persisted model in the shell", () => {
    const app = render(
      <AppShell
        state={createInitialAppState(100, {
          connection: {
            provider: "openai",
            authMode: "oauth",
            apiKey: null,
            baseUrl: null,
            authLabel: "ChatGPT Plus/Pro"
          },
          model: "openai/gpt-4o"
        })}
        terminalWidth={100}
        cwd="/tmp/storyforge"
      />
    );

    expect(app.lastFrame()).toContain("openai/gpt-4o");
    expect(app.lastFrame()).toContain("PERSISTED");
    app.unmount();
  });

  it("shows a command preview when slash commands are being typed", () => {
    const app = render(
      <AppShell
        state={{
          ...createInitialAppState(100),
          inputValue: "/co"
        }}
        terminalWidth={100}
        cwd="/tmp/storyforge"
      />
    );

    expect(app.lastFrame()).toContain("/connect");
    expect(app.lastFrame()).toContain("Connect provider");
    expect(app.lastFrame()).toContain("autocomplete");
    app.unmount();
  });

  it("matches /models in the preview and autocompletes to /models", () => {
    expect(getCommandPreviewItems("/mod")[0]).toEqual({
      command: "/models",
      description: "Switch model",
      action: "models",
      aliases: ["/model"]
    });
    expect(getCommandAutocompleteValue("/mod", 0)).toBe("/models ");
  });

  it("does not show slash-command suggestions when nothing matches", () => {
    expect(getCommandPreviewItems("/foo")).toEqual([]);
    expect(shouldShowCommandPreview("/foo")).toBe(false);
  });

  it("treats unknown slash commands as errors instead of opening the palette", async () => {
    const app = render(
      <App
        terminalWidthOverride={100}
        cwdOverride="/tmp/storyforge"
        initialConfigOverride={{
          connection: null,
          model: null
        }}
      />
    );

    app.stdin.write("/foo");
    await waitForCondition(() => !app.lastFrame().includes("Describe a premise, scene, or character..."));
    expect(app.lastFrame()).not.toContain("tab autocomplete");

    app.stdin.write("\r");
    await waitForCondition(() => app.lastFrame().includes("Unknown command: /foo"));

    expect(app.lastFrame()).toContain("Unknown command: /foo");
    expect(app.lastFrame()).not.toContain("Connect a provider");
    app.unmount();
  });

  it("clears the palette input when /models cannot open yet", async () => {
    const app = render(
      <App
        terminalWidthOverride={100}
        cwdOverride="/tmp/storyforge"
        initialConfigOverride={{
          connection: null,
          model: null
        }}
      />
    );

    app.stdin.write("/models");
    await waitForCondition(() => app.lastFrame().includes("tab autocomplete"));
    expect(app.lastFrame()).toContain("tab autocomplete");

    app.stdin.write("\r");
    await waitForCondition(() => app.lastFrame().includes("Run /connect first."));

    expect(app.lastFrame()).toContain("Run /connect first.");
    expect(app.lastFrame()).not.toContain("/models_");
    expect(app.lastFrame()).not.toContain("tab autocomplete");
    app.unmount();
  });

  it("renders the provider chooser as a modal overlay", () => {
    const app = render(
      <AppShell
        state={openConnectProviderModal(createInitialAppState(100))}
        terminalWidth={100}
        cwd="/tmp/storyforge"
      />
    );

    expect(app.lastFrame()).toContain("Connect a provider");
    expect(app.lastFrame()).toContain("OpenAI");
    expect(app.lastFrame()).not.toContain("SESSION NOTES");
    app.unmount();
  });

  it("filters provider search results and shows an empty state", () => {
    expect(getProviderMatches("zzz")).toEqual([]);

    const app = render(
      <AppShell
        state={{
          ...openConnectProviderModal(createInitialAppState(100)),
          modal: {
            kind: "connect-provider",
            searchValue: "zzz",
            selectedIndex: 0
          }
        }}
        terminalWidth={100}
        cwd="/tmp/storyforge"
      />
    );

    expect(app.lastFrame()).toContain("No matching providers.");
    expect(app.lastFrame()).not.toContain("OpenAI");
    app.unmount();
  });

  it("renders the model chooser as a modal overlay", () => {
    const app = render(
      <AppShell
        state={openModelPickerModal(createInitialAppState(100), "openai", [
          "openai/gpt-5-codex",
          "openai/gpt-5.2"
        ])}
        terminalWidth={100}
        cwd="/tmp/storyforge"
      />
    );

    expect(app.lastFrame()).toContain("Switch model");
    expect(app.lastFrame()).toContain("openai/gpt-5-codex");
    expect(app.lastFrame()).not.toContain("SESSION NOTES");
    app.unmount();
  });

  it("renders the OpenAI auth-method chooser as a modal overlay", () => {
    const app = render(
      <AppShell
        state={openConnectAuthModeModal(createInitialAppState(100), "openai")}
        terminalWidth={100}
        cwd="/tmp/storyforge"
      />
    );

    expect(app.lastFrame()).toContain("ChatGPT Plus/Pro");
    expect(app.lastFrame()).toContain("API key");
    expect(app.lastFrame()).not.toContain("SESSION NOTES");
    app.unmount();
  });

  it("renders the OpenAI oauth modal with browser and headless modes", () => {
    const app = render(
      <AppShell
        state={{
          ...createInitialAppState(100),
          modal: {
            kind: "connect-oauth",
            providerId: "openai",
            flowMode: "headless",
            flowPhase: "idle",
            authUrl: null,
            userCode: null,
            statusMessage: null,
            errorMessage: null
          }
        }}
        terminalWidth={100}
        cwd="/tmp/storyforge"
      />
    );

    expect(app.lastFrame()).toContain("Connect OpenAI");
    expect(app.lastFrame()).toContain("Headless");
    expect(app.lastFrame()).toContain("device-code");
    expect(app.lastFrame()).not.toContain("SESSION NOTES");
    app.unmount();
  });

  it("renders the transcript panel when replies are available", () => {
    const app = render(
      <AppShell
        state={{
          ...createInitialAppState(100),
          transcript: [
            {
              id: "turn-1",
              prompt: "Write a logline.",
              response: "A stranded pilot bargains with a sentient storm.",
              provider: "deepseek",
              model: "deepseek/deepseek-chat",
              failed: false
            },
            {
              id: "turn-2",
              prompt: "Add a second sentence.",
              response: "The sky itself names the price.",
              provider: "deepseek",
              model: "deepseek/deepseek-chat",
              failed: false
            }
          ]
        }}
        terminalWidth={100}
        cwd="/tmp/storyforge"
      />
    );

    expect(app.lastFrame()).toContain("TRANSCRIPT");
    expect(app.lastFrame()).toContain("A stranded pilot bargains");
    expect(app.lastFrame()).toContain("The sky itself names the price.");
    app.unmount();
  });
});
