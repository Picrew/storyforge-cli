import fs from "node:fs";
import path from "node:path";
import type { StoryProject } from "./types.js";

const STORY_ROOT_DIR = ".storyforge";
const ARTIFACTS_DIR = "artifacts";
const LEGACY_PROJECT_ID = "legacy";
const SAFE_PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export interface StoryArtifactPaths {
  projectRoot: string;
  chapters: string;
  manuscript: string;
  logs: string;
  cache: string;
}

export interface StoryArtifactMigrationReport {
  migrated: boolean;
  copiedFiles: string[];
  markerPath: string;
  conflicts: string[];
  warnings: string[];
}

export function normalizeArtifactProjectId(projectId?: string | null): string {
  const normalized = projectId?.trim() || LEGACY_PROJECT_ID;

  if (!SAFE_PROJECT_ID.test(normalized) || normalized === "." || normalized === "..") {
    throw new Error(`Invalid story project id: ${normalized}`);
  }

  return normalized;
}

export function getStoryArtifactPaths(cwd: string, projectId?: string | null): StoryArtifactPaths {
  if (projectId === undefined || projectId === null) {
    const projectRoot = path.join(cwd, STORY_ROOT_DIR);
    return {
      projectRoot,
      chapters: path.join(projectRoot, "chapters"),
      manuscript: path.join(projectRoot, "manuscript"),
      logs: path.join(projectRoot, "logs"),
      cache: path.join(projectRoot, "cache")
    };
  }

  const normalizedProjectId = normalizeArtifactProjectId(projectId);
  const projectRoot = path.join(cwd, STORY_ROOT_DIR, ARTIFACTS_DIR, normalizedProjectId);

  return {
    projectRoot,
    chapters: path.join(projectRoot, "chapters"),
    manuscript: path.join(projectRoot, "manuscript"),
    logs: path.join(projectRoot, "logs"),
    cache: path.join(projectRoot, "cache")
  };
}

export function ensureStoryArtifactDirectories(
  cwd: string,
  projectId?: string | null
): StoryArtifactPaths {
  const paths = getStoryArtifactPaths(cwd, projectId);

  for (const directory of Object.values(paths)) {
    fs.mkdirSync(directory, { recursive: true });
  }

  return paths;
}

function resolveLegacyArtifactPath(cwd: string, relativePath: string): string | null {
  const storyRoot = path.resolve(cwd, STORY_ROOT_DIR);
  const resolved = path.resolve(storyRoot, relativePath);
  return resolved.startsWith(`${storyRoot}${path.sep}`) ? resolved : null;
}

function copyFileIfMissing(source: string, destination: string, copiedFiles: string[]): void {
  if (!fs.existsSync(source) || fs.existsSync(destination) || !fs.statSync(source).isFile()) {
    return;
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  copiedFiles.push(destination);
}

function copyDirectoryContents(
  source: string,
  destination: string,
  copiedFiles: string[],
  ignoredNames: ReadonlySet<string> = new Set()
): void {
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
    return;
  }
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (ignoredNames.has(entry.name)) {
      continue;
    }
    const sourceEntry = path.join(source, entry.name);
    const destinationEntry = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryContents(sourceEntry, destinationEntry, copiedFiles, ignoredNames);
    } else if (entry.isFile()) {
      copyFileIfMissing(sourceEntry, destinationEntry, copiedFiles);
    }
  }
}

function findOtherLegacyOwners(
  cwd: string,
  currentProjectId: string,
  chapterId: string,
  source: string
): string[] {
  const workspacePath = path.join(cwd, STORY_ROOT_DIR, "workspace.json");
  if (!fs.existsSync(workspacePath)) {
    return [];
  }

  try {
    const workspace = JSON.parse(fs.readFileSync(workspacePath, "utf8")) as {
      projects?: Array<{ id?: unknown; file?: unknown }>;
    };
    return (workspace.projects ?? []).flatMap((entry) => {
      if (
        typeof entry.id !== "string" ||
        entry.id === currentProjectId ||
        typeof entry.file !== "string"
      ) {
        return [];
      }
      const projectPath = path.resolve(cwd, STORY_ROOT_DIR, entry.file);
      const storyRoot = path.resolve(cwd, STORY_ROOT_DIR);
      if (!projectPath.startsWith(`${storyRoot}${path.sep}`) || !fs.existsSync(projectPath)) {
        return [];
      }
      const candidate = JSON.parse(fs.readFileSync(projectPath, "utf8")) as {
        chapterRenders?: Array<{ chapterId?: unknown; file?: unknown }>;
      };
      const sharesSource = (candidate.chapterRenders ?? []).some((render) => {
        if (render.chapterId !== chapterId || typeof render.file !== "string") {
          return false;
        }
        return resolveLegacyArtifactPath(cwd, render.file) === source;
      });
      return sharesSource ? [entry.id] : [];
    });
  } catch {
    return [];
  }
}

