import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { homedir } from "node:os";
import { join } from "node:path";
import { AppShell } from "../packages/cli/src/app/AppShell.js";
import { createInitialAppState } from "../packages/cli/src/state/app-state.js";

describe("Footer layout", () => {
  it("renders the wide footer with three sections", () => {
    const cwd = join(homedir(), "Downloads", "storyforge");
    const app = render(<AppShell state={createInitialAppState(100)} terminalWidth={100} cwd={cwd} />);

    expect(app.lastFrame()).toContain("~/Downloads/storyforge");
    expect(app.lastFrame()).toContain("ready");
    expect(app.lastFrame()).toContain("story workspace");
    app.unmount();
  });

  it("renders the compact footer on narrow terminals", () => {
    const app = render(
      <AppShell state={createInitialAppState(60)} terminalWidth={60} cwd="/tmp/storyforge" />
    );

    expect(app.lastFrame()).toContain("ready | storyforge");
    app.unmount();
  });
});
