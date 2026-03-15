import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { AppShell } from "../packages/cli/src/app/AppShell.js";
import { createInitialAppState } from "../packages/cli/src/state/app-state.js";
import type { TranscriptEntry } from "../packages/cli/src/types.js";

function makeEntry(overrides: Partial<TranscriptEntry> & { id: string }): TranscriptEntry {
  return {
    prompt: "/compile all",
    response: "Compiled 3 chapters",
    provider: "storyforge",
    model: "story/compile",
    failed: false,
    streaming: false,
    ...overrides
  };
}

describe("Status indicator", () => {
  it("shows done on completed Build entry when no pending task", () => {
    const state = {
      ...createInitialAppState(100),
      transcript: [makeEntry({ id: "t1" })],
      pendingTask: null
    };

    const app = render(
      <AppShell state={state} terminalWidth={100} cwd="/tmp/storyforge" />
    );
    const frame = app.lastFrame()!;

    expect(frame).toContain("story/compile");
    expect(frame).toContain("done");
    expect(frame).toContain("TRANSCRIPT");
    app.unmount();
  });

  it("shows running status on Build entry when task is pending", () => {
    const state = {
      ...createInitialAppState(100),
      transcript: [makeEntry({ id: "t2", response: "Compiling 8 chapter(s)..." })],
      pendingTask: { kind: "story-compile" as const, stage: "ch01,ch02" }
    };

    const app = render(
      <AppShell state={state} terminalWidth={100} cwd="/tmp/storyforge" />
    );
    const frame = app.lastFrame()!;

    expect(frame).toContain("running");
    expect(frame).toContain("RUNNING TRANSCRIPT");
    app.unmount();
  });

  it("shows failed on failed Build entry", () => {
    const state = {
      ...createInitialAppState(100),
      transcript: [makeEntry({ id: "t3", response: "Error: no story project", failed: true })],
      pendingTask: null
    };

    const app = render(
      <AppShell state={state} terminalWidth={100} cwd="/tmp/storyforge" />
    );
    const frame = app.lastFrame()!;

    expect(frame).toContain("failed");
    app.unmount();
  });

  it("shows task status in footer when pending", () => {
    const state = {
      ...createInitialAppState(100),
      transcript: [makeEntry({ id: "t4", response: "Compiling..." })],
      pendingTask: { kind: "story-compile" as const, stage: null }
    };

    const app = render(
      <AppShell state={state} terminalWidth={100} cwd="/tmp/storyforge" />
    );
    const frame = app.lastFrame()!;

    expect(frame).toContain("compile running");
    expect(frame).not.toContain("preview mode");
    app.unmount();
  });

  it("shows preview mode in footer when idle", () => {
    const state = {
      ...createInitialAppState(100),
      transcript: [makeEntry({ id: "t5", response: "Done" })],
      pendingTask: null
    };

    const app = render(
      <AppShell state={state} terminalWidth={100} cwd="/tmp/storyforge" />
    );
    const frame = app.lastFrame()!;

    expect(frame).toContain("preview mode");
    app.unmount();
  });
});