export function migrateLegacyStoryArtifacts(
  cwd: string,
  projectId: string,
  project: StoryProject
): StoryArtifactMigrationReport {
  const paths = ensureStoryArtifactDirectories(cwd, projectId);
  const markerPath = path.join(paths.cache, "artifact-migration-v1.json");

  if (fs.existsSync(markerPath)) {
    return {
      migrated: false,
      copiedFiles: [],
      markerPath,
      conflicts: [],
      warnings: []
    };
  }

  const copiedFiles: string[] = [];
  const conflicts: string[] = [];
  const warnings: string[] = [];
  const legacyChapters = path.join(cwd, STORY_ROOT_DIR, "chapters");
  const chapterSources = new Map<string, string>();

  for (const render of project.chapterRenders) {
    const chapterId = render.chapterId.trim();
    if (!/^ch0*[1-9]\d*$/i.test(chapterId)) {
      continue;
    }
    const recordedSource = render.file
      ? resolveLegacyArtifactPath(cwd, render.file)
      : null;
    const fallbackSource = path.join(legacyChapters, `${chapterId}.md`);
    chapterSources.set(
      chapterId,
      recordedSource && fs.existsSync(recordedSource) ? recordedSource : fallbackSource
    );
  }

  if (projectId === LEGACY_PROJECT_ID && chapterSources.size === 0 && fs.existsSync(legacyChapters)) {
    for (const entry of fs.readdirSync(legacyChapters, { withFileTypes: true })) {
      if (entry.isFile() && /^ch0*[1-9]\d*\.md$/i.test(entry.name)) {
        chapterSources.set(path.basename(entry.name, ".md"), path.join(legacyChapters, entry.name));
      }
    }
  }

  for (const [chapterId, source] of chapterSources) {
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
      warnings.push(`No legacy artifact was found for ${chapterId}.`);
      continue;
    }
    const otherOwners = findOtherLegacyOwners(cwd, projectId, chapterId, source);
    if (otherOwners.length > 0) {
      conflicts.push(
        `${chapterId} is also referenced by project(s): ${otherOwners.join(", ")}`
      );
      continue;
    }
    copyFileIfMissing(source, path.join(paths.chapters, `${chapterId}.md`), copiedFiles);
    const render = project.chapterRenders.find((entry) => entry.chapterId === chapterId);
    if (render) {
      render.file = path.relative(
        path.join(cwd, STORY_ROOT_DIR),
        path.join(paths.chapters, `${chapterId}.md`)
      );
    }
  }

  if (conflicts.length > 0) {
    const conflictPath = path.join(paths.logs, "artifact-migration-conflicts.json");
    fs.writeFileSync(conflictPath, `${JSON.stringify({
      version: 1,
      projectId,
      detectedAt: new Date().toISOString(),
      conflicts,
      warnings
    }, null, 2)}\n`, "utf8");
    return {
      migrated: false,
      copiedFiles,
      markerPath,
      conflicts,
      warnings
    };
  }

  const hasLegacySource = [...chapterSources.values()].some(
    (source) => fs.existsSync(source) && fs.statSync(source).isFile()
  );
  if (!hasLegacySource) {
    return {
      migrated: false,
      copiedFiles: [],
      markerPath,
      conflicts,
      warnings
    };
  }

  if (copiedFiles.length > 0) {
    const legacyManuscript = path.join(cwd, STORY_ROOT_DIR, "manuscript", "story.md");
    copyFileIfMissing(legacyManuscript, path.join(paths.manuscript, "story.md"), copiedFiles);
  }

  if (chapterSources.size > 0 || projectId === LEGACY_PROJECT_ID) {
    copyDirectoryContents(
      path.join(cwd, STORY_ROOT_DIR, "logs"),
      paths.logs,
      copiedFiles
    );
    copyDirectoryContents(
      path.join(cwd, STORY_ROOT_DIR, "cache"),
      paths.cache,
      copiedFiles,
      new Set([ARTIFACTS_DIR])
    );
  }

  fs.writeFileSync(markerPath, `${JSON.stringify({
    version: 1,
    projectId,
    migratedAt: new Date().toISOString(),
    copiedFiles: copiedFiles.map((file) => path.relative(paths.projectRoot, file))
  }, null, 2)}\n`, "utf8");

  return {
    migrated: copiedFiles.length > 0,
    copiedFiles,
    markerPath,
    conflicts,
    warnings
  };
}

export function writeStoryArtifactJson(
  cwd: string,
  projectId: string,
  area: "logs" | "cache",
  fileName: string,
  value: unknown
): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/.test(fileName)) {
    throw new Error(`Invalid artifact file name: ${fileName}`);
  }
  const paths = ensureStoryArtifactDirectories(cwd, projectId);
  const outputPath = path.join(paths[area], fileName);
  const tempPath = `${outputPath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, outputPath);
  return outputPath;
}
