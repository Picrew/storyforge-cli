import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

type FakeChild = EventEmitter & {
  stdout: PassThrough;
  stderr: PassThrough;
};

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn()
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock
}));

vi.mock("../packages/cli/src/utils/opencode-auth.js", () => ({
  getStoryforgeOpencodeDataDir: () => "/tmp/storyforge-opencode-test"
}));

import { runStructuredPrompt } from "../packages/cli/src/story/structured-run.js";
import { startOpencodeStream } from "../packages/cli/src/utils/opencode-run.js";

function createFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  return child;
}

describe("opencode process error handling", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it("surfaces JSON error events from streaming chat runs", async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const onError = vi.fn();
    const onComplete = vi.fn();

    startOpencodeStream({
      cwd: "/tmp/storyforge-opencode-stream",
      model: "deepseek/deepseek-chat",
      prompt: "hello",
      onError,
      onComplete
    });

    child.stdout.write(
      `${JSON.stringify({ type: "error", error: { message: "Unable to connect." } })}\n`
    );
    child.emit("close", 0);

    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(onError).toHaveBeenCalledWith("Unable to connect.");
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("rejects structured runs when opencode emits a JSON error event", async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);

    const promise = runStructuredPrompt({
      cwd: "/tmp/storyforge-opencode-structured",
      model: "deepseek/deepseek-chat",
      prompt: "hello",
      stage: "foundation"
    });

    child.stdout.write(
      `${JSON.stringify({ type: "error", error: { message: "Unable to connect." } })}\n`
    );
    child.emit("close", 0);

    await expect(promise).rejects.toThrow("Unable to connect.");
  });
});
