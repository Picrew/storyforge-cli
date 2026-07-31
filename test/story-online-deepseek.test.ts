import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runStoryTask } from "../packages/cli/src/story/bootstrap.js";
import {
  createBlankStoryProject,
  createStoryProject,
  loadStoryProject,
  loadStoryWorkspace
} from "../packages/cli/src/story/project-store.js";
import { findLatestStoryTaskCheckpoint } from "../packages/cli/src/story/task-checkpoint.js";
import type { StoryProject } from "../packages/cli/src/story/types.js";
import {
  commitStoryEvent,
  compileStoryChapters,
  renderStoryChapters,
  runStoryCi
} from "../packages/cli/src/story/simulation.js";
import { runStructuredPrompt } from "../packages/cli/src/story/structured-run.js";
import {
  syncApiCredential
} from "../packages/cli/src/utils/opencode-auth.js";
import { getProviderApiKey } from "../packages/cli/src/utils/provider-api.js";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "storyforge-online-"));
}

describe("online deepseek story pipeline", () => {
  it(
    "runs init->commit->ci->render->compile with deepseek",
    { timeout: 600_000 },
    async () => {
      const apiKey = getProviderApiKey("deepseek");
      if (!apiKey) {
        throw new Error("DeepSeek online test requires a saved DeepSeek API key or DEEPSEEK_API_KEY.");
      }
      const model = "deepseek/deepseek-v4-flash";
      const syncError = syncApiCredential("deepseek", apiKey);

      if (syncError) {
        throw new Error(`Failed to sync DeepSeek credential: ${syncError}`);
      }

      const resumeDir = process.env.STORYFORGE_ONLINE_RESUME_DIR?.trim();
      const cwd = resumeDir || makeTempDir();
      let projectId: string;
      let initialized: StoryProject;
      let resumeTaskId: string | undefined;

      if (resumeDir) {
        const workspace = loadStoryWorkspace(cwd);
        if (!workspace.activeProjectId) {
          throw new Error("Resume workspace has no active project.");
        }
        projectId = workspace.activeProjectId;
        const loadedProject = loadStoryProject(cwd, projectId);
        if (!loadedProject) {
          throw new Error("Resume project could not be loaded.");
        }
        initialized = loadedProject;
        resumeTaskId = findLatestStoryTaskCheckpoint(cwd, projectId)?.id;
      } else {
        initialized = createBlankStoryProject("2026-03-12T00:00:00.000Z", "Online Story");
        initialized.meta.status = "awaiting_brief";
        initialized.brief.seedPrompt =
          "Write a compact thriller setup with two chapters. Keep continuity strict.";
        initialized.meta.status = "bootstrapping";
        const created = createStoryProject(cwd, initialized);
        if (!created.projectId) {
          throw new Error(created.error || "Failed to create test project.");
        }
        projectId = created.projectId;
      }

      const bootstrapResult = await runStoryTask({
        cwd,
        projectId,
        model,
        project: initialized,
        runner: runStructuredPrompt,
        scope: "all",
        taskId: resumeTaskId,
        resume: Boolean(resumeTaskId)
      });

      expect(bootstrapResult.ok).toBe(true);
      expect(bootstrapResult.project.outline.length).toBeGreaterThan(0);

      const commitResult = await commitStoryEvent({
        cwd,
        model,
        project: bootstrapResult.project,
        chapterId: "ch01",
        eventText: "Mira discovers a coded ledger in the conference basement.",
        patchFilePath: null,
        force: true,
        runner: runStructuredPrompt
      });

      expect(commitResult.ok).toBe(true);

      const ciResult = await runStoryCi({
        project: commitResult.project
      });

      expect(ciResult.report.scope).toBe("all");
      expect(ciResult.report.ranAt.length).toBeGreaterThan(0);

      const renderResult = await renderStoryChapters({
        cwd,
        projectId,
        model,
        project: ciResult.project,
        chapterIds: ["ch01"],
        style: "hardboiled",
        force: true,
        validateOutput: true,
        runner: runStructuredPrompt
      });

      expect(renderResult.rendered).toContain("ch01");

      const compileResult = compileStoryChapters({
        cwd,
        projectId,
        project: renderResult.project,
        chapterIds: ["ch01"],
        outputPath: null
      });

      expect(compileResult.missingChapters).toEqual([]);
      expect(fs.existsSync(compileResult.outputPath)).toBe(true);
    }
  );
});
