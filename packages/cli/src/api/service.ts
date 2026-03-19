import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { handleStoryCommand } from "../commands/story-commands.js";
import {
  runStoryTask,
  type StoryBootstrapStage
} from "../story/bootstrap.js";
import {
  parseChapterRange,
  normalizeChapterId,
  compareChapterIds
} from "../story/chapter-id.js";
import {
  createBlankStoryProject,
  createStoryProject,
  loadStoryProject,
  loadStoryWorkspace,
  saveStoryProject
} from "../story/project-store.js";
import {
  commitStoryEvent,
  compileStoryChapters,
  renderStoryChapters,
  runStoryCi
} from "../story/simulation.js";
import type {
  ChapterPlan,
  StoryProject
} from "../story/types.js";
import type {
  StructuredRunner
} from "../story/structured-run.js";
import {
  createOpenAICompatibleRunner
} from "./openai-compatible-runner.js";

const DEFAULT_API_OUTPUT_SUBDIR = "generated-novels";

function resolveDefaultApiOutputRoot(): string {
  const fromEnv =
    typeof process.env.STORYFORGE_API_OUTPUT_ROOT === "string"
      ? process.env.STORYFORGE_API_OUTPUT_ROOT.trim()
      : "";

  if (fromEnv) {
    return path.resolve(fromEnv);
  }

  return path.resolve(process.cwd(), DEFAULT_API_OUTPUT_SUBDIR);
}

export const DEFAULT_API_OUTPUT_ROOT = resolveDefaultApiOutputRoot();

const DEFAULT_MODEL_TIMEOUT_MS = 180_000;

export class ApiServiceError extends Error {
  code: number;
  status: number;

  constructor(message: string, code: number, status: number) {
    super(message);
    this.name = "ApiServiceError";
    this.code = code;
    this.status = status;
  }
}

export interface ApiModelConfig {
  api_url: string;
  api_key: string;
  model: string;
  timeout_ms?: number;
}

export type StoryEditTable = "world" | "char" | "timeline" | "outline";

export type StoryEditAction = "set" | "add" | "remove";

export interface StoryEditInput {
  table: StoryEditTable;
  action: StoryEditAction;
  row?: number;
  field?: string;
  value?: string;
}

export interface StoryEventInput {
  chapter_id: string;
  event_text?: string;
  force?: boolean;
}

export interface StoryRunRequest {
  workspace_dir?: string;
  output_root?: string;
  title?: string;
  prompt: string;
  model_config: ApiModelConfig;
  edits?: StoryEditInput[];
  events?: StoryEventInput[];
  render?: {
    chapter_range?: string;
    chapter_ids?: string[];
    force?: boolean;
    style?: string | null;
    max_concurrency?: number;
  };
  compile?: {
    chapter_range?: string;
    chapter_ids?: string[];
    output_path?: string | null;
  };
}

export interface StoryInitRequest {
  workspace_dir?: string;
  output_root?: string;
  title?: string;
  prompt?: string;
  model_config?: ApiModelConfig;
}

export interface StoryRefreshRequest {
  workspace_dir: string;
  project_id?: string;
  scope?: "all" | "world" | "characters" | "timeline" | "outline" | "char";
  prompt?: string;
  model_config: ApiModelConfig;
}

export interface StoryEditRequest {
  workspace_dir: string;
  project_id?: string;
  table?: StoryEditTable;
  action?: StoryEditAction;
  row?: number;
  field?: string;
  value?: string;
  edits?: StoryEditInput[];
}

export interface StoryCommitRequest {
  workspace_dir: string;
  project_id?: string;
  chapter_id: string;
  event_text?: string;
  patch_file_path?: string | null;
  force?: boolean;
  model_config?: ApiModelConfig;
}

export interface StoryCiRequest {
  workspace_dir: string;
  project_id?: string;
  scope?: "all" | "commit";
  commit_id?: string | null;
}

export interface StoryRenderRequest {
  workspace_dir: string;
  project_id?: string;
  chapter_range?: string;
  chapter_ids?: string[];
  force?: boolean;
  style?: string | null;
  max_concurrency?: number;
  model_config: ApiModelConfig;
}

export interface StoryCompileRequest {
  workspace_dir: string;
  project_id?: string;
  chapter_range?: string;
  chapter_ids?: string[];
  output_path?: string | null;
}

export interface StoryRunProgress {
  stage: string;
  message: string;
}

