/**
 * Re-render Novel 10: 夜行列车 (补全缺失章节).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  compileStoryChapters,
  renderStoryChapters,
} from "./packages/cli/src/story/simulation.js";
import { runStructuredPrompt } from "./packages/cli/src/story/structured-run.js";
import { syncApiCredential } from "./packages/cli/src/utils/opencode-auth.js";
import {
  getDefaultSessionConfigPath,
  loadSessionConfig
} from "./packages/cli/src/utils/session-config.js";

async function main() {
  console.log("Re-render Novel 10: 夜行列车\n");

  const config = loadSessionConfig(getDefaultSessionConfigPath());
  if (!config.connection?.apiKey) { console.error("No API key"); process.exit(1); }

  const model = config.model || "openrouter/stepfun/step-3.5-flash:free";
  console.log(`Model: ${model}`);

  const syncError = syncApiCredential(config.connection.provider, config.connection.apiKey);
  if (syncError) { console.error(syncError); process.exit(1); }

  const projectPath = "/Users/lijunjie/Downloads/storyforge/generated-novels/2026-03-12T06-41-39/Novel_10__夜行列车/project.json";
  let project = JSON.parse(fs.readFileSync(projectPath, "utf8"));
  console.log(`Loaded project: ${project.meta.title}`);
  console.log(`Outline chapters: ${project.outline.length}`);

  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "storyforge-rerender-"));
  console.log(`Working dir: ${cwd}`);

  // Copy existing rendered chapters so we only re-render missing ones
  const outputDir = "/Users/lijunjie/Downloads/storyforge/generated-novels/2026-03-12T06-41-39/Novel_10__夜行列车";
  const existingChaptersDir = path.join(outputDir, "chapters");
  const targetChaptersDir = path.join(cwd, ".storyforge", "chapters");
  fs.mkdirSync(targetChaptersDir, { recursive: true });

  if (fs.existsSync(existingChaptersDir)) {
    for (const f of fs.readdirSync(existingChaptersDir)) {
      fs.copyFileSync(path.join(existingChaptersDir, f), path.join(targetChaptersDir, f));
      console.log(`  Copied existing: ${f}`);
    }
  }

  const chapterIds = project.outline.map((ch: any) => `ch${String(ch.number).padStart(2, "0")}`);
  chapterIds.sort();
  console.log(`\nAll chapters: ${chapterIds.join(", ")}`);

  const startTime = Date.now();

  // Render with force to fill in missing chapters
  console.log("\n[1/2] Rendering chapters...");
  try {
    const renderResult = await renderStoryChapters({
      cwd, model, project,
      chapterIds, style: null, force: true,
      runner: runStructuredPrompt,
      maxConcurrency: 3
    });
    project = renderResult.project;
    console.log(`  Rendered: ${renderResult.rendered.join(", ") || "none"}`);
    console.log(`  Skipped: ${renderResult.skipped.join(", ") || "none"}`);
  } catch (err) {
    console.error(`  Render ERROR: ${err instanceof Error ? err.message : err}`);
  }

  // Compile
  console.log("\n[2/2] Compiling manuscript...");
  const manuscriptPath = path.join(outputDir, "manuscript.md");

  try {
    const compileResult = compileStoryChapters({
      cwd, project, chapterIds, outputPath: manuscriptPath
    });
    console.log(`  Compiled: ${compileResult.compiledChapters.join(", ") || "none"}`);
    console.log(`  Missing: ${compileResult.missingChapters.join(", ") || "none"}`);
    console.log(`  Output: ${compileResult.outputPath}`);

    fs.writeFileSync(path.join(outputDir, "project.json"), JSON.stringify(project, null, 2) + "\n", "utf8");

    const srcChapters = path.join(cwd, ".storyforge", "chapters");
    if (fs.existsSync(srcChapters)) {
      fs.mkdirSync(existingChaptersDir, { recursive: true });
      for (const f of fs.readdirSync(srcChapters)) {
        fs.copyFileSync(path.join(srcChapters, f), path.join(existingChaptersDir, f));
      }
    }

    const content = fs.readFileSync(manuscriptPath, "utf8");
    console.log(`\n  总字数: ${content.length}`);
  } catch (err) {
    console.error(`  Compile ERROR: ${err instanceof Error ? err.message : err}`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s`);
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
