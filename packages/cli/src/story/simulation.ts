import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  applyPatchWithAgent,
  buildImpactWithAgent,
  planPatchWithAgent,
  runCiWithAgent
} from "./agent-client.js";
import { normalizeChapterId } from "./chapter-id.js";
import {
  buildChapterRenderPrompt,
  buildCommitPatchPrompt
} from "./prompt-catalog.js";
import { parseStructuredJson, type StructuredRunner } from "./structured-run.js";
import type { EventPatchOp, StoryCiReport, StoryProject } from "./types.js";

interface PlannedPatchPayload {
  patchOps?: unknown;
  reads?: unknown;
  writes?: unknown;
}

interface ResolvedPatchPayload {
  patchOps: EventPatchOp[];
  reads: string[];
  writes: string[];
}

function cloneProject(project: StoryProject): StoryProject {
  return {
    ...project,
    meta: { ...project.meta },
    brief: { ...project.brief },
    world: { ...project.world },
    characters: project.characters.map((entry) => ({ ...entry })),
    timeline: project.timeline.map((entry) => ({ ...entry })),
    outline: project.outline.map((entry) => ({ ...entry })),
    eventCommits: project.eventCommits.map((entry) => ({
      ...entry,
      patchOps: entry.patchOps.map((op) => ({
        ...op,
        payload: { ...op.payload }
      })),
      reads: [...entry.reads],
      writes: [...entry.writes],
      ciReport: entry.ciReport
        ? {
            ...entry.ciReport,
            errors: entry.ciReport.errors.map((issue) => ({ ...issue })),
            warnings: entry.ciReport.warnings.map((issue) => ({ ...issue }))
          }
        : null
    })),
    inventory: project.inventory.map((entry) => ({
      ...entry,
      holders: { ...entry.holders }
    })),
    foreshadows: project.foreshadows.map((entry) => ({ ...entry })),
    dependencyGraph: {
      ...project.dependencyGraph,
      edges: project.dependencyGraph.edges.map((edge) => ({ ...edge }))
    },
    chapterRenders: project.chapterRenders.map((entry) => ({
      ...entry,
      commitIds: [...entry.commitIds]
    })),
    ciHistory: project.ciHistory.map((entry) => ({
      ...entry,
      errors: entry.errors.map((issue) => ({ ...issue })),
      warnings: entry.warnings.map((issue) => ({ ...issue }))
    })),
    dirtyChapters: [...project.dirtyChapters]
  };
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry) => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizePatchOps(value: unknown): EventPatchOp[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry) => Boolean(entry) && typeof entry === "object")
    .map((entry) => {
      const row = entry as Record<string, unknown>;

      return {
        op: typeof row.op === "string" ? row.op.trim() : "",
        target: typeof row.target === "string" ? row.target.trim() : "",
        payload: row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
          ? (row.payload as Record<string, unknown>)
          : {}
      };
    })
    .filter((entry) => Boolean(entry.op));
}

async function resolvePatchPayloadFromModel(
  options: {
    cwd: string;
    model: string;
    project: StoryProject;
    chapterId: string;
    eventText: string;
    runner: StructuredRunner;
  }
): Promise<ResolvedPatchPayload> {
  const raw = await options.runner({
    cwd: options.cwd,
    model: options.model,
    prompt: buildCommitPatchPrompt(options.project, options.chapterId, options.eventText),
    stage: "commit-patch"
  });

  try {
    const parsed = parseStructuredJson<PlannedPatchPayload>(raw);
    const patchOps = normalizePatchOps(parsed.patchOps);

    if (patchOps.length > 0) {
      return {
        patchOps,
        reads: asStringArray(parsed.reads),
        writes: asStringArray(parsed.writes)
      };
    }
  } catch {
    // Fall back to python-side planning below.
  }

  const fallback = await planPatchWithAgent(options.project, options.chapterId, options.eventText);

  return {
    patchOps: normalizePatchOps(fallback.patch_ops),
    reads: asStringArray(fallback.reads),
    writes: asStringArray(fallback.writes)
  };
}

