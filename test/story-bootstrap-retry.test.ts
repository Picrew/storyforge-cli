import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runStoryTask } from "../packages/cli/src/story/bootstrap.js";
import { createBlankStoryProject } from "../packages/cli/src/story/project-store.js";
import type { StructuredRunner } from "../packages/cli/src/story/structured-run.js";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "storyforge-bootstrap-retry-"));
}

function createSeedProject() {
  const project = createBlankStoryProject("2026-03-12T00:00:00.000Z", "Retry Story");
  project.meta.status = "awaiting_brief";
  project.brief.seedPrompt = "Write a short mystery with strict continuity.";
  project.meta.status = "bootstrapping";
  return project;
}

function createRetryRunner(options: {
  malformedCharactersAttempts: number;
}): {
  runner: StructuredRunner;
  calls: Record<string, number>;
} {
  const calls: Record<string, number> = {};

  const runner: StructuredRunner = async ({ stage }) => {
    calls[stage] = (calls[stage] ?? 0) + 1;

    switch (stage) {
      case "foundation":
        return JSON.stringify({
          title: "Retry Story",
          genre: "Mystery",
          targetWords: 1200,
          language: "English",
          tone: "Tense",
          premise: "An archivist traces a missing document.",
          world: {
            premise: "A library where records vanish overnight.",
            setting: "A modern city archive",
            tone: "Tense",
            rules: "Records can only move through signed transfers.",
            stakes: "If the records disappear, a legal case collapses.",
            resolutionShape: "Evidence restores order."
          }
        });
      case "characters":
        if (calls[stage] <= options.malformedCharactersAttempts) {
          return '{"characters":[{"name":"Mira"}';
        }

        return JSON.stringify({
          characters: [
            {
              name: "Mira",
              role: "Protagonist",
              age: "30",
              description: "Archivist",
              motivation: "Find the missing file",
              conflict: "No one believes her timeline",
              arc: "Learns to trust one ally",
              relationships: "Relies on her mentor",
              tags: "focused, anxious"
            }
          ]
        });
      case "timeline":
        return JSON.stringify({
          timeline: [
            {
              label: "Missing file",
              summary: "A file disappears before court.",
              chapterRef: "ch01",
              stakes: "Case may collapse.",
              notes: ""
            }
          ]
        });
      case "outline":
        return JSON.stringify({
          outline: [
            {
              number: 1,
              title: "Opening",
              purpose: "Introduce the missing file",
              summary: "Mira discovers a transfer mismatch.",
              hook: "A second signature appears overnight.",
              targetWords: 600
            }
          ]
        });
      default:
        throw new Error(`Unhandled stage: ${stage}`);
    }
  };

  return {
    runner,
    calls
  };
}

describe("story bootstrap retries", () => {
  it("retries malformed stage output and succeeds", async () => {
    const cwd = makeTempDir();
    const { runner, calls } = createRetryRunner({
      malformedCharactersAttempts: 1
    });
    const result = await runStoryTask({
      cwd,
      model: "deepseek/deepseek-chat",
      project: createSeedProject(),
      runner,
      scope: "all"
    });

    expect(result.ok).toBe(true);
    expect(result.failedStage).toBe(null);
    expect(calls.foundation).toBe(1);
    expect(calls.characters).toBe(2);
    expect(calls.timeline).toBe(1);
    expect(calls.outline).toBe(1);
  });

  it("fails after max attempts when malformed output persists", async () => {
    const cwd = makeTempDir();
    const { runner, calls } = createRetryRunner({
      malformedCharactersAttempts: 10
    });
    const result = await runStoryTask({
      cwd,
      model: "deepseek/deepseek-chat",
      project: createSeedProject(),
      runner,
      scope: "all"
    });

    expect(result.ok).toBe(false);
    expect(result.failedStage).toBe("characters");
    expect(calls.foundation).toBe(1);
    expect(calls.characters).toBe(3);
    expect(calls.timeline ?? 0).toBe(0);
  });
});
