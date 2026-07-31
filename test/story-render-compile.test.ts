import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createBlankStoryProject } from "../packages/cli/src/story/project-store.js";
import {
  compileStoryChapters,
  renderStoryChapters
} from "../packages/cli/src/story/simulation.js";
import type { StructuredRunner } from "../packages/cli/src/story/structured-run.js";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "storyforge-render-"));
}

function chapterIdFromNumber(chapterNumber: number): string {
  return `ch${String(chapterNumber).padStart(2, "0")}`;
}

function createProjectForRender(chapterCount: number = 1) {
  const project = createBlankStoryProject("2026-03-12T00:00:00.000Z", "Render Story");

  project.meta.status = "ready";
  project.brief.seedPrompt = "A test story";

  for (let chapterNumber = 1; chapterNumber <= chapterCount; chapterNumber += 1) {
    const chapterId = chapterIdFromNumber(chapterNumber);

    project.outline.push({
      id: `outline-${chapterNumber}`,
      number: chapterNumber,
      title: `Chapter ${chapterNumber}`,
      purpose: "",
      summary: "",
      hook: "",
      targetWords: 600
    });
    project.eventCommits.push({
      id: `commit-${chapterNumber}`,
      chapterId,
      createdAt: "2026-03-12T00:00:00.000Z",
      message: "A key reveal happens",
      patchOps: [
        {
          op: "timeline.add",
          target: "timeline",
          payload: {
            label: "Reveal",
            summary: "A key reveal happens",
            chapterRef: chapterId,
            stakes: "High",
            notes: ""
          }
        }
      ],
      reads: ["world:premise"],
      writes: ["timeline"],
      forced: false,
      ciPassed: true,
      ciReport: null
    });
    project.dirtyChapters.push(chapterId);
  }

  return project;
}

