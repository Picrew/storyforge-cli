import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createBlankStoryProject,
  createStoryProject,
  loadStoryProject
} from "../packages/cli/src/story/project-store.js";
import { runStoryTask } from "../packages/cli/src/story/bootstrap.js";
import {
  countStoryWords,
  runChapterValidationRepairGate,
  runStoryValidationRepairGate,
  validateStoryProject
} from "../packages/cli/src/story/story-validation.js";
import type { StructuredRunner } from "../packages/cli/src/story/structured-run.js";

function createValidProject() {
  const project = createBlankStoryProject(undefined, "Validated Story");
  project.brief.seedPrompt = "A continuity test.";
  project.world.premise = "A clockwork archive records every promise.";
  project.world.setting = "The archive";
  project.characters = [{
    id: "mira",
    name: "Mira",
    role: "Archivist",
    age: "",
    description: "",
    motivation: "",
    conflict: "",
    arc: "",
    relationships: "",
    tags: ""
  }];
  project.timeline = [{
    id: "beat-1",
    label: "Discovery",
    summary: "Mira finds a broken promise.",
    chapterRef: "ch01",
    stakes: "",
    notes: ""
  }];
  project.outline = [{
    id: "outline-1",
    number: 1,
    title: "Broken Promise",
    purpose: "Begin the mystery",
    summary: "Mira investigates the archive.",
    hook: "The record names her.",
    targetWords: 100
  }];
  return project;
}

function createBootstrapRunner(calls: string[]): StructuredRunner {
  return async ({ stage }) => {
    calls.push(stage);
    if (stage === "foundation") {
      return JSON.stringify({
        title: "Recovered Story",
        premise: "An archive records every promise.",
        world: {
          premise: "An archive records every promise.",
          setting: "A clockwork archive"
        }
      });
    }
    if (stage === "characters") {
      return JSON.stringify({
        characters: [{ name: "Mira", role: "Archivist" }]
      });
    }
    if (stage === "timeline") {
      return JSON.stringify({
        timeline: [{
          label: "Discovery",
          summary: "Mira finds a broken promise.",
          chapterRef: "Chapter 1"
        }]
      });
    }
    if (stage === "outline") {
      return JSON.stringify({
        outline: [{
          number: 1,
          title: "Broken Promise",
          summary: "Mira investigates the archive.",
          targetWords: 100
        }]
      });
    }
    throw new Error(`Unexpected stage: ${stage}`);
  };
}

describe("story validation and repair gate", () => {
  it("checks chapter attribution, character rules, facts, words, and foreshadow state", () => {
    const project = createValidProject();
    project.characters.push({ ...project.characters[0], id: "mira-2" });
    project.timeline.push({
      ...project.timeline[0],
      id: "beat-2",
      summary: "A contradictory discovery.",
      chapterRef: "chapter two"
    });
    project.foreshadows.push({
      id: "f1",
      label: "Locked door",
      introducedChapter: "ch02",
      dueChapter: "ch01",
      resolvedChapter: "ch01",
      status: "open",
      notes: ""
    });

    const report = validateStoryProject(project, {
      chapterTexts: { ch01: "Too short." }
    });
    const categories = new Set(report.issues.map((issue) => issue.category));

    expect(report.passed).toBe(false);
    expect(categories).toEqual(new Set([
      "chapter_attribution",
      "fact_conflict",
      "word_count",
      "character_rule",
      "foreshadow_state"
    ]));
  });

  it("reruns only the section that failed validation", async () => {
    const project = createValidProject();
    project.timeline[0].chapterRef = "chapter one";
    const stages: string[] = [];
    const runner: StructuredRunner = async ({ stage }) => {
      stages.push(stage);
      return JSON.stringify({
        timeline: [{
          ...project.timeline[0],
          chapterRef: "ch01"
        }]
      });
    };

    const result = await runStoryValidationRepairGate(project, {
      cwd: fs.mkdtempSync(path.join(os.tmpdir(), "storyforge-validation-")),
      model: "deepseek/deepseek-v4-flash",
      runner
    });

    expect(result.report.passed).toBe(true);
    expect(result.repairedTargets).toEqual(["timeline"]);
    expect(stages).toEqual(["repair-timeline"]);
    expect(result.project.characters).toEqual(project.characters);
  });

  it("repairs a failed chapter without regenerating other chapters", async () => {
    const project = createValidProject();
    const runner: StructuredRunner = async () => "word ".repeat(100);
    const result = await runChapterValidationRepairGate({
      cwd: fs.mkdtempSync(path.join(os.tmpdir(), "storyforge-chapter-gate-")),
      model: "deepseek/deepseek-v4-flash",
      project,
      chapterId: "ch01",
      text: "short",
      runner
    });

    expect(result.report.passed).toBe(true);
    expect(result.repairAttempts).toBe(1);
    expect(countStoryWords(result.text)).toBe(100);
  });

  it("resumes only unfinished stages from a persistent checkpoint", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "storyforge-resume-"));
    const seed = createValidProject();
    seed.characters = [];
    seed.timeline = [];
    seed.outline = [];
    const created = createStoryProject(cwd, seed);
    if (!created.projectId) {
      throw new Error("Expected project id.");
    }
    const firstCalls: string[] = [];
    const baseRunner = createBootstrapRunner(firstCalls);
    const failed = await runStoryTask({
      cwd,
      projectId: created.projectId,
      model: "deepseek/deepseek-v4-flash",
      project: seed,
      runner: async (options) => {
        if (options.stage === "outline") {
          throw new Error("outline unavailable");
        }
        return baseRunner(options);
      },
      scope: "all",
      maxStageAttempts: 1
    });

    const resumedCalls: string[] = [];
    const resumed = await runStoryTask({
      cwd,
      projectId: created.projectId,
      model: "deepseek/deepseek-v4-flash",
      project: loadStoryProject(cwd, created.projectId)!,
      runner: createBootstrapRunner(resumedCalls),
      scope: "all",
      taskId: failed.taskCheckpoint?.id,
      resume: true
    });

    expect(failed.taskCheckpoint?.completedStages).toEqual([
      "foundation",
      "characters",
      "timeline"
    ]);
    expect(resumed.ok).toBe(true);
    expect(resumedCalls).toEqual(["outline"]);
    expect(resumed.project.timeline[0]?.chapterRef).toBe("ch01");
    expect(resumed.taskCheckpoint?.status).toBe("completed");
  });

  it("marks a cancelled stage checkpoint as resumable", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "storyforge-cancel-"));
    const seed = createValidProject();
    const created = createStoryProject(cwd, seed);
    if (!created.projectId) {
      throw new Error("Expected project id.");
    }
    const controller = new AbortController();
    const runner: StructuredRunner = async ({ signal }) =>
      await new Promise<string>((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          const error = new Error("cancelled");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
        setTimeout(() => controller.abort("test cancellation"), 10);
      });
    const result = await runStoryTask({
      cwd,
      projectId: created.projectId,
      model: "deepseek/deepseek-v4-flash",
      project: seed,
      runner,
      scope: "all",
      abortSignal: controller.signal
    });

    expect(result.taskCheckpoint?.status).toBe("cancelled");
    expect(result.taskCheckpoint?.currentStage).toBe("foundation");
    expect(fs.existsSync(result.taskCheckpoint?.checkpointPath ?? "")).toBe(true);
  });
});