function resolvePatchPayloadFromFile(patchFilePath: string): ResolvedPatchPayload {
  const raw = fs.readFileSync(patchFilePath, "utf8");
  const parsed = JSON.parse(raw) as PlannedPatchPayload | EventPatchOp[];

  if (Array.isArray(parsed)) {
    return {
      patchOps: normalizePatchOps(parsed),
      reads: [],
      writes: []
    };
  }

  return {
    patchOps: normalizePatchOps(parsed.patchOps),
    reads: asStringArray(parsed.reads),
    writes: asStringArray(parsed.writes)
  };
}

export interface CommitStoryEventOptions {
  cwd: string;
  model: string;
  project: StoryProject;
  chapterId: string;
  eventText: string;
  patchFilePath: string | null;
  force: boolean;
  runner: StructuredRunner;
}

export interface CommitStoryEventResult {
  ok: boolean;
  project: StoryProject;
  message: string;
  ciReport: StoryCiReport | null;
}

function summarizeCiReport(report: StoryCiReport): string {
  const errorText = report.errors.length > 0 ? `${report.errors.length} error(s)` : "no errors";
  const warningText = report.warnings.length > 0 ? `${report.warnings.length} warning(s)` : "no warnings";
  return `${report.passed ? "pass" : "fail"} (${errorText}, ${warningText})`;
}

export async function commitStoryEvent(options: CommitStoryEventOptions): Promise<CommitStoryEventResult> {
  const normalizedChapterId = normalizeChapterId(options.chapterId);

  if (!normalizedChapterId) {
    throw new Error("Invalid chapter id.");
  }

  const baseProject = cloneProject(options.project);
  const patchPayload = options.patchFilePath
    ? resolvePatchPayloadFromFile(options.patchFilePath)
    : await resolvePatchPayloadFromModel({
        cwd: options.cwd,
        model: options.model,
        project: baseProject,
        chapterId: normalizedChapterId,
        eventText: options.eventText,
        runner: options.runner
      });

  if (patchPayload.patchOps.length === 0) {
    throw new Error("No patch operations were produced.");
  }

  const applyResult = await applyPatchWithAgent(
    baseProject,
    normalizedChapterId,
    patchPayload.patchOps,
    patchPayload.reads,
    patchPayload.writes
  );
  const patchedProject = cloneProject(applyResult.next_state);
  const ciResult = await runCiWithAgent(patchedProject, "commit");
  const ciReport = ciResult.ci_report;

  if (!ciReport.passed && !options.force) {
    return {
      ok: false,
      project: options.project,
      message: `Commit blocked by CI: ${summarizeCiReport(ciReport)}`,
      ciReport
    };
  }

  const commitId = randomUUID();
  patchedProject.eventCommits.push({
    id: commitId,
    chapterId: normalizedChapterId,
    createdAt: new Date().toISOString(),
    message: options.eventText || `Patch from ${path.basename(options.patchFilePath || "")}`,
    patchOps: applyResult.patch_ops,
    reads: applyResult.reads,
    writes: applyResult.writes,
    forced: options.force,
    ciPassed: ciReport.passed,
    ciReport
  });
  patchedProject.ciHistory.push(ciReport);

  const impactResult = await buildImpactWithAgent(patchedProject);
  const nextProject = cloneProject(impactResult.next_state);
  nextProject.meta.updatedAt = new Date().toISOString();
  nextProject.meta.status = ciReport.passed ? "ready" : "partial";

  return {
    ok: true,
    project: nextProject,
    message: `Committed ${normalizedChapterId} as ${commitId.slice(0, 8)} (CI ${summarizeCiReport(ciReport)}).`,
    ciReport
  };
}

export interface RunStoryCiOptions {
  project: StoryProject;
  scope?: "all" | "commit";
  commitId?: string | null;
}

export async function runStoryCi(options: RunStoryCiOptions): Promise<{
  project: StoryProject;
  report: StoryCiReport;
}> {
  const project = cloneProject(options.project);
  const ciResult = await runCiWithAgent(project, options.scope ?? "all", options.commitId ?? null);

  project.ciHistory.push(ciResult.ci_report);
  project.meta.updatedAt = new Date().toISOString();
  project.meta.status = ciResult.ci_report.passed ? "ready" : "partial";

  return {
    project,
    report: ciResult.ci_report
  };
}

function getChaptersDirectory(cwd: string): string {
  return path.join(cwd, ".storyforge", "chapters");
}