export interface StoryRunResult {
  workspace_dir: string;
  project_id: string;
  manuscript_path: string;
  project_path: string;
  summary_path: string;
  metrics: {
    elapsed_ms: number;
    llm_calls: number;
  };
  ci: {
    passed: boolean;
    errors: number;
    warnings: number;
  };
  commits: {
    total: number;
    succeeded: number;
    failed: number;
    failures: Array<{ chapter_id: string; error: string }>;
  };
  render: {
    chapter_ids: string[];
    rendered: string[];
    skipped: string[];
  };
  compile: {
    compiled_chapters: string[];
    missing_chapters: string[];
  };
}

interface WorkspaceProjectContext {
  workspaceDir: string;
  projectId: string;
  project: StoryProject;
}

interface ModelRuntime {
  model: string;
  runner: StructuredRunner;
}

interface StoryRunExecutionOptions {
  abortSignal?: AbortSignal;
}

function throwValidation(message: string): never {
  throw new ApiServiceError(message, 4001, 400);
}

function throwNotFound(message: string): never {
  throw new ApiServiceError(message, 4040, 404);
}

function throwInternal(message: string): never {
  throw new ApiServiceError(message, 5001, 500);
}

function resolveAbortMessage(signal: AbortSignal | undefined): string {
  const reason = signal?.reason;

  if (reason instanceof Error && reason.message.trim()) {
    return reason.message.trim();
  }

  if (typeof reason === "string" && reason.trim()) {
    return reason.trim();
  }

  return "Story run was aborted by caller.";
}

function throwAborted(signal: AbortSignal | undefined): never {
  throw new ApiServiceError(resolveAbortMessage(signal), 4990, 499);
}

function ensureNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throwAborted(signal);
  }
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}

function asOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}

function ensureDirectory(directoryPath: string): string {
  const resolvedPath = path.resolve(directoryPath);
  fs.mkdirSync(resolvedPath, { recursive: true });
  return resolvedPath;
}

function timestampForPath(now: Date = new Date()): string {
  return now.toISOString().replace(/[:.]/g, "-");
}

function normalizeOutputRoot(value: string | undefined): string {
  return ensureDirectory(asOptionalString(value) ?? DEFAULT_API_OUTPUT_ROOT);
}

export function validateStoryRunRequest(request: StoryRunRequest): void {
  const prompt = asOptionalString(request.prompt);

  if (!prompt) {
    throwValidation("prompt is required.");
  }

  resolveModelRuntime(request.model_config);
}

function createWorkspaceDirectory(outputRoot: string, prefix: string): string {
  const baseName = `${prefix}-${timestampForPath()}-${randomUUID().slice(0, 8)}`;
  return ensureDirectory(path.join(outputRoot, baseName));
}

function normalizeRefreshScope(
  scope: StoryRefreshRequest["scope"]
): "all" | "world" | "characters" | "timeline" | "outline" {
  if (!scope || scope === "all") {
    return "all";
  }

  if (scope === "char") {
    return "characters";
  }

  if (
    scope === "world" ||
    scope === "characters" ||
    scope === "timeline" ||
    scope === "outline"
  ) {
    return scope;
  }

  throwValidation(`Unsupported refresh scope: ${scope}`);
}

function normalizeTimeoutMs(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_MODEL_TIMEOUT_MS;
  }

  return Math.max(1_000, Math.floor(value));
}

function resolveModelRuntime(modelConfig: ApiModelConfig | undefined): ModelRuntime {
  if (!modelConfig) {
    throwValidation("model_config is required.");
  }

  const apiUrl = asNonEmptyString(modelConfig.api_url);
  const apiKey = asNonEmptyString(modelConfig.api_key);
  const model = asNonEmptyString(modelConfig.model);

  if (!apiUrl) {
    throwValidation("model_config.api_url is required.");
  }

  if (!apiKey) {
    throwValidation("model_config.api_key is required.");
  }

  if (!model) {
    throwValidation("model_config.model is required.");
  }

  const runner = createOpenAICompatibleRunner({
    apiUrl,
    apiKey,
    defaultModel: model,
    timeoutMs: normalizeTimeoutMs(modelConfig.timeout_ms)
  });

  return {
    model,
    runner
  };
}

function loadWorkspaceProject(workspaceDir: string, projectId?: string): WorkspaceProjectContext {
  const normalizedWorkspace = ensureDirectory(workspaceDir);
  const workspace = loadStoryWorkspace(normalizedWorkspace);
  const resolvedProjectId = asOptionalString(projectId) ?? workspace.activeProjectId;

  if (!resolvedProjectId) {
    throwNotFound("No story project found in this workspace. Call /api/v1/story/init first.");
  }

  const project = loadStoryProject(normalizedWorkspace, resolvedProjectId);

  if (!project) {
    throwNotFound(`Story project could not be loaded: ${resolvedProjectId}`);
  }

  return {
    workspaceDir: normalizedWorkspace,
    projectId: resolvedProjectId,
    project
  };
}

