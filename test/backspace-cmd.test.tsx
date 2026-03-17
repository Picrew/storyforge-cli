import { describe, expect, it } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { App } from "../packages/cli/src/app/App.js";

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

describe("backspace with command preview", () => {
  it("can backspace through slash command input including the leading /", async () => {
    const app = render(
      <App
        terminalWidthOverride={100}
        cwdOverride="/tmp/sf-bs-test"
        initialConfigOverride={{ connection: null, model: null }}
      />
    );

    // Type "/" - command preview shows
    app.stdin.write("/");
    await sleep(50);
    expect(app.lastFrame()).toContain("tab autocomplete");

    // Backspace deletes the "/"
    app.stdin.write("\x08");
    await sleep(50);
    expect(app.lastFrame()).toContain("Describe a premise");
    expect(app.lastFrame()).not.toContain("tab autocomplete");

    // Type "/in" then backspace each char
    app.stdin.write("/in");
    await sleep(50);
    expect(app.lastFrame()).toContain("tab autocomplete");

    app.stdin.write("\x08"); // "/i"
    await sleep(50);
    app.stdin.write("\x08"); // "/"
    await sleep(50);
    app.stdin.write("\x08"); // ""
    await sleep(50);

    expect(app.lastFrame()).toContain("Describe a premise");
    expect(app.lastFrame()).not.toContain("tab autocomplete");
    app.unmount();
  });
});
