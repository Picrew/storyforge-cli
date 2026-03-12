/**
 * Retry Novel 4: Quantum Rose only.
 *
 * Usage:
 *   cd /Users/lijunjie/Downloads/storyforge
 *   ./packages/cli/node_modules/.bin/tsx test-novel4-retry.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runStoryTask } from "./packages/cli/src/story/bootstrap.js";
import { createBlankStoryProject } from "./packages/cli/src/story/project-store.js";
import {
  commitStoryEvent,
  compileStoryChapters,
  renderStoryChapters,
  runStoryCi
} from "./packages/cli/src/story/simulation.js";
import {
  runStructuredPrompt,
  type StructuredRunner
} from "./packages/cli/src/story/structured-run.js";
import { syncApiCredential } from "./packages/cli/src/utils/opencode-auth.js";
import {
  getDefaultSessionConfigPath,
  loadSessionConfig
} from "./packages/cli/src/utils/session-config.js";

const plan = {
  title: "Novel 4: Quantum Rose",
  seedPrompt:
    "写一部近未来赛博朋克长篇科幻爱情小说。2049年的上海，量子计算工程师苏薇在一次实验事故中，" +
    "意识被分裂到了五条平行时间线中。在每条时间线里，她都遇到了同一个男人——谢朗，一个神秘的记忆修复师。" +
    "她逐渐发现，谢朗也在穿越时间线寻找她，但每一次重逢都会导致时间线产生不可逆的崩塌。" +
    "她必须在爱情与多元宇宙的存亡之间做出选择。" +
    "小说至少6章，每章目标3000字以上，总计目标20000字以上。" +
    "包含赛博朋克都市描写、量子力学隐喻、多时间线叙事结构、深刻的爱情哲学思考，以及一个令人心碎又充满希望的结局。" +
    "语言：简体中文。基调：浪漫、科幻、忧伤、哲学。",
  events: [
    { chapter: "ch01", event: "苏薇在量子实验室的一次意外中意识分裂，醒来发现世界微妙不同，街角多了一家从未见过的记忆修复诊所" },
    { chapter: "ch02", event: "苏薇在记忆修复诊所遇到谢朗，他似乎认识她但又否认；她在他的眼神中看到了另一个时间线的自己" },
    { chapter: "ch03", event: "苏薇学会在时间线之间跳跃，发现五条时间线中的自己过着截然不同的人生，但都在寻找谢朗" },
    { chapter: "ch04", event: "谢朗终于坦白：他是第六条已经崩塌的时间线的幸存者，那条线上他们曾经结婚，但他的穿越导致了那条线的毁灭" },
    { chapter: "ch05", event: "五条时间线开始连锁崩塌，苏薇和谢朗必须在最后一条时间线中找到稳定锚点，但锚点需要其中一人永远留在时间裂隙中" },
    { chapter: "ch06", event: "苏薇选择牺牲自己成为锚点，但谢朗在最后一刻修改了量子方程，两人都化为量子态存在于所有时间线的间隙中——永远在一起，却永远无法被观测" }
  ]
};

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

async function main() {
  console.log("Storyforge — Retry: Novel 4 Quantum Rose");
  console.log("==========================================\n");

  const config = loadSessionConfig(getDefaultSessionConfigPath());
  if (!config.connection?.apiKey) {
    console.error("ERROR: No API key found in ~/.storyforge/config.json");
    process.exit(1);
  }

  const model = config.model || "openrouter/stepfun/step-3.5-flash:free";
  console.log(`Model: ${model}`);

  const syncError = syncApiCredential(config.connection.provider, config.connection.apiKey);
  if (syncError) {
    console.error(`ERROR: Failed to sync credential: ${syncError}`);
    process.exit(1);
  }

  const outputDir = path.join(process.cwd(), "generated-novels", timestamp());
  fs.mkdirSync(outputDir, { recursive: true });
  console.log(`Output directory: ${outputDir}\n`);

  const stages: string[] = [];
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "storyforge-novel-"));
  const startTime = Date.now();

  console.log(`Working dir: ${cwd}`);

  // 1. Bootstrap (with up to 3 retries)
  let currentProject: any = null;
  let bootstrapOk = false;

  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`\n[1/5] Bootstrap attempt ${attempt}/3...`);
    const project = createBlankStoryProject(new Date().toISOString(), plan.title);
    project.meta.status = "awaiting_brief";
    project.brief.seedPrompt = plan.seedPrompt;
    project.meta.status = "bootstrapping";

    try {
      const result = await runStoryTask({
        cwd,
        model,
        project,
        runner: runStructuredPrompt,
        scope: "all",
        onStageStart: (p) => console.log(`  [bootstrap] ${p.message}`),
        onStageComplete: (p) => {
          console.log(`  [bootstrap] ${p.message}`);
          stages.push(`bootstrap:${p.stage}:ok`);
        }
      });

      if (result.ok) {
        currentProject = result.project;
        bootstrapOk = true;
        console.log(`  Bootstrap OK on attempt ${attempt}. Chapters: ${currentProject.outline.length}, Characters: ${currentProject.characters.length}`);
        break;
      } else {
        console.warn(`  Attempt ${attempt} failed: ${result.errorMessage}`);
        stages.push(`bootstrap:attempt${attempt}:FAIL`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  Attempt ${attempt} exception: ${msg}`);
      stages.push(`bootstrap:attempt${attempt}:EXCEPTION`);
    }
  }

  if (!bootstrapOk || !currentProject) {
    console.error("All bootstrap attempts failed.");
    process.exit(1);
  }

  // 2. Commit events
  console.log("\n[2/5] Committing story events...");
  for (const { chapter, event } of plan.events) {
    console.log(`  Committing ${chapter}: ${event.slice(0, 50)}...`);
    try {
      const commitResult = await commitStoryEvent({
        cwd, model,
        project: currentProject,
        chapterId: chapter,
        eventText: event,
        patchFilePath: null,
        force: true,
        runner: runStructuredPrompt
      });
      if (commitResult.ok) {
        currentProject = commitResult.project;
        console.log(`    => ${commitResult.message}`);
        stages.push(`commit:${chapter}:ok`);
      } else {
        console.warn(`    => WARN: ${commitResult.message}`);
        stages.push(`commit:${chapter}:blocked`);
      }
    } catch (err) {
      console.error(`    => ERROR: ${err instanceof Error ? err.message : err}`);
      stages.push(`commit:${chapter}:FAIL`);
    }
  }

  // 3. CI
  console.log("\n[3/5] Running CI...");
  try {
    const ciResult = await runStoryCi({ project: currentProject });
    currentProject = ciResult.project;
    console.log(`  CI: ${ciResult.report.passed ? "PASS" : "FAIL"} (${ciResult.report.errors.length} errors)`);
    stages.push(`ci:${ciResult.report.passed ? "pass" : "fail"}`);
  } catch (err) {
    console.error(`  CI ERROR: ${err instanceof Error ? err.message : err}`);
    stages.push("ci:EXCEPTION");
  }

  // 4. Render
  console.log("\n[4/5] Rendering chapters...");
  const chapterIds = currentProject.outline.map((ch: any) => `ch${String(ch.number).padStart(2, "0")}`);
  for (const { chapter } of plan.events) {
    if (!chapterIds.includes(chapter)) chapterIds.push(chapter);
  }
  chapterIds.sort();

  try {
    const renderResult = await renderStoryChapters({
      cwd, model,
      project: currentProject,
      chapterIds,
      style: null,
      force: true,
      runner: runStructuredPrompt,
      maxConcurrency: 3
    });
    currentProject = renderResult.project;
    console.log(`  Rendered: ${renderResult.rendered.join(", ") || "none"}`);
    stages.push(`render:${renderResult.rendered.length}chapters`);
  } catch (err) {
    console.error(`  Render ERROR: ${err instanceof Error ? err.message : err}`);
    stages.push("render:EXCEPTION");
  }

  // 5. Compile
  console.log("\n[5/5] Compiling manuscript...");
  const manuscriptDir = path.join(outputDir, "Novel_4__Quantum_Rose");
  const manuscriptPath = path.join(manuscriptDir, "manuscript.md");

  try {
    const compileResult = compileStoryChapters({
      cwd,
      project: currentProject,
      chapterIds,
      outputPath: manuscriptPath
    });
    console.log(`  Compiled: ${compileResult.compiledChapters.join(", ")}`);
    console.log(`  Output: ${compileResult.outputPath}`);
    stages.push(`compile:${compileResult.compiledChapters.length}chapters`);

    fs.mkdirSync(manuscriptDir, { recursive: true });
    fs.writeFileSync(path.join(manuscriptDir, "project.json"), JSON.stringify(currentProject, null, 2) + "\n", "utf8");

    const srcChapters = path.join(cwd, ".storyforge", "chapters");
    if (fs.existsSync(srcChapters)) {
      const destChapters = path.join(manuscriptDir, "chapters");
      fs.mkdirSync(destChapters, { recursive: true });
      for (const f of fs.readdirSync(srcChapters)) {
        fs.copyFileSync(path.join(srcChapters, f), path.join(destChapters, f));
      }
    }

    const content = fs.readFileSync(manuscriptPath, "utf8");
    console.log(`  Total characters: ${content.length}`);
  } catch (err) {
    console.error(`  Compile ERROR: ${err instanceof Error ? err.message : err}`);
    stages.push("compile:EXCEPTION");
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s`);
  console.log(`Stages: ${stages.join(" -> ")}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