function persistProject(context: WorkspaceProjectContext, project: StoryProject): StoryProject {
  const saveError = saveStoryProject(context.workspaceDir, project, context.projectId);

  if (saveError) {
    throwInternal(`Failed to persist project: ${saveError}`);
  }

  return project;
}

function getKnownChapterIds(project: StoryProject): string[] {
  const chapterIds = new Set<string>();

  for (const chapter of project.outline) {
    chapterIds.add(`ch${String(Math.max(1, chapter.number)).padStart(2, "0")}`);
  }

  for (const commit of project.eventCommits) {
    const chapterId = normalizeChapterId(commit.chapterId);

    if (chapterId) {
      chapterIds.add(chapterId);
    }
  }

  for (const chapterId of project.dirtyChapters) {
    const normalized = normalizeChapterId(chapterId);

    if (normalized) {
      chapterIds.add(normalized);
    }
  }

  for (const render of project.chapterRenders) {
    const chapterId = normalizeChapterId(render.chapterId);

    if (chapterId) {
      chapterIds.add(chapterId);
    }
  }

  return [...chapterIds].sort(compareChapterIds);
}

function normalizeChapterIdsFromList(rawChapterIds: readonly string[]): string[] {
  const normalized = rawChapterIds
    .map((entry) => normalizeChapterId(entry))
    .filter((entry): entry is string => Boolean(entry));

  return [...new Set(normalized)].sort(compareChapterIds);
}

function resolveChapterIds(
  project: StoryProject,
  chapterRange: string | undefined,
  chapterIds: readonly string[] | undefined
): string[] {
  if (Array.isArray(chapterIds) && chapterIds.length > 0) {
    const normalized = normalizeChapterIdsFromList(chapterIds);

    if (normalized.length === 0) {
      throwValidation("chapter_ids is invalid.");
    }

    return normalized;
  }

  const normalizedRange = asOptionalString(chapterRange)?.toLowerCase() ?? "all";

  if (normalizedRange === "all") {
    const known = getKnownChapterIds(project);

    if (known.length === 0) {
      throwValidation("No known chapters were found for range 'all'.");
    }

    return known;
  }

  const parsed = parseChapterRange(normalizedRange);

  if (!parsed || parsed.length === 0) {
    throwValidation("chapter_range is invalid.");
  }

  return parsed;
}

function buildDefaultEventText(project: StoryProject, chapterId: string): string {
  const chapterNumber = Number.parseInt(chapterId.replace(/^ch/i, ""), 10);

  if (!Number.isFinite(chapterNumber)) {
    return `Advance story for ${chapterId}.`;
  }

  const plan = project.outline.find((entry) => entry.number === chapterNumber);

  if (!plan) {
    return `Advance story for ${chapterId}.`;
  }

  const segments = [plan.summary, plan.purpose, plan.hook]
    .map((entry) => entry.trim())
    .filter(Boolean);

  return segments.length > 0
    ? segments.join(" ")
    : `Advance story for ${chapterId}.`;
}

function normalizeSingleEditRequest(request: StoryEditRequest): StoryEditInput[] {
  if (Array.isArray(request.edits) && request.edits.length > 0) {
    return request.edits;
  }

  if (!request.table || !request.action) {
    throwValidation("Either edits[] or table+action is required.");
  }

  return [
    {
      table: request.table,
      action: request.action,
      row: request.row,
      field: request.field,
      value: request.value
    }
  ];
}

function normalizeEditInput(edit: StoryEditInput): StoryEditInput {
  const table = edit.table;
  const action = edit.action;

  if (table !== "world" && table !== "char" && table !== "timeline" && table !== "outline") {
    throwValidation(`Unsupported edit table: ${String(table)}`);
  }

  if (action !== "set" && action !== "add" && action !== "remove") {
    throwValidation(`Unsupported edit action: ${String(action)}`);
  }

  const normalizedValue = asOptionalString(edit.value) ?? "";

  if (table === "world") {
    if (action !== "set") {
      throwValidation("world table only supports action 'set'.");
    }

    if (!asNonEmptyString(edit.field)) {
      throwValidation("field is required for world.set.");
    }

    if (!normalizedValue) {
      throwValidation("value is required for world.set.");
    }

    return {
      table,
      action,
      field: edit.field?.trim(),
      value: normalizedValue
    };
  }

  if (action === "add") {
    if (!normalizedValue) {
      throwValidation(`value is required for ${table}.add.`);
    }

    return {
      table,
      action,
      value: normalizedValue
    };
  }

  if (action === "remove") {
    if (typeof edit.row !== "number" || !Number.isFinite(edit.row) || edit.row < 1) {
      throwValidation(`row must be a positive integer for ${table}.remove.`);
    }

    return {
      table,
      action,
      row: Math.floor(edit.row)
    };
  }

  if (typeof edit.row !== "number" || !Number.isFinite(edit.row) || edit.row < 1) {
    throwValidation(`row must be a positive integer for ${table}.set.`);
  }

  if (!asNonEmptyString(edit.field)) {
    throwValidation(`field is required for ${table}.set.`);
  }

  if (!normalizedValue) {
    throwValidation(`value is required for ${table}.set.`);
  }

  return {
    table,
    action,
    row: Math.floor(edit.row),
    field: edit.field?.trim(),
    value: normalizedValue
  };
}

