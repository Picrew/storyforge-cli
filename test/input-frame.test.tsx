import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { AppShell } from "../packages/cli/src/app/AppShell.js";
import {
  appendInputCharacter,
  createInitialAppState,
  deleteInputCharacter,
  submitInput
} from "../packages/cli/src/state/app-state.js";

describe("Input frame interactions", () => {
  it("shows the placeholder when the input is empty", () => {
    const app = render(
      <AppShell state={createInitialAppState(100)} terminalWidth={100} cwd="/tmp/storyforge" />
    );

    expect(app.lastFrame()).toContain("Describe a premise, scene, or character...");
    app.unmount();
  });

  it("supports input edits and shows the preview notice on submit", () => {
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

    state = submitInput(state, 1_000);
    app = render(<AppShell state={state} terminalWidth={100} cwd="/tmp/storyforge" />);
    expect(app.lastFrame()).toContain("UI preview only. Story actions are not implemented yet.");
    expect(app.lastFrame()).toContain("Describe a premise, scene, or character...");
    app.unmount();
  });
});