describe("story render and compile", () => {
  it("isolates chapter and manuscript artifacts by project id", async () => {
    const cwd = makeTempDir();
    const firstProject = createProjectForRender();
    const secondProject = createProjectForRender();
    const runner: StructuredRunner = async ({ prompt }) =>
      prompt.includes("First Project") ? "First project prose" : "Second project prose";

    firstProject.meta.title = "First Project";
    secondProject.meta.title = "Second Project";

    await renderStoryChapters({
      cwd,
      projectId: "project-a",
      model: "deepseek/deepseek-v4-flash",
      project: firstProject,
      chapterIds: ["ch01"],
      style: null,
      force: true,
      runner
    });
    await renderStoryChapters({
      cwd,
      projectId: "project-b",
      model: "deepseek/deepseek-v4-flash",
      project: secondProject,
      chapterIds: ["ch01"],
      style: null,
      force: true,
      runner
    });

    const firstCompile = compileStoryChapters({
      cwd,
      projectId: "project-a",
      project: firstProject,
      chapterIds: ["ch01"],
      outputPath: null
    });
    const secondCompile = compileStoryChapters({
      cwd,
      projectId: "project-b",
      project: secondProject,
      chapterIds: ["ch01"],
      outputPath: null
    });

    expect(fs.readFileSync(firstCompile.outputPath, "utf8")).toContain("First project prose");
    expect(fs.readFileSync(secondCompile.outputPath, "utf8")).toContain("Second project prose");
    expect(firstCompile.outputPath).not.toBe(secondCompile.outputPath);
  });

  it("does not create a title-only manuscript when every chapter is missing", () => {
    const cwd = makeTempDir();
    const result = compileStoryChapters({
      cwd,
      projectId: "empty-project",
      project: createProjectForRender(),
      chapterIds: ["ch01"],
      outputPath: null
    });

    expect(result.wroteOutput).toBe(false);
    expect(result.compiledChapters).toEqual([]);
    expect(fs.existsSync(result.outputPath)).toBe(false);
  });

  it("migrates legacy chapter artifacts once into the owning project", () => {
    const cwd = makeTempDir();
    const project = createProjectForRender();
    const legacyChapterPath = path.join(cwd, ".storyforge", "chapters", "ch01.md");
    fs.mkdirSync(path.dirname(legacyChapterPath), { recursive: true });
    fs.writeFileSync(legacyChapterPath, "Legacy project prose.\n", "utf8");
    fs.mkdirSync(path.join(cwd, ".storyforge", "logs"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".storyforge", "logs", "legacy.log"), "legacy log\n", "utf8");
    fs.mkdirSync(path.join(cwd, ".storyforge", "cache"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".storyforge", "cache", "legacy.json"), "{}\n", "utf8");
    project.chapterRenders.push({
      chapterId: "ch01",
      file: "chapters/ch01.md",
      renderedAt: "2026-03-12T00:00:00.000Z",
      model: "deepseek/deepseek-chat",
      commitIds: ["commit-1"],
      dirty: false
    });

    const result = compileStoryChapters({
      cwd,
      projectId: "migrated-project",
      project,
      chapterIds: ["ch01"],
      outputPath: null
    });
    const migratedChapterPath = path.join(
      cwd,
      ".storyforge",
      "artifacts",
      "migrated-project",
      "chapters",
      "ch01.md"
    );
    const markerPath = path.join(
      cwd,
      ".storyforge",
      "artifacts",
      "migrated-project",
      "cache",
      "artifact-migration-v1.json"
    );

    expect(result.wroteOutput).toBe(true);
    expect(fs.readFileSync(migratedChapterPath, "utf8")).toContain("Legacy project prose");
    expect(fs.existsSync(markerPath)).toBe(true);
    expect(project.chapterRenders[0].file).toBe(
      "artifacts/migrated-project/chapters/ch01.md"
    );
    expect(fs.existsSync(legacyChapterPath)).toBe(true);
    expect(fs.existsSync(path.join(
      cwd,
      ".storyforge",
      "artifacts",
      "migrated-project",
      "logs",
      "legacy.log"
    ))).toBe(true);
    expect(fs.existsSync(path.join(
      cwd,
      ".storyforge",
      "artifacts",
      "migrated-project",
      "cache",
      "legacy.json"
    ))).toBe(true);
  });

  it("does not finalize migration when no legacy source exists", () => {
    const cwd = makeTempDir();
    const project = createProjectForRender();
    project.chapterRenders.push({
      chapterId: "ch01",
      file: "chapters/ch01.md",
      renderedAt: "2026-03-12T00:00:00.000Z",
      model: "deepseek/deepseek-chat",
      commitIds: ["commit-1"],
      dirty: false
    });

    compileStoryChapters({
      cwd,
      projectId: "missing-legacy",
      project,
      chapterIds: ["ch01"],
      outputPath: null
    });

    expect(fs.existsSync(path.join(
      cwd,
      ".storyforge",
      "artifacts",
      "missing-legacy",
      "cache",
      "artifact-migration-v1.json"
    ))).toBe(false);
  });

  it("renders dirty chapters to markdown files and updates metadata", async () => {
    const cwd = makeTempDir();
    const runner: StructuredRunner = async ({ stage }) =>
      `Rendered chapter output for ${stage}`;
    const renderResult = await renderStoryChapters({
      cwd,
      model: "deepseek/deepseek-chat",
      project: createProjectForRender(),
      chapterIds: ["ch01"],
      style: "noir",
      force: false,
      runner
    });
    const chapterPath = path.join(cwd, ".storyforge", "chapters", "ch01.md");

    expect(renderResult.rendered).toEqual(["ch01"]);
    expect(renderResult.skipped).toEqual([]);
    expect(fs.existsSync(chapterPath)).toBe(true);
    expect(fs.readFileSync(chapterPath, "utf8")).toContain("Rendered chapter output");
    expect(renderResult.project.chapterRenders.find((entry) => entry.chapterId === "ch01")).toBeTruthy();
    expect(renderResult.project.dirtyChapters).toEqual([]);
  });

  it("skips clean chapters unless force is provided", async () => {
    const cwd = makeTempDir();
    const runner: StructuredRunner = async ({ stage }) =>
      `Rendered chapter output for ${stage}`;
    const firstPass = await renderStoryChapters({
      cwd,
      model: "deepseek/deepseek-chat",
      project: createProjectForRender(),
      chapterIds: ["ch01"],
      style: null,
      force: false,
      runner
    });
    const secondPass = await renderStoryChapters({
      cwd,
      model: "deepseek/deepseek-chat",
      project: firstPass.project,
      chapterIds: ["ch01"],
      style: null,
      force: false,
      runner
    });

    expect(secondPass.rendered).toEqual([]);
    expect(secondPass.skipped).toEqual(["ch01"]);
  });

  it("compiles rendered chapters into a manuscript file", async () => {
    const cwd = makeTempDir();
    const project = createProjectForRender();
    const runner: StructuredRunner = async ({ stage }) =>
      `Rendered chapter output for ${stage}`;
    const rendered = await renderStoryChapters({
      cwd,
      model: "deepseek/deepseek-chat",
      project,
      chapterIds: ["ch01"],
      style: null,
      force: false,
      runner
    });
    const compileResult = compileStoryChapters({
      cwd,
      project: rendered.project,
      chapterIds: ["ch01", "ch02"],
      outputPath: null
    });

    expect(compileResult.compiledChapters).toEqual(["ch01"]);
    expect(compileResult.missingChapters).toEqual(["ch02"]);
    expect(fs.existsSync(compileResult.outputPath)).toBe(true);
    expect(fs.readFileSync(compileResult.outputPath, "utf8")).toContain("## CH01");
  });

  it("respects render max concurrency while rendering multiple chapters", async () => {
    const cwd = makeTempDir();
    let activeRuns = 0;
    let observedMaxActiveRuns = 0;
    const runner: StructuredRunner = async ({ stage }) => {
      activeRuns += 1;
      observedMaxActiveRuns = Math.max(observedMaxActiveRuns, activeRuns);
      await new Promise((resolve) => setTimeout(resolve, 30));
      activeRuns -= 1;
      return `Rendered chapter output for ${stage}`;
    };
    const renderResult = await renderStoryChapters({
      cwd,
      model: "deepseek/deepseek-chat",
      project: createProjectForRender(3),
      chapterIds: ["ch01", "ch02", "ch03"],
      style: null,
      force: false,
      runner,
      maxConcurrency: 2
    });

    expect(renderResult.rendered).toEqual(["ch01", "ch02", "ch03"]);
    expect(observedMaxActiveRuns).toBeLessThanOrEqual(2);
    expect(observedMaxActiveRuns).toBeGreaterThan(1);
  });

  it("removes accidental chapter headings from rendered output", async () => {
    const cwd = makeTempDir();
    const runner: StructuredRunner = async () =>
      "# 第一章 风暴前夜\n\n海风穿过防波堤，潮声如雷。";
    const renderResult = await renderStoryChapters({
      cwd,
      model: "deepseek/deepseek-chat",
      project: createProjectForRender(),
      chapterIds: ["ch01"],
      style: null,
      force: false,
      runner
    });
    const chapterPath = path.join(cwd, ".storyforge", "chapters", "ch01.md");
    const chapterText = fs.readFileSync(chapterPath, "utf8");

    expect(renderResult.rendered).toEqual(["ch01"]);
    expect(chapterText).not.toContain("# 第一章");
    expect(chapterText).toContain("海风穿过防波堤");
  });
});