function editToCommand(edit: StoryEditInput): { command: string; args: string[] } {
  const normalized = normalizeEditInput(edit);

  if (normalized.table === "world") {
    return {
      command: "/world",
      args: ["set", normalized.field as string, normalized.value as string]
    };
  }

  const command =
    normalized.table === "char"
      ? "/char"
      : normalized.table === "timeline"
        ? "/timeline"
        : "/outline";

  if (normalized.action === "add") {
    return {
      command,
      args: ["add", normalized.value as string]
    };
  }

  if (normalized.action === "remove") {
    return {
      command,
      args: ["rm", String(normalized.row)]
    };
  }

  return {
    command,
    args: [
      "set",
      String(normalized.row),
      normalized.field as string,
      normalized.value as string
    ]
  };
}

function applySingleEdit(
  project: StoryProject,
  projectId: string,
  edits: readonly StoryEditInput[]
): { project: StoryProject; messages: string[] } {
  let workingProject = project;
  const messages: string[] = [];

  for (const edit of edits) {
    const command = editToCommand(edit);
    const result = handleStoryCommand(
      {
        currentProject: workingProject,
        currentProjectId: projectId,
        projects: []
      },
      command
    );

    if (result.type === "notice") {
      throwValidation(result.message);
    }

    if (result.type !== "mutate") {
      throwInternal(`Unexpected edit result type: ${result.type}`);
    }

    workingProject = result.project;
    messages.push(result.message);
  }

  return {
    project: workingProject,
    messages
  };
}

function normalizeCommitEventInput(event: StoryEventInput): {
  chapterId: string;
  eventText: string;
  force: boolean;
} {
  const chapterId = normalizeChapterId(event.chapter_id);

  if (!chapterId) {
    throwValidation(`Invalid chapter id: ${event.chapter_id}`);
  }

  return {
    chapterId,
    eventText: asOptionalString(event.event_text) ?? "",
    force: event.force === false ? false : true
  };
}

function noopRunner(): StructuredRunner {
  return async () => {
    throw new Error("Model runner is not configured for this request.");
  };
}

function normalizeBootstrapFailure(stage: StoryBootstrapStage | null, message: string | null): string {
  if (!stage) {
    return message ?? "Story bootstrap failed.";
  }

  const detail = message?.trim() || "Unknown error.";
  return `Story bootstrap failed at stage '${stage}': ${detail}`;
}

async function runBootstrapFromPrompt(options: {
  workspaceDir: string;
  projectId: string;
  project: StoryProject;
  prompt: string;
  model: string;
  runner: StructuredRunner;
  onProgress?: (progress: StoryRunProgress) => void;
  abortSignal?: AbortSignal;
}): Promise<StoryProject> {
  ensureNotAborted(options.abortSignal);
  const seedPrompt = options.prompt.trim();

  if (!seedPrompt) {
    throwValidation("prompt is required.");
  }

  const bootProject: StoryProject = {
    ...options.project,
    brief: {
      ...options.project.brief,
      seedPrompt
    },
    meta: {
      ...options.project.meta,
      status: "bootstrapping",
      updatedAt: new Date().toISOString()
    }
  };

  persistProject(
    {
      workspaceDir: options.workspaceDir,
      projectId: options.projectId,
      project: options.project
    },
    bootProject
  );

  options.onProgress?.({
    stage: "bootstrap",
    message: "Bootstrapping story foundation, characters, timeline, and outline..."
  });

  const result = await runStoryTask({
    cwd: options.workspaceDir,
    model: options.model,
    project: bootProject,
    runner: options.runner,
    scope: "all",
    abortSignal: options.abortSignal,
    onStageStart: ({ stage, message }) => {
      options.onProgress?.({
        stage: `bootstrap:${stage}:start`,
        message
      });
    },
    onStageComplete: ({ stage, message }) => {
      options.onProgress?.({
        stage: `bootstrap:${stage}:done`,
        message
      });
    }
  });

  if (!result.ok) {
    throwInternal(normalizeBootstrapFailure(result.failedStage, result.errorMessage));
  }

  const saveError = saveStoryProject(options.workspaceDir, result.project, options.projectId);

  if (saveError) {
    throwInternal(`Bootstrap completed but save failed: ${saveError}`);
  }

  options.onProgress?.({
    stage: "bootstrap:done",
    message: "Story bootstrap finished."
  });

  return result.project;
}

