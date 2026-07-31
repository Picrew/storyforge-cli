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
      markerPath
    };
  }

  const copiedFiles: string[] = [];
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
    copyFileIfMissing(source, path.join(paths.chapters, `${chapterId}.md`), copiedFiles);
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
    markerPath
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
