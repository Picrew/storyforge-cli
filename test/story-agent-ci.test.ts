import { describe, expect, it } from "vitest";
import { createBlankStoryProject } from "../packages/cli/src/story/project-store.js";
import { runCiWithAgent } from "../packages/cli/src/story/agent-client.js";

function createBaseProject() {
  const project = createBlankStoryProject("2026-03-12T00:00:00.000Z", "CI Story");

  project.meta.status = "ready";
  project.characters.push({
    id: "char-mira",
    name: "Mira",
    role: "Protagonist",
    age: "",
    description: "",
    motivation: "",
    conflict: "",
    arc: "",
    relationships: "",
    tags: ""
  });
  project.outline.push({
    id: "outline-1",
    number: 1,
    title: "One",
    purpose: "",
    summary: "",
    hook: "",
    targetWords: 600
  });
  project.outline.push({
    id: "outline-2",
    number: 2,
    title: "Two",
    purpose: "",
    summary: "",
    hook: "",
    targetWords: 600
  });
  project.timeline.push({
    id: "beat-1",
    label: "Setup",
    summary: "",
    chapterRef: "ch01",
    stakes: "",
    notes: ""
  });
  project.timeline.push({
    id: "beat-2",
    label: "Payoff",
    summary: "",
    chapterRef: "ch02",
    stakes: "",
    notes: ""
  });
  project.inventory.push({
    id: "item-ledger",
    name: "Ledger",
    holders: {
      world: 1
    },
    total: 1,
    status: "active",
    notes: ""
  });
  project.eventCommits.push({
    id: "commit-1",
    chapterId: "ch01",
    createdAt: "2026-03-12T00:00:00.000Z",
    message: "setup",
    patchOps: [],
    reads: ["character:char-mira", "world:premise", "item:item-ledger"],
    writes: ["timeline"],
    forced: false,
    ciPassed: true,
    ciReport: null
  });

  return project;
}

describe("story agent CI rules", () => {
  it("passes a coherent state", async () => {
    const report = await runCiWithAgent(createBaseProject(), "all");

    expect(report.ci_report.passed).toBe(true);
    expect(report.ci_report.errors).toHaveLength(0);
  });

  it("treats null commit ids as latest commit in commit scope", async () => {
    const report = await runCiWithAgent(createBaseProject(), "commit", null);

    expect(report.ci_report.passed).toBe(true);
    expect(report.ci_report.errors.some((issue) => issue.message.includes("Unknown commit id"))).toBe(false);
  });

  it("flags timeline regressions", async () => {
    const project = createBaseProject();

    project.timeline[1].chapterRef = "ch01";
    project.timeline[0].chapterRef = "ch02";

    const report = await runCiWithAgent(project, "all");

    expect(report.ci_report.passed).toBe(false);
    expect(report.ci_report.errors.some((issue) => issue.rule === "timeline_monotonic")).toBe(true);
  });

  it("flags missing entity references", async () => {
    const project = createBaseProject();

    project.eventCommits[0].reads.push("character:ghost");

    const report = await runCiWithAgent(project, "all");

    expect(report.ci_report.passed).toBe(false);
    expect(report.ci_report.errors.some((issue) => issue.rule === "entity_exists")).toBe(true);
  });

  it("flags inventory conservation violations", async () => {
    const project = createBaseProject();

    project.inventory[0].total = 3;

    const report = await runCiWithAgent(project, "all");

    expect(report.ci_report.passed).toBe(false);
    expect(report.ci_report.errors.some((issue) => issue.rule === "inventory_conservation")).toBe(true);
  });

  it("warns on overdue unresolved foreshadows", async () => {
    const project = createBaseProject();

    project.foreshadows.push({
      id: "hook-1",
      label: "Knife on wall",
      introducedChapter: "ch01",
      dueChapter: "ch01",
      resolvedChapter: null,
      status: "open",
      notes: ""
    });

    const report = await runCiWithAgent(project, "all");

    expect(report.ci_report.warnings.some((issue) => issue.rule === "foreshadow_due")).toBe(true);
  });
});
