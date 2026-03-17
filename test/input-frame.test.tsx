import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
import { handleStoryCommand } from "../packages/cli/src/commands/story-commands.js";
import { getProviderMatches } from "../packages/cli/src/data/provider-catalog.js";
import { AppShell } from "../packages/cli/src/app/AppShell.js";
import { createBlankStoryProject } from "../packages/cli/src/story/project-store.js";
import {
  appendInputCharacter,
  createInitialAppState,
  deleteInputCharacter,
  deleteForwardInputCharacter,
  moveInputCursor,
  moveInputCursorToStart,
  moveInputCursorToEnd,
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

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "storyforge-input-"));
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
    expect(app.lastFrame()).toContain("Plot");
    app.unmount();

    state = deleteInputCharacter(state);
    app = render(<AppShell state={state} terminalWidth={100} cwd="/tmp/storyforge" />);
    expect(app.lastFrame()).toContain("Plo");
    expect(app.lastFrame()).not.toContain("Plot");
    app.unmount();
  });

  it("supports cursor movement and editing at arbitrary positions", () => {
    let state = createInitialAppState(100);
    // Type "hello"
    state = appendInputCharacter(state, "hello");
    expect(state.inputValue).toBe("hello");
    expect(state.inputCursorPosition).toBe(5);

    // Move cursor left 2 positions
    state = moveInputCursor(state, -2);
    expect(state.inputCursorPosition).toBe(3);

    // Delete character before cursor (backspace) — removes 'l'
    state = deleteInputCharacter(state);
    expect(state.inputValue).toBe("helo");
    expect(state.inputCursorPosition).toBe(2);

    // Insert 'X' at cursor position
    state = appendInputCharacter(state, "X");
    expect(state.inputValue).toBe("heXlo");
    expect(state.inputCursorPosition).toBe(3);

    // Delete forward (removes 'l')
    state = deleteForwardInputCharacter(state);
    expect(state.inputValue).toBe("heXo");
    expect(state.inputCursorPosition).toBe(3);

    // Move to start
    state = moveInputCursorToStart(state);
    expect(state.inputCursorPosition).toBe(0);

    // Move to end
    state = moveInputCursorToEnd(state);
    expect(state.inputCursorPosition).toBe(4);

    // Can't go past end
    state = moveInputCursor(state, 1);
    expect(state.inputCursorPosition).toBe(4);

    // Can't go before start
    state = moveInputCursorToStart(state);
    state = moveInputCursor(state, -1);
    expect(state.inputCursorPosition).toBe(0);

    // Backspace at position 0 does nothing
    const unchanged = deleteInputCharacter(state);
    expect(unchanged.inputValue).toBe("heXo");
    expect(unchanged.inputCursorPosition).toBe(0);
  });

  it("handles CJK characters in cursor operations", () => {
    let state = createInitialAppState(100);
    state = appendInputCharacter(state, "你好世界");
    expect(state.inputCursorPosition).toBe(4);

    state = moveInputCursor(state, -2);
    expect(state.inputCursorPosition).toBe(2);

    state = appendInputCharacter(state, "的");
    expect(state.inputValue).toBe("你好的世界");
    expect(state.inputCursorPosition).toBe(3);

    state = deleteInputCharacter(state);
    expect(state.inputValue).toBe("你好世界");
    expect(state.inputCursorPosition).toBe(2);
  });

  it("handles paste (multi-character append) at cursor position", () => {
    let state = createInitialAppState(100);
    state = appendInputCharacter(state, "AC");
    expect(state.inputValue).toBe("AC");
    expect(state.inputCursorPosition).toBe(2);

    // Move to middle
    state = moveInputCursor(state, -1);
    expect(state.inputCursorPosition).toBe(1);

    // Paste "XY" at cursor
    state = appendInputCharacter(state, "XY");
    expect(state.inputValue).toBe("AXYC");
    expect(state.inputCursorPosition).toBe(3);
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

  it("renders the command preview below the prompt lane", () => {
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

    const frame = app.lastFrame() ?? "";

    expect(frame.indexOf("PROMPT LANE")).toBeGreaterThan(-1);
    expect(frame.indexOf("tab autocomplete")).toBeGreaterThan(frame.indexOf("PROMPT LANE"));
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

  it("autocompletes /char and /timeline from partial input", () => {
    expect(getCommandAutocompleteValue("/cha", 0)).toBe("/char ");
    expect(getCommandAutocompleteValue("/tim", 0)).toBe("/timeline ");
    expect(getCommandAutocompleteValue("/proj", 0)).toBe("/projects ");
  });

  it("does not show slash-command suggestions when nothing matches", () => {
    expect(getCommandPreviewItems("/foo")).toEqual([]);
    expect(shouldShowCommandPreview("/foo")).toBe(false);
  });

  it("shows story commands in the slash-command palette", () => {
    const app = render(
      <AppShell
        state={{
          ...createInitialAppState(100),
          inputValue: "/"
        }}
        terminalWidth={100}
        cwd="/tmp/storyforge"
      />
    );

    const frame = app.lastFrame() ?? "";

    expect(frame).toContain("/init");
    expect(frame).toContain("/projects");
    expect(frame).toContain("/world");
    expect(frame).toContain("/char");
    expect(frame).toContain("/timeline");
    expect(frame).toContain("/outline");
    app.unmount();
  });

  it("supports story table view commands and mutations", () => {
    let project = createBlankStoryProject();
    project.meta.status = "awaiting_brief";
    const storyContext = () => ({
      currentProject: project,
      currentProjectId: "project-1",
      projects: [
        {
          id: "project-1",
          title: project.meta.title,
          status: project.meta.status,
          createdAt: project.meta.createdAt,
          updatedAt: project.meta.updatedAt,
          file: "projects/project-1.json"
        }
      ]
    });
    project.outline.push({
      id: "outline-1",
      number: 1,
      title: "Draft",
      purpose: "",
      summary: "",
      hook: "",
      targetWords: 400
    });

    const worldView = handleStoryCommand(storyContext(), {
      command: "/world",
      args: []
    });
    expect(worldView).toMatchObject({
      type: "view",
      activeView: "world"
    });

    const worldSet = handleStoryCommand(storyContext(), {
      command: "/world",
      args: ["set", "premise", "Comic", "chaos"]
    });
    expect(worldSet.type).toBe("mutate");
    project = worldSet.type === "mutate" ? worldSet.project : project;
    expect(project.world.premise).toBe("Comic chaos");

    const charAdd = handleStoryCommand(storyContext(), {
      command: "/char",
      args: ["add", "Mira", "Vale"]
    });
    expect(charAdd.type).toBe("mutate");
    project = charAdd.type === "mutate" ? charAdd.project : project;
    expect(project.characters[0]?.name).toBe("Mira Vale");

    const charSet = handleStoryCommand(storyContext(), {
      command: "/char",
      args: ["set", "1", "role", "Protagonist"]
    });
    expect(charSet.type).toBe("mutate");
    project = charSet.type === "mutate" ? charSet.project : project;
    expect(project.characters[0]?.role).toBe("Protagonist");

    const timelineAdd = handleStoryCommand(storyContext(), {
      command: "/timeline",
      args: ["add", "Lobby", "reveal"]
    });
    expect(timelineAdd.type).toBe("mutate");
    project = timelineAdd.type === "mutate" ? timelineAdd.project : project;
    expect(project.timeline[0]?.label).toBe("Lobby reveal");

    const timelineSet = handleStoryCommand(storyContext(), {
      command: "/timeline",
      args: ["set", "1", "stakes", "Funding", "risk"]
    });
    expect(timelineSet.type).toBe("mutate");
    project = timelineSet.type === "mutate" ? timelineSet.project : project;
    expect(project.timeline[0]?.stakes).toBe("Funding risk");

    const outlineSet = handleStoryCommand(storyContext(), {
      command: "/outline",
      args: ["set", "1", "title", "Opening", "Pitch"]
    });
    expect(outlineSet.type).toBe("mutate");
    project = outlineSet.type === "mutate" ? outlineSet.project : project;
    expect(project.outline[0]?.title).toBe("Opening Pitch");
  });

  it("shows helpful errors for invalid story edits", () => {
    const project = createBlankStoryProject();
    project.meta.status = "awaiting_brief";
    const storyContext = {
      currentProject: project,
      currentProjectId: "project-1",
      projects: [
        {
          id: "project-1",
          title: project.meta.title,
          status: project.meta.status,
          createdAt: project.meta.createdAt,
          updatedAt: project.meta.updatedAt,
          file: "projects/project-1.json"
        }
      ]
    };
    project.characters.push({
      id: "char-1",
      name: "Mira",
      role: "",
      age: "",
      description: "",
      motivation: "",
      conflict: "",
      arc: "",
      relationships: "",
      tags: ""
    });

    expect(
      handleStoryCommand(storyContext, {
        command: "/char",
        args: ["set", "9", "role", "Ghost"]
      })
    ).toEqual({
      type: "notice",
      message: "Character row is out of range."
    });

    expect(
      handleStoryCommand(storyContext, {
        command: "/world",
        args: ["set", "mystery", "nope"]
      })
    ).toEqual({
      type: "notice",
      message: "Unknown world field: mystery"
    });
  });

  it("treats unknown slash commands as errors instead of opening the palette", async () => {
    const cwd = makeTempDir();
    const app = render(
      <App
        terminalWidthOverride={100}
        cwdOverride={cwd}
        initialConfigOverride={{
          connection: null,
          model: null
        }}
      />
    );

    app.stdin.write("/foo");
    await waitForCondition(() => !(app.lastFrame() ?? "").includes("Describe a premise, scene, or character..."));
    expect(app.lastFrame()).not.toContain("tab autocomplete");

    app.stdin.write("\r");
    await waitForCondition(() => (app.lastFrame() ?? "").includes("Unknown command: /foo"));

    expect(app.lastFrame()).toContain("Unknown command: /foo");
    expect(app.lastFrame()).not.toContain("Connect a provider");
    app.unmount();
  });

  it("clears the palette input when /models cannot open yet", async () => {
    const cwd = makeTempDir();
    const app = render(
      <App
        terminalWidthOverride={100}
        cwdOverride={cwd}
        initialConfigOverride={{
          connection: null,
          model: null
        }}
      />
    );

    app.stdin.write("/models");
    await waitForCondition(() => (app.lastFrame() ?? "").includes("tab autocomplete"));
    expect(app.lastFrame()).toContain("tab autocomplete");

    app.stdin.write("\r");
    await waitForCondition(() => (app.lastFrame() ?? "").includes("Run /connect first."));

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