async function runRefresh(options: {
  context: WorkspaceProjectContext;
  prompt?: string;
  scope: "all" | "world" | "characters" | "timeline" | "outline";
  model: string;
  runner: StructuredRunner;
  onProgress?: (progress: StoryRunProgress) => void;
  abortSignal?: AbortSignal;
}): Promise<StoryProject> {
  ensureNotAborted(options.abortSignal);
  const seedPrompt = asOptionalString(options.prompt);
  const bootProject: StoryProject = {
    ...options.context.project,
    brief: {
      ...options.context.project.brief,
      seedPrompt: seedPrompt ?? options.context.project.brief.seedPrompt
    },
    meta: {
      ...options.context.project.meta,
      status: "bootstrapping",
      updatedAt: new Date().toISOString()
    }
  };

  persistProject(options.context, bootProject);

  options.onProgress?.({
    stage: "refresh",
    message: `Refreshing scope '${options.scope}'...`
  });

  const result = await runStoryTask({
    cwd: options.context.workspaceDir,
    model: options.model,
    project: bootProject,
    runner: options.runner,
    scope: options.scope,
    abortSignal: options.abortSignal,
    onStageStart: ({ stage, message }) => {
      options.onProgress?.({
        stage: `refresh:${stage}:start`,
        message
      });
    },
    onStageComplete: ({ stage, message }) => {
      options.onProgress?.({
        stage: `refresh:${stage}:done`,
        message
      });
    }
  });

  if (!result.ok) {
    throwInternal(normalizeBootstrapFailure(result.failedStage, result.errorMessage));
  }

  persistProject(options.context, result.project);

  options.onProgress?.({
    stage: "refresh:done",
    message: "Refresh finished."
  });

  return result.project;
}

function materializeCompileOutputPath(
  workspaceDir: string,
  outputPath: string | undefined | null
): string {
  const maybePath = asOptionalString(outputPath);

  if (!maybePath) {
    return path.join(workspaceDir, "manuscript.md");
  }

  return path.isAbsolute(maybePath)
    ? maybePath
    : path.resolve(workspaceDir, maybePath);
}

