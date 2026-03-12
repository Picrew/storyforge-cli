/**
 * Re-render Novel 9: 深海牧鲸人 (project state already built, just render + compile).
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
  console.log("Re-render Novel 9: 深海牧鲸人\n");

  const config = loadSessionConfig(getDefaultSessionConfigPath());
  if (!config.connection?.apiKey) { console.error("No API key"); process.exit(1); }

  const model = config.model || "openrouter/stepfun/step-3.5-flash:free";
  console.log(`Model: ${model}`);

  const syncError = syncApiCredential(config.connection.provider, config.connection.apiKey);
  if (syncError) { console.error(syncError); process.exit(1); }

  // Load saved project state
  const projectPath = "/Users/lijunjie/Downloads/storyforge/generated-novels/2026-03-12T06-04-37/Novel_9__深海牧鲸人/project.json";
  let project = JSON.parse(fs.readFileSync(projectPath, "utf8"));
  console.log(`Loaded project: ${project.meta.title}`);
  console.log(`Outline chapters: ${project.outline.length}`);

  // Fresh working directory
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "storyforge-rerender-"));
  console.log(`Working dir: ${cwd}\n`);

  const chapterIds = project.outline.map((ch: any) => `ch${String(ch.number).padStart(2, "0")}`);
  chapterIds.sort();
  console.log(`Chapters to render: ${chapterIds.join(", ")}`);

  const startTime = Date.now();

  // Render
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
  const outputDir = "/Users/lijunjie/Downloads/storyforge/generated-novels/2026-03-12T06-04-37/Novel_9__深海牧鲸人";
  const manuscriptPath = path.join(outputDir, "manuscript.md");

  try {
    const compileResult = compileStoryChapters({
      cwd, project, chapterIds, outputPath: manuscriptPath
    });
    console.log(`  Compiled: ${compileResult.compiledChapters.join(", ") || "none"}`);
    console.log(`  Missing: ${compileResult.missingChapters.join(", ") || "none"}`);
    console.log(`  Output: ${compileResult.outputPath}`);

    // Update project.json
    fs.writeFileSync(path.join(outputDir, "project.json"), JSON.stringify(project, null, 2) + "\n", "utf8");

    // Copy rendered chapters
    const srcChapters = path.join(cwd, ".storyforge", "chapters");
    if (fs.existsSync(srcChapters)) {
      const destChapters = path.join(outputDir, "chapters");
      fs.mkdirSync(destChapters, { recursive: true });
      for (const f of fs.readdirSync(srcChapters)) {
        fs.copyFileSync(path.join(srcChapters, f), path.join(destChapters, f));
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
