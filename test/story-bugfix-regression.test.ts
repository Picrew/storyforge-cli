import { describe, expect, it } from "vitest";
import { handleStoryCommand } from "../packages/cli/src/commands/story-commands.js";
import { createBlankStoryProject } from "../packages/cli/src/story/project-store.js";
import { applyPatchWithAgent, runCiWithAgent } from "../packages/cli/src/story/agent-client.js";

function createReadyProject() {
  const project = createBlankStoryProject("2026-03-12T00:00:00.000Z", "Bugfix Story");

  project.meta.status = "ready";
  project.world.premise = "A test world";
  project.world.resolutionShape = "happy ending";
  project.characters.push({
    id: "char-mira",
    name: "Mira",
    role: "Protagonist",
    age: "30",
    description: "",
    motivation: "",
    conflict: "",
    arc: "",
    relationships: "",
    tags: ""
  });
  project.timeline.push({
    id: "beat-1",
    label: "Setup",
    summary: "",
    chapterRef: "ch01",
    stakes: "",
    notes: ""
  });
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

function ctx(project = createReadyProject()) {
  return {
    currentProject: project,
    currentProjectId: "p1",
    projects: []
  };
}

describe("bug 2: /commit --force flag position", () => {
  it("recognizes --force before event text", () => {
    const result = handleStoryCommand(ctx(), {
      command: "/commit",
      args: ["--chapter", "ch01", "--force", "event", "text", "here"]
    });

    expect(result.type).toBe("commit");

    if (result.type !== "commit") {
      throw new Error("Expected commit result.");
    }

    expect(result.chapterId).toBe("ch01");
    expect(result.force).toBe(true);
    expect(result.eventText).toBe("event text here");
  });

  it("recognizes --force after event text", () => {
    const result = handleStoryCommand(ctx(), {
      command: "/commit",
      args: ["--chapter", "ch01", "event", "text", "here", "--force"]
    });

    expect(result.type).toBe("commit");

    if (result.type !== "commit") {
      throw new Error("Expected commit result.");
    }

    expect(result.force).toBe(true);
    expect(result.eventText).toBe("event text here");
  });

  it("does not consume event text when --force is at the beginning", () => {
    const result = handleStoryCommand(ctx(), {
      command: "/commit",
      args: ["--force", "--chapter", "ch02", "Mira", "opens", "the", "door"]
    });

    expect(result.type).toBe("commit");

    if (result.type !== "commit") {
      throw new Error("Expected commit result.");
    }

    expect(result.force).toBe(true);
    expect(result.chapterId).toBe("ch02");
    expect(result.eventText).toBe("Mira opens the door");
  });

  it("recognizes --all as boolean flag in /ci run", () => {
    const result = handleStoryCommand(ctx(), {
      command: "/ci",
      args: ["run", "--all"]
    });

    expect(result.type).toBe("ci");

    if (result.type !== "ci") {
      throw new Error("Expected ci result.");
    }

    expect(result.scope).toBe("all");
  });

  it("recognizes --visual as boolean flag in /log", () => {
    const result = handleStoryCommand(ctx(), {
      command: "/log",
      args: ["--visual", "--chapter", "ch01"]
    });

    expect(result.type).toBe("library");

    if (result.type !== "library") {
      throw new Error("Expected library result.");
    }

    expect(result.response).toContain("Dependency graph:");
  });
});

describe("bug 3: field name case insensitivity", () => {
  it("accepts camelCase for /world set resolutionShape", () => {
    const result = handleStoryCommand(ctx(), {
      command: "/world",
      args: ["set", "resolutionShape", "bittersweet"]
    });

    expect(result.type).toBe("mutate");

    if (result.type !== "mutate") {
      throw new Error("Expected mutate result.");
    }

    expect(result.project.world.resolutionShape).toBe("bittersweet");
  });

  it("accepts lowercase for /world set resolutionshape", () => {
    const result = handleStoryCommand(ctx(), {
      command: "/world",
      args: ["set", "resolutionshape", "open-ended"]
    });

    expect(result.type).toBe("mutate");

    if (result.type !== "mutate") {
      throw new Error("Expected mutate result.");
    }

    expect(result.project.world.resolutionShape).toBe("open-ended");
  });

  it("accepts camelCase for /timeline set chapterRef", () => {
    const result = handleStoryCommand(ctx(), {
      command: "/timeline",
      args: ["set", "1", "chapterRef", "ch03"]
    });

    expect(result.type).toBe("mutate");

    if (result.type !== "mutate") {
      throw new Error("Expected mutate result.");
    }

    expect(result.project.timeline[0].chapterRef).toBe("ch03");
  });

  it("accepts lowercase for /timeline set chapterref", () => {
    const result = handleStoryCommand(ctx(), {
      command: "/timeline",
      args: ["set", "1", "chapterref", "ch04"]
    });

    expect(result.type).toBe("mutate");

    if (result.type !== "mutate") {
      throw new Error("Expected mutate result.");
    }

    expect(result.project.timeline[0].chapterRef).toBe("ch04");
  });

  it("accepts camelCase for /outline set targetWords", () => {
    const result = handleStoryCommand(ctx(), {
      command: "/outline",
      args: ["set", "1", "targetWords", "800"]
    });

    expect(result.type).toBe("mutate");

    if (result.type !== "mutate") {
      throw new Error("Expected mutate result.");
    }

    expect(result.project.outline[0].targetWords).toBe(800);
  });

  it("accepts lowercase for /outline set targetwords", () => {
    const result = handleStoryCommand(ctx(), {
      command: "/outline",
      args: ["set", "1", "targetwords", "900"]
    });

    expect(result.type).toBe("mutate");

    if (result.type !== "mutate") {
      throw new Error("Expected mutate result.");
    }

    expect(result.project.outline[0].targetWords).toBe(900);
  });

  it("accepts camelCase for /char set Motivation", () => {
    const result = handleStoryCommand(ctx(), {
      command: "/char",
      args: ["set", "1", "Motivation", "find the truth"]
    });

    expect(result.type).toBe("mutate");

    if (result.type !== "mutate") {
      throw new Error("Expected mutate result.");
    }

    expect(result.project.characters[0].motivation).toBe("find the truth");
  });
});

describe("bug 4: foreshadow.add empty dueChapter fallback", () => {
  it("falls back dueChapter to current chapter when empty string", async () => {
    const project = createReadyProject();
    const result = await applyPatchWithAgent(
      project,
      "ch03",
      [
        {
          op: "foreshadow.add",
          target: "",
          payload: {
            label: "mysterious note",
            dueChapter: ""
          }
        }
      ],
      [],
      []
    );

    const foreshadow = result.next_state.foreshadows[0];

    expect(foreshadow).toBeTruthy();
    expect(foreshadow.dueChapter).toBe("ch03");
    expect(foreshadow.introducedChapter).toBe("ch03");
  });

  it("uses explicit dueChapter when provided", async () => {
    const project = createReadyProject();
    const result = await applyPatchWithAgent(
      project,
      "ch01",
      [
        {
          op: "foreshadow.add",
          target: "",
          payload: {
            label: "gun on wall",
            dueChapter: "ch05"
          }
        }
      ],
      [],
      []
    );

    const foreshadow = result.next_state.foreshadows[0];

    expect(foreshadow.dueChapter).toBe("ch05");
  });
});

describe("bug 5: Python agent rejects invalid chapter id", () => {
  it("rejects completely invalid chapter id in apply_patch", async () => {
    const project = createReadyProject();

    await expect(
      applyPatchWithAgent(
        project,
        "invalid",
        [
          {
            op: "timeline.add",
            target: "timeline",
            payload: {
              label: "test",
              summary: "test event",
              chapterRef: "ch01"
            }
          }
        ],
        [],
        []
      )
    ).rejects.toThrow("Invalid chapter id");
  });
});

describe("bug 6: /outline add command", () => {
  it("adds a chapter plan with /outline add", () => {
    const result = handleStoryCommand(ctx(), {
      command: "/outline",
      args: ["add", "The", "Final", "Confrontation"]
    });

    expect(result.type).toBe("mutate");

    if (result.type !== "mutate") {
      throw new Error("Expected mutate result.");
    }

    expect(result.project.outline).toHaveLength(3);
    expect(result.project.outline[2].title).toBe("The Final Confrontation");
    expect(result.project.outline[2].number).toBe(3);
  });

  it("assigns correct number after gap in existing outline", () => {
    const project = createReadyProject();
    project.outline[1].number = 5;

    const result = handleStoryCommand(
      { currentProject: project, currentProjectId: "p1", projects: [] },
      { command: "/outline", args: ["add", "New Chapter"] }
    );

    expect(result.type).toBe("mutate");

    if (result.type !== "mutate") {
      throw new Error("Expected mutate result.");
    }

    expect(result.project.outline[2].number).toBe(6);
  });

  it("assigns number 1 when outline is empty", () => {
    const project = createReadyProject();
    project.outline = [];

    const result = handleStoryCommand(
      { currentProject: project, currentProjectId: "p1", projects: [] },
      { command: "/outline", args: ["add", "First Chapter"] }
    );

    expect(result.type).toBe("mutate");

    if (result.type !== "mutate") {
      throw new Error("Expected mutate result.");
    }

    expect(result.project.outline[0].number).toBe(1);
    expect(result.project.outline[0].title).toBe("First Chapter");
  });
});

describe("bug 7: CI warns on invalid timeline chapterRef", () => {
  it("warns when a timeline beat has an invalid chapterRef", async () => {
    const project = createReadyProject();

    project.timeline.push({
      id: "beat-invalid",
      label: "Bad Beat",
      summary: "",
      chapterRef: "invalid",
      stakes: "",
      notes: ""
    });

    const report = await runCiWithAgent(project, "all");

    expect(
      report.ci_report.warnings.some(
        (issue) => issue.rule === "timeline_invalid_ref"
      )
    ).toBe(true);
  });

  it("does not warn on empty chapterRef", async () => {
    const project = createReadyProject();

    project.timeline.push({
      id: "beat-empty",
      label: "Empty Ref Beat",
      summary: "",
      chapterRef: "",
      stakes: "",
      notes: ""
    });

    const report = await runCiWithAgent(project, "all");

    expect(
      report.ci_report.warnings.some(
        (issue) => issue.rule === "timeline_invalid_ref"
      )
    ).toBe(false);
  });

  it("does not warn on valid chapterRef like ch01", async () => {
    const project = createReadyProject();
    const report = await runCiWithAgent(project, "all");

    expect(
      report.ci_report.warnings.some(
        (issue) => issue.rule === "timeline_invalid_ref"
      )
    ).toBe(false);
  });
});
