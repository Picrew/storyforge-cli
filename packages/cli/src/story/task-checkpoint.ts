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
  const value = JSON.parse(fs.readFileSync(checkpointPath, "utf8")) as StoryTaskCheckpoint;
  return {
    ...value,
    checkpointPath
  };
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
    .map((entry) => {
      try {
        return JSON.parse(
          fs.readFileSync(path.join(tasksDirectory, entry), "utf8")
        ) as StoryTaskCheckpoint;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is StoryTaskCheckpoint => Boolean(entry))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function findLatestIncompleteStoryTaskCheckpoint(
  cwd: string,
  projectId: string
): StoryTaskCheckpoint | null {
  return listStoryTaskCheckpoints(cwd, projectId)
    .find((entry) => entry.status !== "completed") ?? null;
}
