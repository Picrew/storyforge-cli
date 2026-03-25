import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

type FakeChild = EventEmitter & {
  stdout: PassThrough;
  stderr: PassThrough;
};

const { spawnMock, fetchMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  fetchMock: vi.fn()
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock
}));

vi.mock("../packages/cli/src/utils/opencode-auth.js", () => ({
  getStoryforgeOpencodeDataDir: () => "/tmp/storyforge-opencode-test"
}));

vi.mock("../packages/cli/src/utils/provider-api.js", () => ({
  getProviderApiKey: () => "test-key",
  getProviderCompletionUrl: () => "https://api.test.local/v1/chat/completions",
  getModelProvider: (model: string) => model.split("/")[0] || null,
  stripProviderPrefix: (model: string) => model.includes("/") ? model.slice(model.indexOf("/") + 1) : model
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
    fetchMock.mockReset();
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

  it("rejects structured runs when the provider API returns an error", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: "Unable to connect." } })
    });

    try {
      await expect(
        runStructuredPrompt({
          cwd: "/tmp/storyforge-structured",
          model: "deepseek/deepseek-chat",
          prompt: "hello",
          stage: "foundation"
        })
      ).rejects.toThrow("Unable to connect.");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
