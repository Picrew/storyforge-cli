import { describe, expect, it } from "vitest";
import { handleStoryCommand } from "../packages/cli/src/commands/story-commands.js";
import { createBlankStoryProject } from "../packages/cli/src/story/project-store.js";

function createReadyProject() {
  const project = createBlankStoryProject("2026-03-12T00:00:00.000Z", "V2 Story");
  project.meta.status = "ready";
  project.outline.push({
    id: "outline-1",
    number: 1,
    title: "Chapter 1",
    purpose: "Introduce the protagonist",
    summary: "Mira arrives at the conference and meets a stranger.",
    hook: "The stranger knows her name.",
    targetWords: 600
  });
  project.outline.push({
    id: "outline-2",
    number: 2,
    title: "Chapter 2",
    purpose: "Raise the stakes",
    summary: "Mira discovers the stranger's true identity.",
    hook: "",
    targetWords: 600
  });

  return project;
}

describe("story v2 command parsing", () => {
  it("parses /init --dir and returns dir in create result", () => {
    const result = handleStoryCommand(
      { currentProject: null, currentProjectId: null, projects: [] },
      { command: "/init", args: ["--dir", "~/novels/my-story"] }
    );

    expect(result.type).toBe("create");

    if (result.type !== "create") {
      throw new Error("Expected create result.");
    }

    expect(result.dir).toBe("~/novels/my-story");
    expect(result.project.meta.status).toBe("awaiting_brief");
    expect(result.message).toContain("~/novels/my-story");
  });

  it("returns no dir field for plain /init", () => {
    const result = handleStoryCommand(
      { currentProject: null, currentProjectId: null, projects: [] },
      { command: "/init", args: [] }
    );

    expect(result.type).toBe("create");

    if (result.type !== "create") {
      throw new Error("Expected create result.");
    }

    expect(result.dir).toBeUndefined();
  });

  it("opens interactive picker for /project with saved projects", () => {
    const project = createReadyProject();
    const result = handleStoryCommand(
      {
        currentProject: project,
        currentProjectId: "p1",
        projects: [
          {
            id: "p1",
            title: project.meta.title,
            status: project.meta.status,
            createdAt: project.meta.createdAt,
            updatedAt: project.meta.updatedAt,
            file: "projects/p1.json"
          }
        ]
      },
      { command: "/project", args: [] }
    );

    expect(result).toEqual({
      type: "project-picker",
      message: "Select a project with ↑↓ and Enter."
    });
  });

  it("opens interactive picker for /projects with saved projects", () => {
    const project = createReadyProject();
    const result = handleStoryCommand(
      {
        currentProject: project,
        currentProjectId: "p1",
        projects: [
          {
            id: "p1",
            title: project.meta.title,
            status: project.meta.status,
            createdAt: project.meta.createdAt,
            updatedAt: project.meta.updatedAt,
            file: "projects/p1.json"
          }
        ]
      },
      { command: "/projects", args: [] }
    );

    expect(result).toEqual({
      type: "project-picker",
      message: "Select a project with ↑↓ and Enter."
    });
  });

  it("keeps text library output on /projects list", () => {
    const project = createReadyProject();
    const result = handleStoryCommand(
      {
        currentProject: project,
        currentProjectId: "p1",
        projects: [
          {
            id: "p1",
            title: project.meta.title,
            status: project.meta.status,
            createdAt: project.meta.createdAt,
            updatedAt: project.meta.updatedAt,
            file: "projects/p1.json"
          }
        ]
      },
      { command: "/projects", args: ["list"] }
    );

    expect(result.type).toBe("library");
  });

  it("parses /commit with required chapter and force flag", () => {
    const result = handleStoryCommand(
      {
        currentProject: createReadyProject(),
        currentProjectId: "p1",
        projects: []
      },
      {
        command: "/commit",
        args: ["--chapter", "ch03", "Mira", "finds", "the", "ledger", "--force"]
      }
    );

    expect(result.type).toBe("commit");

    if (result.type !== "commit") {
      throw new Error("Expected commit result.");
    }

    expect(result.chapterId).toBe("ch03");
    expect(result.force).toBe(true);
    expect(result.patchFilePath).toBeNull();
    expect(result.eventText).toBe("Mira finds the ledger");
  });

  it("accepts /commit patch-file mode", () => {
    const result = handleStoryCommand(
      {
        currentProject: createReadyProject(),
        currentProjectId: "p1",
        projects: []
      },
      {
        command: "/commit",
        args: ["--chapter", "ch01", "--patch-file", "./patches/ch01.json"]
      }
    );

    expect(result.type).toBe("commit");

    if (result.type !== "commit") {
      throw new Error("Expected commit result.");
    }

    expect(result.chapterId).toBe("ch01");
    expect(result.patchFilePath).toBe("./patches/ch01.json");
    expect(result.eventText).toBe("");
  });

  it("validates /commit chapter flag", () => {
    const result = handleStoryCommand(
      {
        currentProject: createReadyProject(),
        currentProjectId: "p1",
        projects: []
      },
      {
        command: "/commit",
        args: ["missing", "chapter", "flag"]
      }
    );

    expect(result).toEqual({
      type: "notice",
      message: "Usage: /commit --chapter chNN [event_text] [--force] | /commit --chapter chNN --patch-file <json_path>"
    });
  });

  it("falls back to outline summary when no event text is given", () => {
    const result = handleStoryCommand(
      {
        currentProject: createReadyProject(),
        currentProjectId: "p1",
        projects: []
      },
      {
        command: "/commit",
        args: ["--chapter", "ch01"]
      }
    );

    expect(result.type).toBe("commit");

    if (result.type !== "commit") {
      throw new Error("Expected commit result.");
    }

    expect(result.chapterId).toBe("ch01");
    expect(result.eventText).toContain("Mira arrives at the conference");
    expect(result.eventText).toContain("Introduce the protagonist");
    expect(result.eventText).toContain("The stranger knows her name.");
  });

  it("shows error when no event text and no outline for the chapter", () => {
    const result = handleStoryCommand(
      {
        currentProject: createReadyProject(),
        currentProjectId: "p1",
        projects: []
      },
      {
        command: "/commit",
        args: ["--chapter", "ch99"]
      }
    );

    expect(result.type).toBe("notice");

    if (result.type !== "notice") {
      throw new Error("Expected notice result.");
    }

    expect(result.message).toContain("No outline found");
  });

  it("parses /ci run with commit scope", () => {
    const result = handleStoryCommand(
      {
        currentProject: createReadyProject(),
        currentProjectId: "p1",
        projects: []
      },
      {
        command: "/ci",
        args: ["run", "--commit", "abc123"]
      }
    );

    expect(result.type).toBe("ci");

    if (result.type !== "ci") {
      throw new Error("Expected ci result.");
    }

    expect(result.scope).toBe("commit");
    expect(result.commitId).toBe("abc123");
  });

  it("parses /render chapter range and /compile all", () => {
    const context = {
      currentProject: createReadyProject(),
      currentProjectId: "p1",
      projects: []
    };
    const renderResult = handleStoryCommand(context, {
      command: "/render",
      args: ["ch01..ch02", "--style", "noir"]
    });
    const compileResult = handleStoryCommand(context, {
      command: "/compile",
      args: ["all", "--output", ".storyforge/manuscript/story.md"]
    });

    expect(renderResult.type).toBe("render");
    expect(compileResult.type).toBe("compile");

    if (renderResult.type !== "render" || compileResult.type !== "compile") {
      throw new Error("Unexpected command result.");
    }

    expect(renderResult.chapterIds).toEqual(["ch01", "ch02"]);
    expect(renderResult.style).toBe("noir");
    expect(compileResult.chapterIds).toEqual(["ch01", "ch02"]);
    expect(compileResult.outputPath).toBe(".storyforge/manuscript/story.md");
  });

  it("parses scoped validation with failed-section repair", () => {
    const result = handleStoryCommand(
      {
        currentProject: createReadyProject(),
        currentProjectId: "p1",
        projects: []
      },
      {
        command: "/validate",
        args: ["ch01..ch02", "--repair"]
      }
    );

    expect(result.type).toBe("validate");
    if (result.type !== "validate") {
      throw new Error("Expected validate result.");
    }
    expect(result.chapterIds).toEqual(["ch01", "ch02"]);
    expect(result.repair).toBe(true);
  });
});
