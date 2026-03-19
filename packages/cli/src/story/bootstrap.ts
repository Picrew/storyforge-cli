import { randomUUID } from "node:crypto";
import { saveStoryProject } from "./project-store.js";
import {
  buildCharactersPrompt,
  buildFoundationPrompt,
  buildOutlinePrompt,
  buildTimelinePrompt
} from "./prompt-catalog.js";
import { parseStructuredJson, type StructuredRunner } from "./structured-run.js";
import type {
  ChapterPlan,
  CharacterProfile,
  StoryProject,
  StoryRefreshScope,
  StoryView,
  TimelineBeat
} from "./types.js";

export type StoryBootstrapStage = "foundation" | "characters" | "timeline" | "outline";

export interface StoryTaskProgress {
  stage: StoryBootstrapStage;
  view: StoryView;
  message: string;
  project: StoryProject;
}

export interface StoryTaskOptions {
  cwd: string;
  model: string;
  project: StoryProject;
  runner: StructuredRunner;
  scope: StoryRefreshScope;
  maxStageAttempts?: number;
  retryBaseDelayMs?: number;
  abortSignal?: AbortSignal;
  onStageStart?: (progress: StoryTaskProgress) => void;
  onStageComplete?: (progress: StoryTaskProgress) => void;
}

export interface StoryTaskResult {
  ok: boolean;
  project: StoryProject;
  failedStage: StoryBootstrapStage | null;
  errorMessage: string | null;
}

interface FoundationPayload {
  title?: unknown;
  genre?: unknown;
  targetWords?: unknown;
  language?: unknown;
  tone?: unknown;
  premise?: unknown;
  world?: {
    premise?: unknown;
    setting?: unknown;
    tone?: unknown;
    rules?: unknown;
    stakes?: unknown;
    resolutionShape?: unknown;
  };
}

interface CharacterPayload {
  characters?: unknown;
}

interface TimelinePayload {
  timeline?: unknown;
}

interface OutlinePayload {
  outline?: unknown;
}

function asString(value: unknown, fallback: string = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function asNumber(value: unknown, fallback: number | null = null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.round(value));
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
    inventory: project.inventory.map((item) => ({
      ...item,
      holders: { ...item.holders }
    })),
    foreshadows: project.foreshadows.map((entry) => ({ ...entry })),
    dependencyGraph: {
      updatedAt: project.dependencyGraph.updatedAt,
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

function touchProject(project: StoryProject): StoryProject {
  return {
    ...project,
    meta: {
      ...project.meta,
      updatedAt: new Date().toISOString()
    }
  };
}

function hasReadySections(project: StoryProject): boolean {
  return Boolean(project.world.premise.trim()) &&
    project.characters.length > 0 &&
    project.timeline.length > 0 &&
    project.outline.length > 0;
}

function ensureSaved(cwd: string, project: StoryProject): void {
  const saveError = saveStoryProject(cwd, project);

  if (saveError) {
    throw new Error(saveError);
  }
}

const DEFAULT_STAGE_MAX_ATTEMPTS = 3;
const DEFAULT_STAGE_RETRY_BASE_DELAY_MS = 400;

function normalizeMaxStageAttempts(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_STAGE_MAX_ATTEMPTS;
  }

  return Math.min(10, Math.max(1, Math.floor(value)));
}

function normalizeRetryBaseDelayMs(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_STAGE_RETRY_BASE_DELAY_MS;
  }

  return Math.max(0, Math.floor(value));
}

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

  throw createAbortError(getAbortMessage(signal, "Story task aborted."));
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
      reject(createAbortError(getAbortMessage(signal, "Story task aborted.")));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function getStagesForScope(scope: StoryRefreshScope): StoryBootstrapStage[] {
  switch (scope) {
    case "all":
      return ["foundation", "characters", "timeline", "outline"];
    case "world":
      return ["foundation"];
    case "characters":
      return ["characters"];
    case "timeline":
      return ["timeline"];
    case "outline":
      return ["outline"];
  }
}

