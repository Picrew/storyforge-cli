import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  applyPatchWithAgent,
  buildImpactWithAgent,
  planPatchWithAgent,
  runCiWithAgent
} from "./agent-client.js";
import {
  compareChapterIds,
  formatChapterId,
  normalizeChapterId,
  parseChapterNumber
} from "./chapter-id.js";
import {
  buildChapterRenderPrompt,
  type ChapterRenderPromptContext,
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
  source: "model" | "python-fallback" | "file";
}

const MODEL_PATCH_MAX_ATTEMPTS = 3;
const MODEL_PATCH_RETRY_BASE_DELAY_MS = 300;

function createAbortError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function getAbortMessage(signal: AbortSignal | undefined, fallback: string): string {
  const reason = signal?.reason;

  if (reason instanceof Error && reason.message.trim()) {
    return reason.message.trim();
  }

  if (typeof reason === "string" && reason.trim()) {
    return reason.trim();
  }

  return fallback;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) {
    return;
  }

  throw createAbortError(getAbortMessage(signal, "Story run aborted."));
}

function sleep(delayMs: number, signal: AbortSignal | undefined): Promise<void> {
  throwIfAborted(signal);

  if (delayMs <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);

    const onAbort = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(createAbortError(getAbortMessage(signal, "Story run aborted.")));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
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
    abortSignal?: AbortSignal;
  }
): Promise<ResolvedPatchPayload> {
  for (let attempt = 1; attempt <= MODEL_PATCH_MAX_ATTEMPTS; attempt += 1) {
    throwIfAborted(options.abortSignal);
    const raw = await options.runner({
      cwd: options.cwd,
      model: options.model,
      prompt: buildCommitPatchPrompt(options.project, options.chapterId, options.eventText),
      stage: "commit-patch",
      signal: options.abortSignal
    });

    try {
      const parsed = parseStructuredJson<PlannedPatchPayload>(raw);
      const patchOps = normalizePatchOps(parsed.patchOps);

      if (patchOps.length > 0) {
        return {
          patchOps,
          reads: asStringArray(parsed.reads),
          writes: asStringArray(parsed.writes),
          source: "model"
        };
      }
    } catch {
      // Retry malformed structured output before falling back.
    }

    if (attempt < MODEL_PATCH_MAX_ATTEMPTS) {
      const delayMs = Math.round(MODEL_PATCH_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1));
      await sleep(delayMs, options.abortSignal);
    }
  }

  throwIfAborted(options.abortSignal);
  const fallback = await planPatchWithAgent(options.project, options.chapterId, options.eventText);

  return {
    patchOps: normalizePatchOps(fallback.patch_ops),
    reads: asStringArray(fallback.reads),
    writes: asStringArray(fallback.writes),
    source: "python-fallback"
  };
}

function resolvePatchPayloadFromFile(patchFilePath: string): ResolvedPatchPayload {
  const raw = fs.readFileSync(patchFilePath, "utf8");
  const parsed = JSON.parse(raw) as PlannedPatchPayload | EventPatchOp[];

  if (Array.isArray(parsed)) {
    return {
      patchOps: normalizePatchOps(parsed),
      reads: [],
      writes: [],
      source: "file"
    };
  }

  return {
    patchOps: normalizePatchOps(parsed.patchOps),
    reads: asStringArray(parsed.reads),
    writes: asStringArray(parsed.writes),
    source: "file"
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
  abortSignal?: AbortSignal;
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
  throwIfAborted(options.abortSignal);
  const normalizedChapterId = normalizeChapterId(options.chapterId);

  if (!normalizedChapterId) {
    throw new Error("Invalid chapter id.");
  }

  const baseProject = cloneProject(options.project);
  let patchPayload = options.patchFilePath
    ? resolvePatchPayloadFromFile(options.patchFilePath)
    : await resolvePatchPayloadFromModel({
        cwd: options.cwd,
        model: options.model,
        project: baseProject,
        chapterId: normalizedChapterId,
        eventText: options.eventText,
        runner: options.runner,
        abortSignal: options.abortSignal
      });

  if (patchPayload.patchOps.length === 0) {
    throw new Error("No patch operations were produced.");
  }

  let applyResult: Awaited<ReturnType<typeof applyPatchWithAgent>>;

  try {
    throwIfAborted(options.abortSignal);
    applyResult = await applyPatchWithAgent(
      baseProject,
      normalizedChapterId,
      patchPayload.patchOps,
      patchPayload.reads,
      patchPayload.writes
    );
  } catch (error) {
    const canFallbackToPlanner = !options.patchFilePath && patchPayload.source === "model";

    if (!canFallbackToPlanner) {
      throw error;
    }

    const fallback = await planPatchWithAgent(baseProject, normalizedChapterId, options.eventText);
    const fallbackPatchPayload: ResolvedPatchPayload = {
      patchOps: normalizePatchOps(fallback.patch_ops),
      reads: asStringArray(fallback.reads),
      writes: asStringArray(fallback.writes),
      source: "python-fallback"
    };

    if (fallbackPatchPayload.patchOps.length === 0) {
      throw error;
    }

    patchPayload = fallbackPatchPayload;
    throwIfAborted(options.abortSignal);
    applyResult = await applyPatchWithAgent(
      baseProject,
      normalizedChapterId,
      patchPayload.patchOps,
      patchPayload.reads,
      patchPayload.writes
    );
  }

  const patchedProject = cloneProject(applyResult.next_state);
  throwIfAborted(options.abortSignal);
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

  throwIfAborted(options.abortSignal);
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
  maxConcurrency?: number;
  abortSignal?: AbortSignal;
}

export interface RenderStoryChaptersResult {
  project: StoryProject;
  rendered: string[];
  skipped: string[];
}

function normalizeConcurrency(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 1;
  }

  return Math.max(1, Math.floor(value));
}

