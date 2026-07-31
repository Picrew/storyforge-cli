import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { StoryLibraryEntry, StoryProject } from "./types.js";

const STORY_ROOT_DIR = ".storyforge";
const LEGACY_PROJECT_FILE = "project.json";
const WORKSPACE_FILE = "workspace.json";
const PROJECTS_DIR = "projects";
const LEGACY_PROJECT_ID = "legacy";

interface StoryWorkspaceFile {
  version: 1;
  activeProjectId: string | null;
  projects: StoryLibraryEntry[];
}

export interface LoadedStoryWorkspace {
  activeProjectId: string | null;
  projects: StoryLibraryEntry[];
  activeProject: StoryProject | null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown, fallback: string = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown, fallback: boolean = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeStoryStatus(value: unknown): StoryLibraryEntry["status"] {
  return value === "awaiting_brief" ||
    value === "bootstrapping" ||
    value === "ready" ||
    value === "partial" ||
    value === "empty"
    ? value
    : "empty";
}

function createWorkspaceRootPath(cwd: string): string {
  return path.join(cwd, STORY_ROOT_DIR);
}

function resolveWorkspaceRelativePath(cwd: string, relativeFile: string): string {
  if (!relativeFile || path.isAbsolute(relativeFile)) {
    throw new Error(`Invalid story project file path: ${relativeFile || "(empty)"}`);
  }

  const workspaceRoot = path.resolve(createWorkspaceRootPath(cwd));
  const resolvedPath = path.resolve(workspaceRoot, relativeFile);

  if (resolvedPath !== workspaceRoot && !resolvedPath.startsWith(`${workspaceRoot}${path.sep}`)) {
    throw new Error(`Story project file escapes its workspace: ${relativeFile}`);
  }

  return resolvedPath;
}

function isSafeWorkspaceRelativePath(relativeFile: string): boolean {
  if (!relativeFile || path.isAbsolute(relativeFile)) {
    return false;
  }

  const normalized = path.normalize(relativeFile);
  return normalized !== ".." && !normalized.startsWith(`..${path.sep}`);
}

function createWorkspaceFileData(
  activeProjectId: string | null,
  projects: readonly StoryLibraryEntry[]
): StoryWorkspaceFile {
  return {
    version: 1,
    activeProjectId,
    projects: projects.map((entry) => ({ ...entry }))
  };
}

function writeJsonFileAtomic(filePath: string, value: unknown): string | null {
  const directory = path.dirname(filePath);
  const tempPath = `${filePath}.tmp`;

  try {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.renameSync(tempPath, filePath);
    return null;
  } catch (error) {
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch {
      // Ignore cleanup failures and return the original error.
    }

    return error instanceof Error ? error.message : String(error);
  }
}

function createStoryLibraryEntry(
  projectId: string,
  projectFile: string,
  project: StoryProject
): StoryLibraryEntry {
  return {
    id: projectId,
    title: project.meta.title,
    status: project.meta.status,
    createdAt: project.meta.createdAt,
    updatedAt: project.meta.updatedAt,
    file: projectFile
  };
}

function normalizeStoryLibraryEntry(value: unknown, index: number): StoryLibraryEntry | null {
  if (!isObject(value)) {
    return null;
  }

  const id = asString(value.id, `project-${index + 1}`).trim();
  const file = asString(value.file).trim();

  if (!id || !file || !isSafeWorkspaceRelativePath(file)) {
    return null;
  }

  return {
    id,
    title: asString(value.title, "Untitled Story") || "Untitled Story",
    status: normalizeStoryStatus(value.status),
    createdAt: asString(value.createdAt, new Date(0).toISOString()) || new Date(0).toISOString(),
    updatedAt: asString(value.updatedAt, new Date(0).toISOString()) || new Date(0).toISOString(),
    file
  };
}

function normalizeWorkspaceFile(value: unknown): StoryWorkspaceFile {
  if (!isObject(value)) {
    return createWorkspaceFileData(null, []);
  }

  const projects = Array.isArray(value.projects)
    ? value.projects
        .map((entry, index) => normalizeStoryLibraryEntry(entry, index))
        .filter((entry): entry is StoryLibraryEntry => Boolean(entry))
    : [];
  const activeProjectId = asString(value.activeProjectId).trim() || null;

  return createWorkspaceFileData(
    activeProjectId && projects.some((entry) => entry.id === activeProjectId)
      ? activeProjectId
      : projects[0]?.id ?? null,
    projects
  );
}

function readProjectFile(projectPath: string): StoryProject {
  const raw = fs.readFileSync(projectPath, "utf8");
  return normalizeStoryProject(JSON.parse(raw));
}

function loadWorkspaceFile(cwd: string): StoryWorkspaceFile | null {
  const workspacePath = getStoryWorkspacePath(cwd);

  if (!fs.existsSync(workspacePath)) {
    return null;
  }

  const raw = fs.readFileSync(workspacePath, "utf8");
  return normalizeWorkspaceFile(JSON.parse(raw));
}

function resolveActiveProjectId(
  workspace: StoryWorkspaceFile,
  requestedProjectId?: string | null
): string | null {
  if (requestedProjectId) {
    return workspace.projects.some((entry) => entry.id === requestedProjectId)
      ? requestedProjectId
      : null;
  }

  if (workspace.activeProjectId && workspace.projects.some((entry) => entry.id === workspace.activeProjectId)) {
    return workspace.activeProjectId;
  }

  return workspace.projects[0]?.id ?? null;
}

function upsertStoryLibraryEntry(
  entries: readonly StoryLibraryEntry[],
  nextEntry: StoryLibraryEntry
): StoryLibraryEntry[] {
  const nextEntries = entries.map((entry) =>
    entry.id === nextEntry.id ? nextEntry : entry
  );

  if (nextEntries.some((entry) => entry.id === nextEntry.id)) {
    return nextEntries;
  }

  return [...nextEntries, nextEntry];
}

function writeWorkspaceFile(
  cwd: string,
  activeProjectId: string | null,
  projects: readonly StoryLibraryEntry[]
): string | null {
  return writeJsonFileAtomic(
    getStoryWorkspacePath(cwd),
    createWorkspaceFileData(activeProjectId, projects)
  );
}

function createActiveProjectSelection(
  cwd: string,
  requestedProjectId?: string | null
): {
  workspace: StoryWorkspaceFile;
  projectId: string | null;
  projectEntry: StoryLibraryEntry | null;
} {
  const workspace = loadWorkspaceFile(cwd);

  if (workspace) {
    const projectId = resolveActiveProjectId(workspace, requestedProjectId);
    const projectEntry = projectId
      ? workspace.projects.find((entry) => entry.id === projectId) ?? null
      : null;

    return {
      workspace,
      projectId,
      projectEntry
    };
  }

  const legacyPath = getStoryProjectPath(cwd);

  if (!fs.existsSync(legacyPath)) {
    return {
      workspace: createWorkspaceFileData(null, []),
      projectId: null,
      projectEntry: null
    };
  }

  const legacyProject = readProjectFile(legacyPath);
  const legacyEntry = createStoryLibraryEntry(
    LEGACY_PROJECT_ID,
    LEGACY_PROJECT_FILE,
    legacyProject
  );
  const legacyWorkspace = createWorkspaceFileData(LEGACY_PROJECT_ID, [legacyEntry]);

  return {
    workspace: legacyWorkspace,
    projectId: LEGACY_PROJECT_ID,
    projectEntry: requestedProjectId && requestedProjectId !== LEGACY_PROJECT_ID ? null : legacyEntry
  };
}

export function getStoryProjectPath(cwd: string): string {
  return path.join(createWorkspaceRootPath(cwd), LEGACY_PROJECT_FILE);
}

export function getStoryWorkspacePath(cwd: string): string {
  return path.join(createWorkspaceRootPath(cwd), WORKSPACE_FILE);
}

export function getStoryProjectAbsolutePath(
  cwd: string,
  projectId: string | null,
  projects: readonly StoryLibraryEntry[]
): string {
  const relativeFile =
    (projectId ? projects.find((entry) => entry.id === projectId)?.file : null) ??
    LEGACY_PROJECT_FILE;

  return resolveWorkspaceRelativePath(cwd, relativeFile);
}

export function createBlankStoryProject(
  now: string = new Date().toISOString(),
  title: string = "Untitled Story"
): StoryProject {
  return {
    version: 2,
    meta: {
      title,
      status: "empty",
      createdAt: now,
      updatedAt: now
    },
    brief: {
      seedPrompt: "",
      genre: "",
      targetWords: null,
      language: "English",
      tone: "",
      premise: ""
    },
    world: {
      premise: "",
      setting: "",
      tone: "",
      rules: "",
      stakes: "",
      resolutionShape: ""
    },
    characters: [],
    timeline: [],
    outline: [],
    eventCommits: [],
    inventory: [],
    foreshadows: [],
    dependencyGraph: {
      edges: [],
      updatedAt: now
    },
    chapterRenders: [],
    ciHistory: [],
    dirtyChapters: []
  };
}

export function normalizeStoryProject(value: unknown): StoryProject {
  const fallback = createBlankStoryProject();

  if (!isObject(value)) {
    return fallback;
  }

  const meta = isObject(value.meta) ? value.meta : {};
  const brief = isObject(value.brief) ? value.brief : {};
  const world = isObject(value.world) ? value.world : {};
  const characters = Array.isArray(value.characters) ? value.characters : [];
  const timeline = Array.isArray(value.timeline) ? value.timeline : [];
  const outline = Array.isArray(value.outline) ? value.outline : [];
  const eventCommits = Array.isArray(value.eventCommits) ? value.eventCommits : [];
  const inventory = Array.isArray(value.inventory) ? value.inventory : [];
  const foreshadows = Array.isArray(value.foreshadows) ? value.foreshadows : [];
  const dependencyGraph = isObject(value.dependencyGraph) ? value.dependencyGraph : {};
  const chapterRenders = Array.isArray(value.chapterRenders) ? value.chapterRenders : [];
  const ciHistory = Array.isArray(value.ciHistory) ? value.ciHistory : [];
  const dirtyChapters = Array.isArray(value.dirtyChapters) ? value.dirtyChapters : [];

  return {
    version: 2,
    meta: {
      title: asString(meta.title, fallback.meta.title) || fallback.meta.title,
      status: normalizeStoryStatus(meta.status),
      createdAt: asString(meta.createdAt, fallback.meta.createdAt) || fallback.meta.createdAt,
      updatedAt: asString(meta.updatedAt, fallback.meta.updatedAt) || fallback.meta.updatedAt
    },
    brief: {
      seedPrompt: asString(brief.seedPrompt),
      genre: asString(brief.genre),
      targetWords: asNullableNumber(brief.targetWords),
      language: asString(brief.language, fallback.brief.language) || fallback.brief.language,
      tone: asString(brief.tone),
      premise: asString(brief.premise)
    },
    world: {
      premise: asString(world.premise),
      setting: asString(world.setting),
      tone: asString(world.tone),
      rules: asString(world.rules),
      stakes: asString(world.stakes),
      resolutionShape: asString(world.resolutionShape)
    },
    characters: characters
      .filter(isObject)
      .map((entry, index) => ({
        id: asString(entry.id, `character-${index + 1}`),
        name: asString(entry.name),
        role: asString(entry.role),
        age: asString(entry.age),
        description: asString(entry.description),
        motivation: asString(entry.motivation),
        conflict: asString(entry.conflict),
        arc: asString(entry.arc),
        relationships: asString(entry.relationships),
        tags: asString(entry.tags)
      })),
    timeline: timeline
      .filter(isObject)
      .map((entry, index) => ({
        id: asString(entry.id, `timeline-${index + 1}`),
        label: asString(entry.label),
        summary: asString(entry.summary),
        chapterRef: asString(entry.chapterRef),
        stakes: asString(entry.stakes),
        notes: asString(entry.notes)
      })),
    outline: outline
      .filter(isObject)
      .map((entry, index) => ({
        id: asString(entry.id, `outline-${index + 1}`),
        number:
          typeof entry.number === "number" && Number.isFinite(entry.number)
            ? entry.number
            : index + 1,
        title: asString(entry.title),
        purpose: asString(entry.purpose),
        summary: asString(entry.summary),
        hook: asString(entry.hook),
        targetWords: asNullableNumber(entry.targetWords)
      })),
    eventCommits: eventCommits
      .filter(isObject)
      .map((entry, index) => ({
        id: asString(entry.id, `commit-${index + 1}`),
        chapterId: asString(entry.chapterId, "ch01"),
        createdAt: asString(entry.createdAt, fallback.meta.updatedAt),
        message: asString(entry.message),
        patchOps: Array.isArray(entry.patchOps)
          ? entry.patchOps
              .filter(isObject)
              .map((op) => ({
                op: asString(op.op),
                target: asString(op.target),
                payload: isObject(op.payload) ? op.payload : {}
              }))
          : [],
        reads: Array.isArray(entry.reads)
          ? entry.reads
              .filter((token) => typeof token === "string")
              .map((token) => token.trim())
              .filter(Boolean)
          : [],
        writes: Array.isArray(entry.writes)
          ? entry.writes
              .filter((token) => typeof token === "string")
              .map((token) => token.trim())
              .filter(Boolean)
          : [],
        forced: asBoolean(entry.forced, false),
        ciPassed: asBoolean(entry.ciPassed, false),
        ciReport: isObject(entry.ciReport)
          ? {
              ranAt: asString(entry.ciReport.ranAt, fallback.meta.updatedAt),
              scope: entry.ciReport.scope === "commit" ? "commit" : "all",
              passed: asBoolean(entry.ciReport.passed, false),
              errors: Array.isArray(entry.ciReport.errors)
                ? entry.ciReport.errors
                    .filter(isObject)
                    .map((issue) => ({
                      rule: asString(issue.rule),
                      severity: "error" as const,
                      message: asString(issue.message),
                      chapterId: asString(issue.chapterId) || undefined,
                      commitId: asString(issue.commitId) || undefined
                    }))
                : [],
              warnings: Array.isArray(entry.ciReport.warnings)
                ? entry.ciReport.warnings
                    .filter(isObject)
                    .map((issue) => ({
                      rule: asString(issue.rule),
                      severity: "warning" as const,
                      message: asString(issue.message),
                      chapterId: asString(issue.chapterId) || undefined,
                      commitId: asString(issue.commitId) || undefined
                    }))
                : []
            }
          : null
      })),
    inventory: inventory
      .filter(isObject)
      .map((entry, index) => ({
        id: asString(entry.id, `item-${index + 1}`),
        name: asString(entry.name, `Item ${index + 1}`),
        holders: isObject(entry.holders)
          ? Object.fromEntries(
              Object.entries(entry.holders)
                .filter(([, qty]) => typeof qty === "number" && Number.isFinite(qty))
                .map(([holder, qty]) => [holder, Math.max(0, Math.round(Number(qty)))])
            )
          : {},
        total: typeof entry.total === "number" && Number.isFinite(entry.total)
          ? Math.max(0, Math.round(entry.total))
          : 0,
        status: entry.status === "consumed" ? "consumed" : "active",
        notes: asString(entry.notes)
      })),
    foreshadows: foreshadows
      .filter(isObject)
      .map((entry, index) => ({
        id: asString(entry.id, `foreshadow-${index + 1}`),
        label: asString(entry.label, `Foreshadow ${index + 1}`),
        introducedChapter: asString(entry.introducedChapter, "ch01"),
        dueChapter: asString(entry.dueChapter, "ch01"),
        resolvedChapter: asString(entry.resolvedChapter) || null,
        status: entry.status === "resolved" ? "resolved" : "open",
        notes: asString(entry.notes)
      })),
    dependencyGraph: {
      edges: Array.isArray(dependencyGraph.edges)
        ? dependencyGraph.edges
            .filter(isObject)
            .map((edge) => ({
              from: asString(edge.from),
              to: asString(edge.to),
              key: asString(edge.key)
            }))
            .filter((edge) => Boolean(edge.from && edge.to && edge.key))
        : [],
      updatedAt: asString(dependencyGraph.updatedAt, fallback.meta.updatedAt)
    },
    chapterRenders: chapterRenders
      .filter(isObject)
      .map((entry) => ({
        chapterId: asString(entry.chapterId, "ch01"),
        file: asString(entry.file),
        renderedAt: asString(entry.renderedAt, fallback.meta.updatedAt),
        model: asString(entry.model),
        commitIds: Array.isArray(entry.commitIds)
          ? entry.commitIds
              .filter((id) => typeof id === "string")
              .map((id) => id.trim())
              .filter(Boolean)
          : [],
        dirty: asBoolean(entry.dirty, false)
      })),
    ciHistory: ciHistory
      .filter(isObject)
      .map((entry) => ({
        ranAt: asString(entry.ranAt, fallback.meta.updatedAt),
        scope: entry.scope === "commit" ? "commit" : "all",
        passed: asBoolean(entry.passed, false),
        errors: Array.isArray(entry.errors)
          ? entry.errors
              .filter(isObject)
              .map((issue) => ({
                rule: asString(issue.rule),
                severity: "error" as const,
                message: asString(issue.message),
                chapterId: asString(issue.chapterId) || undefined,
                commitId: asString(issue.commitId) || undefined
              }))
          : [],
        warnings: Array.isArray(entry.warnings)
          ? entry.warnings
              .filter(isObject)
              .map((issue) => ({
                rule: asString(issue.rule),
                severity: "warning" as const,
                message: asString(issue.message),
                chapterId: asString(issue.chapterId) || undefined,
                commitId: asString(issue.commitId) || undefined
              }))
          : []
      })),
    dirtyChapters: dirtyChapters
      .filter((chapter) => typeof chapter === "string")
      .map((chapter) => chapter.trim())
      .filter(Boolean)
  };
}

export function loadStoryWorkspace(cwd: string): LoadedStoryWorkspace {
  const { workspace, projectId, projectEntry } = createActiveProjectSelection(cwd);

  return {
    activeProjectId: projectId,
    projects: workspace.projects,
    activeProject: projectEntry
      ? readProjectFile(resolveWorkspaceRelativePath(cwd, projectEntry.file))
      : null
  };
}

export function loadStoryProject(cwd: string, projectId?: string | null): StoryProject | null {
  const { projectEntry } = createActiveProjectSelection(cwd, projectId);

  if (!projectEntry) {
    return null;
  }

  return readProjectFile(resolveWorkspaceRelativePath(cwd, projectEntry.file));
}

export function createStoryProject(cwd: string, project: StoryProject): {
  error: string | null;
  projectId: string | null;
  projects: StoryLibraryEntry[];
} {
  const { workspace } = createActiveProjectSelection(cwd);
  const projectId = randomUUID();
  const projectFile = path.join(PROJECTS_DIR, `${projectId}.json`);
  const projectPath = resolveWorkspaceRelativePath(cwd, projectFile);
  const entry = createStoryLibraryEntry(projectId, projectFile, project);
  const nextProjects = [...workspace.projects, entry];
  const writeError = writeJsonFileAtomic(projectPath, project);

  if (writeError) {
    return {
      error: writeError,
      projectId: null,
      projects: workspace.projects
    };
  }

  const workspaceError = writeWorkspaceFile(cwd, projectId, nextProjects);

  return {
    error: workspaceError,
    projectId,
    projects: nextProjects
  };
}

export function saveStoryProject(
  cwd: string,
  project: StoryProject,
  projectId?: string | null
): string | null {
  const { workspace, projectId: activeProjectId, projectEntry } = createActiveProjectSelection(
    cwd,
    projectId
  );

  if (projectId && workspace.projects.length > 0 && !projectEntry) {
    return `Unknown story project: ${projectId}`;
  }

  const resolvedProjectId = activeProjectId ?? projectId ?? LEGACY_PROJECT_ID;
  const resolvedFile = projectEntry?.file ??
    (resolvedProjectId !== LEGACY_PROJECT_ID
      ? path.join(PROJECTS_DIR, `${resolvedProjectId}.json`)
      : LEGACY_PROJECT_FILE);
  const projectPath = resolveWorkspaceRelativePath(cwd, resolvedFile);
  const projectError = writeJsonFileAtomic(projectPath, project);

  if (projectError) {
    return projectError;
  }

  const nextEntry = createStoryLibraryEntry(resolvedProjectId, resolvedFile, project);
  const nextProjects = upsertStoryLibraryEntry(workspace.projects, nextEntry);

  return writeWorkspaceFile(cwd, resolvedProjectId, nextProjects);
}

export function setActiveStoryProject(cwd: string, projectId: string): string | null {
  const { workspace } = createActiveProjectSelection(cwd);

  if (!workspace.projects.some((entry) => entry.id === projectId)) {
    return `Unknown story project: ${projectId}`;
  }

  return writeWorkspaceFile(cwd, projectId, workspace.projects);
}

export function resetStoryProject(cwd: string, projectId?: string | null, now?: string): StoryProject {
  const { workspace, projectId: activeProjectId } = createActiveProjectSelection(cwd, projectId);
  const resolvedProjectId = activeProjectId ?? workspace.activeProjectId;

  if (!resolvedProjectId) {
    throw new Error("Run /init first to create a story project.");
  }

  const project = createBlankStoryProject(now);
  const saveError = saveStoryProject(cwd, project, resolvedProjectId);

  if (saveError) {
    throw new Error(saveError);
  }

  return project;
}
