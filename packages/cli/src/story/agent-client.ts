import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EventPatchOp, StoryCiReport, StoryProject } from "./types.js";

interface StoryAgentBaseResponse {
  ok: boolean;
  error?: string;
}

interface StoryAgentApplyPatchResponse extends StoryAgentBaseResponse {
  next_state: StoryProject;
  patch_ops: EventPatchOp[];
  reads: string[];
  writes: string[];
}

interface StoryAgentPlanPatchResponse extends StoryAgentBaseResponse {
  patch_ops: EventPatchOp[];
  reads: string[];
  writes: string[];
}

interface StoryAgentRunCiResponse extends StoryAgentBaseResponse {
  ci_report: StoryCiReport;
}

interface StoryAgentBuildImpactResponse extends StoryAgentBaseResponse {
  next_state: StoryProject;
  dependency_graph: StoryProject["dependencyGraph"];
  dirty_chapters: string[];
}

function getPythonCommand(): string {
  return process.env.STORYFORGE_PYTHON_BIN?.trim() || "python3";
}

function resolveStoryAgentScriptPath(): string {
  const localPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../story_agent.py"
  );
  const cwdPath = path.resolve(process.cwd(), "packages/cli/story_agent.py");

  if (fs.existsSync(localPath)) {
    return localPath;
  }

  if (fs.existsSync(cwdPath)) {
    return cwdPath;
  }

  throw new Error(`story_agent.py was not found. Checked: ${localPath}, ${cwdPath}`);
}

function runStoryAgent<TResponse extends StoryAgentBaseResponse>(payload: Record<string, unknown>): Promise<TResponse> {
  const scriptPath = resolveStoryAgentScriptPath();
  const python = getPythonCommand();

  return new Promise<TResponse>((resolve, reject) => {
    const child = execFile(
      python,
      [scriptPath],
      {
        maxBuffer: 4 * 1024 * 1024
      },
      (error, stdout, stderr) => {
        const raw = stdout.trim();

        if (!raw) {
          const message = stderr.trim() || error?.message || "Story agent returned empty output.";
          reject(new Error(message));
          return;
        }

        let parsed: TResponse;

        try {
          parsed = JSON.parse(raw) as TResponse;
        } catch (parseError) {
          reject(
            new Error(
              `Story agent returned invalid JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`
            )
          );
          return;
        }

        if (!parsed.ok) {
          reject(new Error(parsed.error || "Story agent action failed."));
          return;
        }

        resolve(parsed);
      }
    );

    const requestBody = `${JSON.stringify(payload)}\n`;

    child.stdin?.write(requestBody, "utf8");
    child.stdin?.end();
  });
}

export async function planPatchWithAgent(
  projectState: StoryProject,
  chapterId: string,
  eventText: string
): Promise<StoryAgentPlanPatchResponse> {
  return runStoryAgent<StoryAgentPlanPatchResponse>({
    action: "plan_patch",
    project_state: projectState,
    chapter_id: chapterId,
    event_text: eventText
  });
}

export async function applyPatchWithAgent(
  projectState: StoryProject,
  chapterId: string,
  patchOps: readonly EventPatchOp[],
  reads: readonly string[],
  writes: readonly string[]
): Promise<StoryAgentApplyPatchResponse> {
  return runStoryAgent<StoryAgentApplyPatchResponse>({
    action: "apply_patch",
    project_state: projectState,
    chapter_id: chapterId,
    patch_ops: patchOps,
    reads,
    writes
  });
}

export async function runCiWithAgent(
  projectState: StoryProject,
  scope: "all" | "commit" = "all",
  commitId: string | null = null
): Promise<StoryAgentRunCiResponse> {
  return runStoryAgent<StoryAgentRunCiResponse>({
    action: "run_ci",
    project_state: projectState,
    scope,
    commit_id: commitId
  });
}

export async function buildImpactWithAgent(
  projectState: StoryProject
): Promise<StoryAgentBuildImpactResponse> {
  return runStoryAgent<StoryAgentBuildImpactResponse>({
    action: "build_impact",
    project_state: projectState
  });
}