async function mapWithConcurrency<TItem, TResult>(
  items: readonly TItem[],
  maxConcurrency: number,
  abortSignal: AbortSignal | undefined,
  worker: (item: TItem, index: number) => Promise<TResult>
): Promise<TResult[]> {
  if (items.length === 0) {
    return [];
  }

  const results = new Array<TResult>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(maxConcurrency, items.length);

  const runWorker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      throwIfAborted(abortSignal);
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  };

  await Promise.all(
    Array.from({ length: workerCount }, () => runWorker())
  );

  return results;
}

const DEFAULT_PREVIOUS_TAIL_CHARS = 900;

function stripCodeFenceWrapper(value: string): string {
  const trimmed = value.trim();
  const fenceMatch = /^```(?:\w+)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

function stripLeadingChapterHeading(value: string): string {
  const lines = stripCodeFenceWrapper(value).split(/\r?\n/);

  while (lines.length > 0 && !lines[0].trim()) {
    lines.shift();
  }

  if (lines.length === 0) {
    return "";
  }

  const firstLine = lines[0].trim();
  const headingPatterns = [
    /^#{1,6}\s+/,
    /^chapter\s*\d+/i,
    /^ch\d+\b/i,
    /^第[一二三四五六七八九十百千\d]+章/
  ];

  if (headingPatterns.some((pattern) => pattern.test(firstLine))) {
    lines.shift();
  }

  while (lines.length > 0 && !lines[0].trim()) {
    lines.shift();
  }

  return lines.join("\n").trim();
}

function normalizeRenderedChapterText(value: string): string {
  return stripLeadingChapterHeading(value).trim();
}

function getExistingChapterTail(chaptersDir: string, chapterId: string, maxChars: number): string {
  const chapterPath = path.join(chaptersDir, `${chapterId}.md`);

  if (!fs.existsSync(chapterPath)) {
    return "";
  }

  const content = normalizeRenderedChapterText(fs.readFileSync(chapterPath, "utf8"));

  if (!content) {
    return "";
  }

  if (content.length <= maxChars) {
    return content;
  }

  return `...${content.slice(-maxChars)}`;
}

function buildPreviousChapterSummary(project: StoryProject, chapterId: string): string {
  const previousChapterNumber = parseChapterNumber(chapterId);

  if (previousChapterNumber === null || previousChapterNumber <= 1) {
    return "";
  }

  const previousChapterId = formatChapterId(previousChapterNumber - 1);
  const previousPlan = project.outline.find((entry) => entry.number === previousChapterNumber - 1);
  const timelineSummaries = project.timeline
    .filter((entry) => normalizeChapterId(entry.chapterRef) === previousChapterId)
    .map((entry) => entry.summary.trim())
    .filter(Boolean);
  const commitSummaries = project.eventCommits
    .filter((entry) => normalizeChapterId(entry.chapterId) === previousChapterId)
    .map((entry) => entry.message.trim())
    .filter(Boolean);

  const sections: string[] = [];

  if (previousPlan?.summary.trim()) {
    sections.push(`Plan summary: ${previousPlan.summary.trim()}`);
  }

  if (timelineSummaries.length > 0) {
    sections.push(`Timeline beats: ${timelineSummaries.slice(-3).join(" | ")}`);
  }

  if (commitSummaries.length > 0) {
    sections.push(`Committed events: ${commitSummaries.slice(-3).join(" | ")}`);
  }

  return sections.join("\n");
}

function buildChapterRenderPromptContext(
  project: StoryProject,
  chaptersDir: string,
  chapterId: string
): ChapterRenderPromptContext {
  const chapterNumber = parseChapterNumber(chapterId);
  const chapterPlan = chapterNumber
    ? project.outline.find((entry) => entry.number === chapterNumber)
    : null;
  const targetWords = chapterPlan?.targetWords ?? null;

  if (chapterNumber === null || chapterNumber <= 1) {
    return {
      targetWords
    };
  }

  const previousChapterId = formatChapterId(chapterNumber - 1);
  const previousChapterPlan = project.outline.find((entry) => entry.number === chapterNumber - 1);
  const previousChapterSummary = buildPreviousChapterSummary(project, chapterId);
  const previousChapterTail = getExistingChapterTail(chaptersDir, previousChapterId, DEFAULT_PREVIOUS_TAIL_CHARS);

  return {
    previousChapterId,
    previousChapterTitle: previousChapterPlan?.title || "",
    previousChapterSummary,
    previousChapterTail,
    targetWords
  };
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
  throwIfAborted(options.abortSignal);
  const project = cloneProject(options.project);
  const rendered: string[] = [];
  const skipped: string[] = [];
  const chaptersDir = getChaptersDirectory(options.cwd);
  const maxConcurrency = normalizeConcurrency(options.maxConcurrency);
  const chaptersToRender: {
    chapterId: string;
    patchOps: EventPatchOp[];
    commitIds: string[];
  }[] = [];

  fs.mkdirSync(chaptersDir, { recursive: true });

  for (const token of options.chapterIds) {
    throwIfAborted(options.abortSignal);
    const chapterId = normalizeChapterId(token);

    if (!chapterId) {
      continue;
    }

    const isDirty = project.dirtyChapters.some((entry) => normalizeChapterId(entry) === chapterId);

    if (!isDirty && !options.force) {
      skipped.push(chapterId);
      continue;
    }

    const chapterCommits = project.eventCommits
      .filter((entry) => normalizeChapterId(entry.chapterId) === chapterId);
    const chapterPatchOps = chapterCommits
      .flatMap((entry) => entry.patchOps);
    const commitIds = chapterCommits
      .map((entry) => entry.id);

    chaptersToRender.push({
      chapterId,
      patchOps: chapterPatchOps,
      commitIds
    });
  }

  chaptersToRender.sort((left, right) => compareChapterIds(left.chapterId, right.chapterId));

  const renderedOutputs = await mapWithConcurrency(
    chaptersToRender,
    maxConcurrency,
    options.abortSignal,
    async (chapter) => {
      throwIfAborted(options.abortSignal);
      const promptContext = buildChapterRenderPromptContext(project, chaptersDir, chapter.chapterId);
      const prompt = buildChapterRenderPrompt(
        project,
        chapter.chapterId,
        chapter.patchOps,
        options.style || undefined,
        promptContext
      );
      const chapterText = await options.runner({
        cwd: options.cwd,
        model: options.model,
        prompt,
        stage: `render-${chapter.chapterId}`,
        signal: options.abortSignal
      });
      const chapterPath = path.join(chaptersDir, `${chapter.chapterId}.md`);
      const normalizedChapterText = normalizeRenderedChapterText(chapterText);

      fs.writeFileSync(chapterPath, `${normalizedChapterText}\n`, "utf8");

      return {
        chapterId: chapter.chapterId,
        chapterPath,
        commitIds: chapter.commitIds
      };
    }
  );

  for (const output of renderedOutputs) {
    upsertChapterRender(
      project,
      output.chapterId,
      options.model,
      output.commitIds,
      path.relative(path.join(options.cwd, ".storyforge"), output.chapterPath)
    );
    project.dirtyChapters = project.dirtyChapters.filter(
      (entry) => normalizeChapterId(entry) !== output.chapterId
    );
    rendered.push(output.chapterId);
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
