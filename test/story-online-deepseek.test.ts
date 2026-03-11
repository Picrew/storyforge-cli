import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runStoryTask } from "../packages/cli/src/story/bootstrap.js";
import { createBlankStoryProject } from "../packages/cli/src/story/project-store.js";
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
import {
  getDefaultSessionConfigPath,
  loadSessionConfig
} from "../packages/cli/src/utils/session-config.js";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "storyforge-online-"));
}

describe("online deepseek story pipeline", () => {
  it(
    "runs init->commit->ci->render->compile with deepseek",
    { timeout: 300_000 },
    async () => {
      const config = loadSessionConfig(getDefaultSessionConfigPath());

      if (!config.connection?.apiKey) {
        throw new Error("DeepSeek online test requires a saved API key in ~/.storyforge/config.json.");
      }

      if (config.connection.provider !== "deepseek") {
        throw new Error("DeepSeek online test requires the active provider to be deepseek.");
      }

      const model = config.model || "deepseek/deepseek-chat";
      const syncError = syncApiCredential("deepseek", config.connection.apiKey);

      if (syncError) {
        throw new Error(`Failed to sync DeepSeek credential: ${syncError}`);
      }

      const cwd = makeTempDir();
      const initialized = createBlankStoryProject("2026-03-12T00:00:00.000Z", "Online Story");

      initialized.meta.status = "awaiting_brief";
      initialized.brief.seedPrompt =
        "Write a compact thriller setup with two chapters. Keep continuity strict.";
      initialized.meta.status = "bootstrapping";

      const bootstrapResult = await runStoryTask({
        cwd,
        model,
        project: initialized,
        runner: runStructuredPrompt,
        scope: "all"
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
        model,
        project: ciResult.project,
        chapterIds: ["ch01"],
        style: "hardboiled",
        force: true,
        runner: runStructuredPrompt
      });

      expect(renderResult.rendered).toContain("ch01");

      const compileResult = compileStoryChapters({
        cwd,
        project: renderResult.project,
        chapterIds: ["ch01"],
        outputPath: null
      });

      expect(compileResult.missingChapters).toEqual([]);
      expect(fs.existsSync(compileResult.outputPath)).toBe(true);
    }
  );
});
