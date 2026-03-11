import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createStoryProject,
  createBlankStoryProject,
  getStoryProjectAbsolutePath,
  getStoryProjectPath,
  loadStoryWorkspace,
  loadStoryProject,
  saveStoryProject,
  setActiveStoryProject
} from "../packages/cli/src/story/project-store.js";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "storyforge-store-"));
}

describe("story project store", () => {
  it("creates and saves the blank project schema", () => {
    const cwd = makeTempDir();
    const project = createBlankStoryProject("2026-03-04T00:00:00.000Z");
    const createResult = createStoryProject(cwd, project);
    const workspace = loadStoryWorkspace(cwd);

    expect(createResult.error).toBeNull();
    expect(project).toEqual({
      version: 2,
      meta: {
        title: "Untitled Story",
        status: "empty",
        createdAt: "2026-03-04T00:00:00.000Z",
        updatedAt: "2026-03-04T00:00:00.000Z"
      },
      brief: {
        seedPrompt: "",
        genre: "",
        targetWords: null,
        language: "English",
        tone: "",
        premise: ""
      },
      world: {
        premise: "",
        setting: "",
        tone: "",
        rules: "",
        stakes: "",
        resolutionShape: ""
      },
      characters: [],
      timeline: [],
      outline: [],
      eventCommits: [],
      inventory: [],
      foreshadows: [],
      dependencyGraph: {
        edges: [],
        updatedAt: "2026-03-04T00:00:00.000Z"
      },
      chapterRenders: [],
      ciHistory: [],
      dirtyChapters: []
    });
    expect(workspace.activeProjectId).toBe(createResult.projectId);
    expect(workspace.projects).toHaveLength(1);
    expect(loadStoryProject(cwd)).toEqual(project);
  });

  it("returns an empty workspace when no project exists", () => {
    const cwd = makeTempDir();
    const workspace = loadStoryWorkspace(cwd);

    expect(workspace.activeProjectId).toBeNull();
    expect(workspace.projects).toEqual([]);
    expect(loadStoryProject(cwd)).toBeNull();
  });

  it("throws when the story project file is malformed", () => {
    const cwd = makeTempDir();
    const projectPath = getStoryProjectPath(cwd);

    fs.mkdirSync(path.dirname(projectPath), { recursive: true });
    fs.writeFileSync(projectPath, "{not json}\n", "utf8");

    expect(() => loadStoryProject(cwd)).toThrow();
  });

  it("auto-migrates a legacy v1 project into v2 fields", () => {
    const cwd = makeTempDir();
    const legacyPath = getStoryProjectPath(cwd);
    const legacyProject = {
      version: 1,
      meta: {
        title: "Legacy Story",
        status: "ready",
        createdAt: "2026-03-04T00:00:00.000Z",
        updatedAt: "2026-03-04T00:00:00.000Z"
      },
      brief: {
        seedPrompt: "legacy prompt",
        genre: "mystery",
        targetWords: 1500,
        language: "English",
        tone: "tense",
        premise: "legacy premise"
      },
      world: {
        premise: "legacy world",
        setting: "city",
        tone: "noir",
        rules: "strict",
        stakes: "high",
        resolutionShape: "twist"
      },
      characters: [],
      timeline: [],
      outline: []
    };

    fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
    fs.writeFileSync(legacyPath, `${JSON.stringify(legacyProject, null, 2)}\n`, "utf8");

    const loaded = loadStoryProject(cwd);

    expect(loaded?.version).toBe(2);
    expect(loaded?.meta.title).toBe("Legacy Story");
    expect(loaded?.world.premise).toBe("legacy world");
    expect(loaded?.eventCommits).toEqual([]);
    expect(loaded?.inventory).toEqual([]);
    expect(loaded?.foreshadows).toEqual([]);
    expect(loaded?.chapterRenders).toEqual([]);
  });

  it("preserves prior generated sections when the project is saved again", () => {
    const cwd = makeTempDir();
    const project = createBlankStoryProject("2026-03-04T00:00:00.000Z");

    project.characters.push({
      id: "char-1",
      name: "Mira Vale",
      role: "Protagonist",
      age: "",
      description: "",
      motivation: "",
      conflict: "",
      arc: "",
      relationships: "",
      tags: ""
    });
    project.timeline.push({
      id: "beat-1",
      label: "Opening",
      summary: "A public disaster begins.",
      chapterRef: "1",
      stakes: "Reputation",
      notes: ""
    });
    const createResult = createStoryProject(cwd, project);

    if (!createResult.projectId) {
      throw new Error("Expected project id.");
    }

    const loaded = loadStoryProject(cwd);

    expect(loaded?.characters).toHaveLength(1);
    expect(loaded?.timeline[0]?.label).toBe("Opening");
  });

  it("tracks and switches between multiple saved projects", () => {
    const cwd = makeTempDir();
    const firstProject = createBlankStoryProject("2026-03-04T00:00:00.000Z", "First Draft");
    const secondProject = createBlankStoryProject("2026-03-04T00:00:01.000Z", "Second Draft");
    const firstResult = createStoryProject(cwd, firstProject);
    const secondResult = createStoryProject(cwd, secondProject);

    if (!firstResult.projectId || !secondResult.projectId) {
      throw new Error("Expected created project ids.");
    }

    expect(loadStoryWorkspace(cwd).projects).toHaveLength(2);
    expect(loadStoryProject(cwd)?.meta.title).toBe("Second Draft");
    expect(setActiveStoryProject(cwd, firstResult.projectId)).toBeNull();
    expect(loadStoryProject(cwd)?.meta.title).toBe("First Draft");

    firstProject.world.premise = "Updated first premise";
    firstProject.meta.updatedAt = "2026-03-04T00:10:00.000Z";
    expect(saveStoryProject(cwd, firstProject, firstResult.projectId)).toBeNull();

    const workspace = loadStoryWorkspace(cwd);
    const firstEntry = workspace.projects.find((entry) => entry.id === firstResult.projectId);

    expect(firstEntry?.title).toBe("First Draft");
    expect(firstEntry?.updatedAt).toBe("2026-03-04T00:10:00.000Z");
    expect(
      fs.existsSync(getStoryProjectAbsolutePath(cwd, secondResult.projectId, workspace.projects))
    ).toBe(true);
  });
});
