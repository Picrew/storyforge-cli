import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ensureStoryArtifactDirectories } from "./artifact-store.js";

export type StoryTaskCheckpointStatus =
  | "pending"
  | "running"
  | "failed"
  | "cancelled"
  | "completed";

export interface StoryTaskCheckpoint {
  version: 1;
  id: string;
  projectId: string;
  kind: string;
  scope: string;
  status: StoryTaskCheckpointStatus;
  stages: string[];
  completedStages: string[];
  currentStage: string | null;
  stageIndex: number;
  totalStages: number;
  retryCount: number;
  startedAt: string;
  updatedAt: string;
  elapsedMs: number;
  errorMessage: string | null;
  checkpointPath: string;
}

function assertSafeTaskId(taskId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(taskId)) {
    throw new Error(`Invalid task id: ${taskId}`);
  }
}

function getTasksDirectory(cwd: string, projectId: string): string {
  return path.join(ensureStoryArtifactDirectories(cwd, projectId).cache, "tasks");
}

const CHECKPOINT_STATUSES = new Set<StoryTaskCheckpointStatus>([
  "pending",
  "running",
  "failed",
  "cancelled",
  "completed"
]);

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function parseCheckpoint(
  value: unknown,
  expectedProjectId: string,
  checkpointPath: string
): StoryTaskCheckpoint {
  if (!value || typeof value !== "object") {
    throw new Error("checkpoint root must be an object");
  }
  const record = value as Record<string, unknown>;
  const validDate = (entry: unknown): entry is string =>
    typeof entry === "string" && Number.isFinite(Date.parse(entry));
  const validNumber = (entry: unknown): entry is number =>
    typeof entry === "number" && Number.isFinite(entry) && entry >= 0;

  if (
    record.version !== 1 ||
    typeof record.id !== "string" ||
    record.projectId !== expectedProjectId ||
    typeof record.kind !== "string" ||
    typeof record.scope !== "string" ||
    typeof record.status !== "string" ||
    !CHECKPOINT_STATUSES.has(record.status as StoryTaskCheckpointStatus) ||
    !isStringArray(record.stages) ||
    !isStringArray(record.completedStages) ||
    !(record.currentStage === null || typeof record.currentStage === "string") ||
    !validNumber(record.stageIndex) ||
    !validNumber(record.totalStages) ||
    !validNumber(record.retryCount) ||
    !validDate(record.startedAt) ||
    !validDate(record.updatedAt) ||
    !validNumber(record.elapsedMs) ||
    !(record.errorMessage === null || typeof record.errorMessage === "string")
  ) {
    throw new Error("checkpoint schema or project ownership is invalid");
  }

  const stages = record.stages;
  const completedStages = record.completedStages;
  if (
    record.totalStages !== stages.length ||
    record.stageIndex > record.totalStages ||
    completedStages.some((stage) => !stages.includes(stage)) ||
    (typeof record.currentStage === "string" && !stages.includes(record.currentStage))
  ) {
    throw new Error("checkpoint stage progress is inconsistent");
  }

  return {
    ...(record as unknown as StoryTaskCheckpoint),
    checkpointPath
  };
}

function quarantineCheckpoint(checkpointPath: string): string {
  const quarantinePath = `${checkpointPath}.corrupt-${Date.now()}`;
  fs.renameSync(checkpointPath, quarantinePath);
  return quarantinePath;
}

export function getStoryTaskCheckpointPath(
  cwd: string,
  projectId: string,
  taskId: string
): string {
  assertSafeTaskId(taskId);
  return path.join(getTasksDirectory(cwd, projectId), `${taskId}.json`);
}

export function saveStoryTaskCheckpoint(
  cwd: string,
  checkpoint: StoryTaskCheckpoint
): StoryTaskCheckpoint {
  const checkpointPath = getStoryTaskCheckpointPath(cwd, checkpoint.projectId, checkpoint.id);
  const next = {
    ...checkpoint,
    updatedAt: new Date().toISOString(),
    elapsedMs: Math.max(
      checkpoint.elapsedMs,
      Date.now() - new Date(checkpoint.startedAt).getTime()
    ),
    checkpointPath
  };
  const tempPath = `${checkpointPath}.tmp`;

  fs.mkdirSync(path.dirname(checkpointPath), { recursive: true });
  fs.writeFileSync(tempPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, checkpointPath);
  return next;
}

export function createStoryTaskCheckpoint(options: {
  cwd: string;
  projectId: string;
  kind: string;
  scope: string;
  stages: readonly string[];
  taskId?: string;
}): StoryTaskCheckpoint {
  const now = new Date().toISOString();
  const taskId = options.taskId ?? randomUUID();
  const checkpoint: StoryTaskCheckpoint = {
    version: 1,
    id: taskId,
    projectId: options.projectId,
    kind: options.kind,
    scope: options.scope,
    status: "pending",
    stages: [...options.stages],
    completedStages: [],
    currentStage: null,
    stageIndex: 0,
    totalStages: options.stages.length,
    retryCount: 0,
    startedAt: now,
    updatedAt: now,
    elapsedMs: 0,
    errorMessage: null,
    checkpointPath: getStoryTaskCheckpointPath(options.cwd, options.projectId, taskId)
  };
  return saveStoryTaskCheckpoint(options.cwd, checkpoint);
}

export function loadStoryTaskCheckpoint(
  cwd: string,
  projectId: string,
  taskId: string
): StoryTaskCheckpoint | null {
  const checkpointPath = getStoryTaskCheckpointPath(cwd, projectId, taskId);
  if (!fs.existsSync(checkpointPath)) {
    return null;
  }
  try {
    const value = JSON.parse(fs.readFileSync(checkpointPath, "utf8")) as unknown;
    return parseCheckpoint(value, projectId, checkpointPath);
  } catch (error) {
    const quarantinePath = quarantineCheckpoint(checkpointPath);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Invalid story task checkpoint was quarantined at ${quarantinePath}: ${message}`,
      { cause: error }
    );
  }
}

export function findLatestStoryTaskCheckpoint(
  cwd: string,
  projectId: string,
  kind?: string
): StoryTaskCheckpoint | null {
  return listStoryTaskCheckpoints(cwd, projectId)
    .find((entry) => !kind || entry.kind === kind) ?? null;
}

function listStoryTaskCheckpoints(
  cwd: string,
  projectId: string
): StoryTaskCheckpoint[] {
  const tasksDirectory = getTasksDirectory(cwd, projectId);
  if (!fs.existsSync(tasksDirectory)) {
    return [];
  }
  return fs.readdirSync(tasksDirectory)
    .filter((entry) => entry.endsWith(".json") && !entry.endsWith(".tmp"))
    .map((entry) =>
      loadStoryTaskCheckpoint(cwd, projectId, entry.slice(0, -".json".length))
    )
    .filter((entry): entry is StoryTaskCheckpoint => entry !== null)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function findLatestIncompleteStoryTaskCheckpoint(
  cwd: string,
  projectId: string
): StoryTaskCheckpoint | null {
  return listStoryTaskCheckpoints(cwd, projectId)
    .find((entry) => entry.status !== "completed") ?? null;
}