function getProgressMessage(stage: StoryBootstrapStage, completed: boolean): string {
  switch (stage) {
    case "foundation":
      return completed ? "World foundation updated." : "Generating world foundation...";
    case "characters":
      return completed ? "Characters updated." : "Generating characters...";
    case "timeline":
      return completed ? "Timeline updated." : "Generating timeline...";
    case "outline":
      return completed ? "Outline updated." : "Generating outline...";
  }
}

function getProgressView(stage: StoryBootstrapStage): StoryView {
  switch (stage) {
    case "foundation":
      return "world";
    case "characters":
      return "characters";
    case "timeline":
      return "timeline";
    case "outline":
      return "outline";
  }
}

function applyFoundationStage(project: StoryProject, payload: FoundationPayload): StoryProject {
  const nextProject = cloneProject(project);
  const nextTitle = asString(payload.title, nextProject.meta.title) || "Untitled Story";
  const nextPremise = asString(payload.premise, nextProject.brief.premise);
  const nextTone = asString(payload.tone, nextProject.brief.tone);
  const world = payload.world ?? {};

  nextProject.meta.title = nextTitle;
  nextProject.brief = {
    ...nextProject.brief,
    genre: asString(payload.genre, nextProject.brief.genre),
    targetWords: asNumber(payload.targetWords, nextProject.brief.targetWords),
    language: asString(payload.language, nextProject.brief.language) || nextProject.brief.language,
    tone: nextTone || nextProject.brief.tone,
    premise: nextPremise || nextProject.brief.premise
  };
  nextProject.world = {
    premise: asString(world.premise, nextPremise || nextProject.world.premise),
    setting: asString(world.setting, nextProject.world.setting),
    tone: asString(world.tone, nextTone || nextProject.world.tone),
    rules: asString(world.rules, nextProject.world.rules),
    stakes: asString(world.stakes, nextProject.world.stakes),
    resolutionShape: asString(world.resolutionShape, nextProject.world.resolutionShape)
  };

  return touchProject(nextProject);
}

function normalizeCharacters(
  project: StoryProject,
  payload: CharacterPayload | CharacterProfile[]
): CharacterProfile[] {
  const source = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.characters)
      ? payload.characters
      : [];

  return source.map((entry, index) => {
    const record = entry as Record<string, unknown>;
    const existingId = project.characters[index]?.id;

    return {
      id: existingId || randomUUID(),
      name: asString(record.name, `Character ${index + 1}`),
      role: asString(record.role),
      age: asString(record.age),
      description: asString(record.description),
      motivation: asString(record.motivation),
      conflict: asString(record.conflict),
      arc: asString(record.arc),
      relationships: asString(record.relationships),
      tags: asString(record.tags)
    };
  });
}

function normalizeTimeline(project: StoryProject, payload: TimelinePayload | TimelineBeat[]): TimelineBeat[] {
  const source = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.timeline)
      ? payload.timeline
      : [];

  return source.map((entry, index) => {
    const record = entry as Record<string, unknown>;
    const existingId = project.timeline[index]?.id;

    return {
      id: existingId || randomUUID(),
      label: asString(record.label, `Beat ${index + 1}`),
      summary: asString(record.summary),
      chapterRef: asString(record.chapterRef),
      stakes: asString(record.stakes),
      notes: asString(record.notes)
    };
  });
}

function normalizeOutline(project: StoryProject, payload: OutlinePayload | ChapterPlan[]): ChapterPlan[] {
  const source = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.outline)
      ? payload.outline
      : [];
  const defaultTarget =
    project.brief.targetWords && source.length > 0
      ? Math.max(1, Math.round(project.brief.targetWords / source.length))
      : null;

  return source.map((entry, index) => {
    const record = entry as Record<string, unknown>;
    const existingId = project.outline[index]?.id;

    return {
      id: existingId || randomUUID(),
      number: asNumber(record.number, index + 1) ?? index + 1,
      title: asString(record.title, `Chapter ${index + 1}`),
      purpose: asString(record.purpose),
      summary: asString(record.summary),
      hook: asString(record.hook),
      targetWords: asNumber(record.targetWords, defaultTarget)
    };
  });
}

