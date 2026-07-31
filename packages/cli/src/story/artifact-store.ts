import fs from "node:fs";
import path from "node:path";

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
