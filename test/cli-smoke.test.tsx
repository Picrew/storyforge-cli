import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { App } from "../packages/cli/src/app/App.js";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "storyforge-smoke-"));
}

describe("CLI smoke test", () => {
  it("renders the first frame without crashing", () => {
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

    expect(app.lastFrame()).toContain("STORYFORGE // preview build");
    expect(app.lastFrame()).toContain("Describe a premise, scene, or character...");
    expect(app.lastFrame()).toContain("run /connect");
    app.unmount();
  });
});
