import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../packages/cli/src/story/structured-run.js";
import type { TranscriptEntry } from "../packages/cli/src/types.js";

function buildChatHistory(transcript: readonly TranscriptEntry[]): ChatMessage[] {
  return transcript
    .filter(
      (entry) =>
        !entry.failed &&
        entry.response &&
        entry.provider !== "storyforge"
    )
    .flatMap((entry) => [
      { role: "user" as const, content: entry.prompt },
      { role: "assistant" as const, content: entry.response }
    ]);
}

function makeEntry(overrides: Partial<TranscriptEntry> & { id: string }): TranscriptEntry {
  return {
    prompt: "hello",
    response: "Hi there!",
    provider: "openrouter",
    model: "openrouter/stepfun/step-3.5-flash:free",
    failed: false,
    streaming: false,
    ...overrides
  };
}

describe("Multi-turn chat history", () => {
  it("builds history from successful transcript entries", () => {
    const transcript: TranscriptEntry[] = [
      makeEntry({ id: "t1", prompt: "hello", response: "Hi!" }),
      makeEntry({ id: "t2", prompt: "how are you?", response: "I'm good!" })
    ];

    const history = buildChatHistory(transcript);

    expect(history).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "Hi!" },
      { role: "user", content: "how are you?" },
      { role: "assistant", content: "I'm good!" }
    ]);
  });

  it("excludes failed entries from history", () => {
    const transcript: TranscriptEntry[] = [
      makeEntry({ id: "t1", prompt: "hello", response: "Hi!" }),
      makeEntry({ id: "t2", prompt: "bad request", response: "Error", failed: true }),
      makeEntry({ id: "t3", prompt: "try again", response: "Ok!" })
    ];

    const history = buildChatHistory(transcript);

    expect(history).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "Hi!" },
      { role: "user", content: "try again" },
      { role: "assistant", content: "Ok!" }
    ]);
  });

  it("excludes storyforge provider entries from history", () => {
    const transcript: TranscriptEntry[] = [
      makeEntry({ id: "t1", prompt: "hello", response: "Hi!" }),
      makeEntry({ id: "t2", prompt: "/init", response: "Story created", provider: "storyforge", model: "story/project" }),
      makeEntry({ id: "t3", prompt: "continue", response: "Sure!" })
    ];

    const history = buildChatHistory(transcript);

    expect(history).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "Hi!" },
      { role: "user", content: "continue" },
      { role: "assistant", content: "Sure!" }
    ]);
  });

  it("excludes entries with empty responses", () => {
    const transcript: TranscriptEntry[] = [
      makeEntry({ id: "t1", prompt: "hello", response: "Hi!" }),
      makeEntry({ id: "t2", prompt: "pending", response: "" })
    ];

    const history = buildChatHistory(transcript);

    expect(history).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "Hi!" }
    ]);
  });

  it("returns empty array when transcript is empty", () => {
    const history = buildChatHistory([]);
    expect(history).toEqual([]);
  });
});