function writeRunArtifacts(
  workspaceDir: string,
  project: StoryProject,
  summary: Record<string, unknown>
): { projectPath: string; summaryPath: string } {
  const projectPath = path.join(workspaceDir, "project.json");
  const summaryPath = path.join(workspaceDir, "run-summary.json");

  fs.writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`, "utf8");
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  return {
    projectPath,
    summaryPath
  };
}

function normalizeRunEvents(project: StoryProject, rawEvents: readonly StoryEventInput[] | undefined): Array<{
  chapterId: string;
  eventText: string;
  force: boolean;
}> {
  if (Array.isArray(rawEvents) && rawEvents.length > 0) {
    return rawEvents.map(normalizeCommitEventInput);
  }

  const chapters = getKnownChapterIds(project);

  return chapters.map((chapterId) => ({
    chapterId,
    eventText: buildDefaultEventText(project, chapterId),
    force: true
  }));
}

export async function executeStoryInitRequest(request: StoryInitRequest): Promise<{
  workspace_dir: string;
  project_id: string;
  project: StoryProject;
  message: string;
}> {
  const outputRoot = normalizeOutputRoot(request.output_root);
  const workspaceDir = request.workspace_dir
    ? ensureDirectory(request.workspace_dir)
    : createWorkspaceDirectory(outputRoot, "api-workspace");
  const projectTitle = asOptionalString(request.title) ?? "API Story";
  const prompt = asOptionalString(request.prompt);

  const project = createBlankStoryProject(new Date().toISOString(), projectTitle);

  if (prompt) {
    project.brief.seedPrompt = prompt;
    project.meta.status = "bootstrapping";
  } else {
    project.meta.status = "awaiting_brief";
  }

  const created = createStoryProject(workspaceDir, project);

  if (created.error || !created.projectId) {
    throwInternal(created.error ?? "Project could not be created.");
  }

  if (!prompt) {
    return {
      workspace_dir: workspaceDir,
      project_id: created.projectId,
      project,
      message: "Story project initialized."
    };
  }

  const modelRuntime = resolveModelRuntime(request.model_config);
  const bootstrapped = await runBootstrapFromPrompt({
    workspaceDir,
    projectId: created.projectId,
    project,
    prompt,
    model: modelRuntime.model,
    runner: modelRuntime.runner
  });

  return {
    workspace_dir: workspaceDir,
    project_id: created.projectId,
    project: bootstrapped,
    message: "Story project initialized and bootstrapped."
  };
}

export async function executeStoryRefreshRequest(request: StoryRefreshRequest): Promise<{
  workspace_dir: string;
  project_id: string;
  project: StoryProject;
  scope: "all" | "world" | "characters" | "timeline" | "outline";
  message: string;
}> {
  const context = loadWorkspaceProject(request.workspace_dir, request.project_id);
  const scope = normalizeRefreshScope(request.scope);
  const modelRuntime = resolveModelRuntime(request.model_config);

  const project = await runRefresh({
    context,
    prompt: request.prompt,
    scope,
    model: modelRuntime.model,
    runner: modelRuntime.runner
  });

  return {
    workspace_dir: context.workspaceDir,
    project_id: context.projectId,
    project,
    scope,
    message: "Story refresh completed."
  };
}

export function executeStoryEditRequest(request: StoryEditRequest): {
  workspace_dir: string;
  project_id: string;
  project: StoryProject;
  applied: string[];
} {
  const context = loadWorkspaceProject(request.workspace_dir, request.project_id);
  const edits = normalizeSingleEditRequest(request);
  const applied = applySingleEdit(context.project, context.projectId, edits);

  persistProject(context, applied.project);

  return {
    workspace_dir: context.workspaceDir,
    project_id: context.projectId,
    project: applied.project,
    applied: applied.messages
  };
}

export async function executeStoryCommitRequest(request: StoryCommitRequest): Promise<{
  workspace_dir: string;
  project_id: string;
  project: StoryProject;
  ok: boolean;
  message: string;
  ci_report: unknown;
}> {
  const context = loadWorkspaceProject(request.workspace_dir, request.project_id);
  const chapterId = normalizeChapterId(request.chapter_id);

  if (!chapterId) {
    throwValidation("chapter_id is invalid.");
  }

  const patchFilePath = asOptionalString(request.patch_file_path) ?? null;
  let runtime: ModelRuntime | null = null;

  if (!patchFilePath) {
    runtime = resolveModelRuntime(request.model_config);
  } else if (request.model_config) {
    runtime = resolveModelRuntime(request.model_config);
  }

  const result = await commitStoryEvent({
    cwd: context.workspaceDir,
    model: runtime?.model ?? "api/manual-patch",
    project: context.project,
    chapterId,
    eventText: asOptionalString(request.event_text) ?? "",
    patchFilePath,
    force: request.force === true,
    runner: runtime?.runner ?? noopRunner()
  });

  if (result.ok) {
    persistProject(context, result.project);
  }

  return {
    workspace_dir: context.workspaceDir,
    project_id: context.projectId,
    project: result.project,
    ok: result.ok,
    message: result.message,
    ci_report: result.ciReport
  };
}

export async function executeStoryCiRequest(request: StoryCiRequest): Promise<{
  workspace_dir: string;
  project_id: string;
  project: StoryProject;
  report: unknown;
}> {
  const context = loadWorkspaceProject(request.workspace_dir, request.project_id);
  const scope = request.scope === "commit" ? "commit" : "all";

  const result = await runStoryCi({
    project: context.project,
    scope,
    commitId: asOptionalString(request.commit_id) ?? null
  });

  persistProject(context, result.project);

  return {
    workspace_dir: context.workspaceDir,
    project_id: context.projectId,
    project: result.project,
    report: result.report
  };
}

export async function executeStoryRenderRequest(request: StoryRenderRequest): Promise<{
  workspace_dir: string;
  project_id: string;
  project: StoryProject;
  chapter_ids: string[];
  rendered: string[];
  skipped: string[];
}> {
  const context = loadWorkspaceProject(request.workspace_dir, request.project_id);
  const chapterIds = resolveChapterIds(context.project, request.chapter_range, request.chapter_ids);
  const runtime = resolveModelRuntime(request.model_config);

  const result = await renderStoryChapters({
    cwd: context.workspaceDir,
    model: runtime.model,
    project: context.project,
    chapterIds,
    style: asOptionalString(request.style) ?? null,
    force: request.force === true,
    runner: runtime.runner,
    maxConcurrency:
      typeof request.max_concurrency === "number" && Number.isFinite(request.max_concurrency)
        ? Math.max(1, Math.floor(request.max_concurrency))
        : 1
  });

  persistProject(context, result.project);

  return {
    workspace_dir: context.workspaceDir,
    project_id: context.projectId,
    project: result.project,
    chapter_ids: chapterIds,
    rendered: result.rendered,
    skipped: result.skipped
  };
}

export function executeStoryCompileRequest(request: StoryCompileRequest): {
  workspace_dir: string;
  project_id: string;
  output_path: string;
  compiled_chapters: string[];
  missing_chapters: string[];
} {
  const context = loadWorkspaceProject(request.workspace_dir, request.project_id);
  const chapterIds = resolveChapterIds(context.project, request.chapter_range, request.chapter_ids);
  const outputPath = materializeCompileOutputPath(context.workspaceDir, request.output_path);

  const result = compileStoryChapters({
    cwd: context.workspaceDir,
    project: context.project,
    chapterIds,
    outputPath
  });

  return {
    workspace_dir: context.workspaceDir,
    project_id: context.projectId,
    output_path: result.outputPath,
    compiled_chapters: result.compiledChapters,
    missing_chapters: result.missingChapters
  };
}

export async function executeStoryRunRequest(
  request: StoryRunRequest,
  onProgress?: (progress: StoryRunProgress) => void,
  executionOptions: StoryRunExecutionOptions = {}
): Promise<StoryRunResult> {
  const runStartedAt = Date.now();
  const runSignal = executionOptions.abortSignal;
  ensureNotAborted(runSignal);
  validateStoryRunRequest(request);
  const prompt = asOptionalString(request.prompt) ?? "";

  const runtime = resolveModelRuntime(request.model_config);
  let llmCallCount = 0;
  const countedRunner: StructuredRunner = async (options) => {
    ensureNotAborted(runSignal);
    llmCallCount += 1;
    return runtime.runner({
      ...options,
      signal: runSignal
    });
  };
  const outputRoot = normalizeOutputRoot(request.output_root);
  const workspaceDir = request.workspace_dir
    ? ensureDirectory(request.workspace_dir)
    : createWorkspaceDirectory(outputRoot, "api-run");
  const initTitle = asOptionalString(request.title) ?? "API Story";
  ensureNotAborted(runSignal);

  onProgress?.({
    stage: "init",
    message: "Creating project scaffold..."
  });

  const initialProject = createBlankStoryProject(new Date().toISOString(), initTitle);
  initialProject.brief.seedPrompt = prompt;
  initialProject.meta.status = "bootstrapping";

  const createResult = createStoryProject(workspaceDir, initialProject);

  if (createResult.error || !createResult.projectId) {
    throwInternal(createResult.error ?? "Project could not be created.");
  }

  let project = await runBootstrapFromPrompt({
    workspaceDir,
    projectId: createResult.projectId,
    project: initialProject,
    prompt,
    model: runtime.model,
    runner: countedRunner,
    onProgress,
    abortSignal: runSignal
  });

  if (Array.isArray(request.edits) && request.edits.length > 0) {
    onProgress?.({
      stage: "edit",
      message: `Applying ${request.edits.length} edit operation(s)...`
    });

    const editResult = applySingleEdit(project, createResult.projectId, request.edits);
    project = persistProject(
      {
        workspaceDir,
        projectId: createResult.projectId,
        project
      },
      editResult.project
    );
  }

  const commitInputs = normalizeRunEvents(project, request.events);
  const commitFailures: Array<{ chapter_id: string; error: string }> = [];
  let commitSuccessCount = 0;

  if (commitInputs.length > 0) {
    onProgress?.({
      stage: "commit",
      message: `Committing ${commitInputs.length} chapter event(s)...`
    });
  }

  for (const commitInput of commitInputs) {
    ensureNotAborted(runSignal);
    onProgress?.({
      stage: `commit:${commitInput.chapterId}`,
      message: `Committing ${commitInput.chapterId}...`
    });

    try {
      const commitResult = await commitStoryEvent({
        cwd: workspaceDir,
        model: runtime.model,
        project,
        chapterId: commitInput.chapterId,
        eventText: commitInput.eventText || buildDefaultEventText(project, commitInput.chapterId),
        patchFilePath: null,
        force: commitInput.force,
        runner: countedRunner,
        abortSignal: runSignal
      });

      if (commitResult.ok) {
        project = persistProject(
          {
            workspaceDir,
            projectId: createResult.projectId,
            project
          },
          commitResult.project
        );
        commitSuccessCount += 1;
      } else {
        commitFailures.push({
          chapter_id: commitInput.chapterId,
          error: commitResult.message
        });
      }
    } catch (error) {
      commitFailures.push({
        chapter_id: commitInput.chapterId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  onProgress?.({
    stage: "ci",
    message: "Running CI checks..."
  });

  ensureNotAborted(runSignal);
  const ciResult = await runStoryCi({ project });
  project = persistProject(
    {
      workspaceDir,
      projectId: createResult.projectId,
      project
    },
    ciResult.project
  );

  const renderChapterIds = resolveChapterIds(
    project,
    request.render?.chapter_range,
    request.render?.chapter_ids
  );

  onProgress?.({
    stage: "render",
    message: `Rendering ${renderChapterIds.length} chapter(s)...`
  });

  const renderResult = await renderStoryChapters({
    cwd: workspaceDir,
    model: runtime.model,
    project,
    chapterIds: renderChapterIds,
    style: asOptionalString(request.render?.style) ?? null,
    force: request.render?.force === false ? false : true,
    runner: countedRunner,
    abortSignal: runSignal,
    maxConcurrency:
      typeof request.render?.max_concurrency === "number" && Number.isFinite(request.render.max_concurrency)
        ? Math.max(1, Math.floor(request.render.max_concurrency))
        : 1
  });

  project = persistProject(
    {
      workspaceDir,
      projectId: createResult.projectId,
      project
    },
    renderResult.project
  );

  const compileChapterIds = resolveChapterIds(
    project,
    request.compile?.chapter_range ?? request.render?.chapter_range,
    request.compile?.chapter_ids ?? request.render?.chapter_ids ?? renderChapterIds
  );
  const manuscriptPath = materializeCompileOutputPath(workspaceDir, request.compile?.output_path);
  ensureNotAborted(runSignal);

  onProgress?.({
    stage: "compile",
    message: `Compiling manuscript to ${manuscriptPath}...`
  });

  const compileResult = compileStoryChapters({
    cwd: workspaceDir,
    project,
    chapterIds: compileChapterIds,
    outputPath: manuscriptPath
  });
  const elapsedMs = Math.max(0, Date.now() - runStartedAt);

  const summary = {
    workspace_dir: workspaceDir,
    project_id: createResult.projectId,
    metrics: {
      elapsed_ms: elapsedMs,
      llm_calls: llmCallCount
    },
    ci: {
      passed: ciResult.report.passed,
      errors: ciResult.report.errors.length,
      warnings: ciResult.report.warnings.length
    },
    commits: {
      total: commitInputs.length,
      succeeded: commitSuccessCount,
      failed: commitFailures.length,
      failures: commitFailures
    },
    render: {
      chapter_ids: renderChapterIds,
      rendered: renderResult.rendered,
      skipped: renderResult.skipped
    },
    compile: {
      compiled_chapters: compileResult.compiledChapters,
      missing_chapters: compileResult.missingChapters,
      output_path: compileResult.outputPath
    }
  };
  const artifacts = writeRunArtifacts(workspaceDir, project, summary);

  onProgress?.({
    stage: "done",
    message: "Run completed."
  });

  return {
    workspace_dir: workspaceDir,
    project_id: createResult.projectId,
    manuscript_path: compileResult.outputPath,
    project_path: artifacts.projectPath,
    summary_path: artifacts.summaryPath,
    metrics: {
      elapsed_ms: elapsedMs,
      llm_calls: llmCallCount
    },
    ci: {
      passed: ciResult.report.passed,
      errors: ciResult.report.errors.length,
      warnings: ciResult.report.warnings.length
    },
    commits: {
      total: commitInputs.length,
      succeeded: commitSuccessCount,
      failed: commitFailures.length,
      failures: commitFailures
    },
    render: {
      chapter_ids: renderChapterIds,
      rendered: renderResult.rendered,
      skipped: renderResult.skipped
    },
    compile: {
      compiled_chapters: compileResult.compiledChapters,
      missing_chapters: compileResult.missingChapters
    }
  };
}

export function formatStageError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function buildFallbackEventsFromOutline(project: StoryProject): StoryEventInput[] {
  const chapters: ChapterPlan[] = [...project.outline].sort((left, right) => left.number - right.number);

  return chapters.map((chapter) => ({
    chapter_id: `ch${String(Math.max(1, chapter.number)).padStart(2, "0")}`,
    event_text: [chapter.summary, chapter.purpose, chapter.hook].filter(Boolean).join(" "),
    force: true
  }));
}
