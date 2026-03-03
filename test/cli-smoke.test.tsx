import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { App } from "../packages/cli/src/app/App.js";

describe("CLI smoke test", () => {
  it("renders the first frame without crashing", () => {
    const app = render(<App terminalWidthOverride={100} cwdOverride="/tmp/storyforge" />);

    expect(app.lastFrame()).toContain("STORYFORGE // preview build");
    expect(app.lastFrame()).toContain("Describe a premise, scene, or character...");
    app.unmount();
  });
});
