import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { AppShell } from "../packages/cli/src/app/AppShell.js";
import { createInitialAppState } from "../packages/cli/src/state/app-state.js";

describe("Header rendering", () => {
  it("renders the hero wordmark on wide terminals", () => {
    const app = render(
      <AppShell state={createInitialAppState(100)} terminalWidth={100} cwd="/tmp/storyforge" />
    );

    expect(app.lastFrame()).toContain("/================");
    expect(app.lastFrame()).toContain("::::  ::::");
    expect(app.lastFrame()).toContain("STORYFORGE // preview build");
    app.unmount();
  });

  it("renders the compact wordmark on medium terminals", () => {
    const app = render(
      <AppShell state={createInitialAppState(80)} terminalWidth={80} cwd="/tmp/storyforge" />
    );

    expect(app.lastFrame()).toContain("> ====");
    expect(app.lastFrame()).toContain("::::");
    expect(app.lastFrame()).not.toContain("/================");
    app.unmount();
  });

  it("renders the minimal wordmark on narrow terminals", () => {
    const app = render(
      <AppShell state={createInitialAppState(60)} terminalWidth={60} cwd="/tmp/storyforge" />
    );

    expect(app.lastFrame()).toContain(":: STORYFORGE ::");
    app.unmount();
  });
});