async function runStage(
  options: StoryTaskOptions,
  project: StoryProject,
  stage: StoryBootstrapStage
): Promise<StoryProject> {
  throwIfAborted(options.abortSignal);

  switch (stage) {
    case "foundation": {
      const raw = await options.runner({
        cwd: options.cwd,
        model: options.model,
        prompt: buildFoundationPrompt(project.brief.seedPrompt),
        stage,
        signal: options.abortSignal
      });
      const payload = parseStructuredJson<FoundationPayload>(raw);
      return applyFoundationStage(project, payload);
    }
    case "characters": {
      const raw = await options.runner({
        cwd: options.cwd,
        model: options.model,
        prompt: buildCharactersPrompt(project),
        stage,
        signal: options.abortSignal
      });
      const payload = parseStructuredJson<CharacterPayload>(raw);
      return touchProject({
        ...cloneProject(project),
        characters: normalizeCharacters(project, payload)
      });
    }
    case "timeline": {
      const raw = await options.runner({
        cwd: options.cwd,
        model: options.model,
        prompt: buildTimelinePrompt(project),
        stage,
        signal: options.abortSignal
      });
      const payload = parseStructuredJson<TimelinePayload>(raw);
      return touchProject({
        ...cloneProject(project),
        timeline: normalizeTimeline(project, payload)
      });
    }
    case "outline": {
      const raw = await options.runner({
        cwd: options.cwd,
        model: options.model,
        prompt: buildOutlinePrompt(project),
        stage,
        signal: options.abortSignal
      });
      const payload = parseStructuredJson<OutlinePayload>(raw);
      return touchProject({
        ...cloneProject(project),
        outline: normalizeOutline(project, payload)
      });
    }
  }
}

async function runStageWithRetry(
  options: StoryTaskOptions,
  project: StoryProject,
  stage: StoryBootstrapStage
): Promise<StoryProject> {
  const maxAttempts = normalizeMaxStageAttempts(options.maxStageAttempts);
  const retryBaseDelayMs = normalizeRetryBaseDelayMs(options.retryBaseDelayMs);
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    throwIfAborted(options.abortSignal);

    try {
      return await runStage(options, project, stage);
    } catch (error) {
      lastError = error;

      if (attempt >= maxAttempts) {
        break;
      }

      const delayMs = Math.round(retryBaseDelayMs * Math.pow(2, attempt - 1));
      await sleep(delayMs, options.abortSignal);
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new Error("Story stage failed.");
}

export async function runStoryTask(options: StoryTaskOptions): Promise<StoryTaskResult> {
  throwIfAborted(options.abortSignal);

  if (!options.project.brief.seedPrompt.trim()) {
    throw new Error("No saved story brief was found for this project.");
  }

  let nextProject = cloneProject(options.project);

  for (const stage of getStagesForScope(options.scope)) {
    throwIfAborted(options.abortSignal);

    const startProgress = {
      stage,
      view: getProgressView(stage),
      message: getProgressMessage(stage, false),
      project: nextProject
    };

    options.onStageStart?.(startProgress);

    try {
      nextProject = await runStageWithRetry(options, nextProject, stage);
      ensureSaved(options.cwd, nextProject);
      options.onStageComplete?.({
        stage,
        view: getProgressView(stage),
        message: getProgressMessage(stage, true),
        project: nextProject
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      nextProject = touchProject({
        ...nextProject,
        meta: {
          ...nextProject.meta,
          status: "partial"
        }
      });

      try {
        ensureSaved(options.cwd, nextProject);
      } catch {
        // Preserve the original failure. The app will surface the stage error.
      }

      return {
        ok: false,
        project: nextProject,
        failedStage: stage,
        errorMessage: message
      };
    }
  }

  const nextStatus = hasReadySections(nextProject) ? "ready" : nextProject.meta.status;
  nextProject = touchProject({
    ...nextProject,
    meta: {
      ...nextProject.meta,
      status: nextStatus
    }
  });
  ensureSaved(options.cwd, nextProject);

  return {
    ok: true,
    project: nextProject,
    failedStage: null,
    errorMessage: null
  };
}