export interface RenderStoryChaptersOptions {
  cwd: string;
  model: string;
  project: StoryProject;
  chapterIds: readonly string[];
  style: string | null;
  force: boolean;
  runner: StructuredRunner;
}

export interface RenderStoryChaptersResult {
  project: StoryProject;
  rendered: string[];
  skipped: string[];
}

function upsertChapterRender(project: StoryProject, chapterId: string, model: string, commitIds: string[], file: string): void {
  const renderedAt = new Date().toISOString();
  const existingIndex = project.chapterRenders.findIndex((entry) => normalizeChapterId(entry.chapterId) === chapterId);
  const nextEntry = {
    chapterId,
    file,
    renderedAt,
    model,
    commitIds,
    dirty: false
  };

  if (existingIndex >= 0) {
    project.chapterRenders[existingIndex] = nextEntry;
    return;
  }

  project.chapterRenders.push(nextEntry);
}

export async function renderStoryChapters(options: RenderStoryChaptersOptions): Promise<RenderStoryChaptersResult> {
  const project = cloneProject(options.project);
  const rendered: string[] = [];
  const skipped: string[] = [];
  const chaptersDir = getChaptersDirectory(options.cwd);

  fs.mkdirSync(chaptersDir, { recursive: true });

  for (const token of options.chapterIds) {
    const chapterId = normalizeChapterId(token);

    if (!chapterId) {
      continue;
    }

    const isDirty = project.dirtyChapters.some((entry) => normalizeChapterId(entry) === chapterId);

    if (!isDirty && !options.force) {
      skipped.push(chapterId);
      continue;
    }

    const chapterPatchOps = project.eventCommits
      .filter((entry) => normalizeChapterId(entry.chapterId) === chapterId)
      .flatMap((entry) => entry.patchOps);
    const prompt = buildChapterRenderPrompt(project, chapterId, chapterPatchOps, options.style || undefined);
    const chapterText = await options.runner({
      cwd: options.cwd,
      model: options.model,
      prompt,
      stage: `render-${chapterId}`
    });
    const chapterPath = path.join(chaptersDir, `${chapterId}.md`);

    fs.writeFileSync(chapterPath, `${chapterText.trim()}\n`, "utf8");
    upsertChapterRender(
      project,
      chapterId,
      options.model,
      project.eventCommits
        .filter((entry) => normalizeChapterId(entry.chapterId) === chapterId)
        .map((entry) => entry.id),
      path.relative(path.join(options.cwd, ".storyforge"), chapterPath)
    );
    project.dirtyChapters = project.dirtyChapters.filter(
      (entry) => normalizeChapterId(entry) !== chapterId
    );
    rendered.push(chapterId);
  }

  project.meta.updatedAt = new Date().toISOString();

  return {
    project,
    rendered,
    skipped
  };
}

export interface CompileStoryChaptersOptions {
  cwd: string;
  project: StoryProject;
  chapterIds: readonly string[];
  outputPath: string | null;
}

export interface CompileStoryChaptersResult {
  outputPath: string;
  compiledChapters: string[];
  missingChapters: string[];
}

export function compileStoryChapters(options: CompileStoryChaptersOptions): CompileStoryChaptersResult {
  const chaptersDir = getChaptersDirectory(options.cwd);
  const outputPath = options.outputPath
    ? path.resolve(options.cwd, options.outputPath)
    : path.join(options.cwd, ".storyforge", "manuscript", "story.md");
  const missingChapters: string[] = [];
  const compiledChapters: string[] = [];
  const sections: string[] = [`# ${options.project.meta.title || "Untitled Story"}`, ""];

  for (const token of options.chapterIds) {
    const chapterId = normalizeChapterId(token);

    if (!chapterId) {
      continue;
    }

    const chapterPath = path.join(chaptersDir, `${chapterId}.md`);

    if (!fs.existsSync(chapterPath)) {
      missingChapters.push(chapterId);
      continue;
    }

    const content = fs.readFileSync(chapterPath, "utf8").trim();

    sections.push(`## ${chapterId.toUpperCase()}`);
    sections.push(content);
    sections.push("");
    compiledChapters.push(chapterId);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${sections.join("\n").trimEnd()}\n`, "utf8");

  return {
    outputPath,
    compiledChapters,
    missingChapters
  };
}
