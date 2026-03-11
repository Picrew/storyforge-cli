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
    purpose: "",
    summary: "",
    hook: "",
    targetWords: 600
  });
  project.outline.push({
    id: "outline-2",
    number: 2,
    title: "Chapter 2",
    purpose: "",
    summary: "",
    hook: "",
    targetWords: 600
  });

  return project;
}

describe("story v2 command parsing", () => {
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
      message: "Usage: /commit --chapter chNN <event_text> [--force] | /commit --chapter chNN --patch-file <json_path>"
    });
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
});
