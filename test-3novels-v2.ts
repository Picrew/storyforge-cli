/**
 * Generate 3 NEW long novels using Storyforge — Batch 2.
 *
 * Usage:
 *   cd /Users/lijunjie/Downloads/storyforge
 *   pnpm exec tsx test-3novels-v2.ts
 *
 * Optional env for throughput tuning:
 *   STORYFORGE_NOVEL_CONCURRENCY=3
 *   STORYFORGE_MODEL_CONCURRENCY=3
 *   STORYFORGE_RENDER_CONCURRENCY=3
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

interface NovelPlan {
  title: string;
  seedPrompt: string;
  events: { chapter: string; event: string }[];
}

const novels: NovelPlan[] = [
  {
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
  },
  {
    title: "Novel 5: The Abyss Lighthouse",
    seedPrompt:
      "写一部克苏鲁风格的深海探险恐怖长篇小说。2031年，一支中国深海科考队在马里亚纳海沟最深处发现了一座不该存在的古老灯塔。" +
      "灯塔由未知材料建造，内部空间远大于外部，每下一层楼梯就进入一个完全不同的生态系统。" +
      "随着探索深入，队员们开始出现幻觉、失忆和身体异变。领队沈洋逐渐意识到，" +
      "灯塔不是人类建造的，它是某种沉睡亿万年的存在的感官器官，而他们的到来正在将它唤醒。" +
      "小说至少6章，每章目标3000字以上，总计目标20000字以上。" +
      "包含深海幽闭恐惧、宇宙恐怖、科学家的理性与疯狂的碰撞、详细的深海环境描写，以及一个绝望而壮阔的结局。" +
      "语言：简体中文。基调：恐怖、压抑、壮阔、绝望。",
    events: [
      { chapter: "ch01", event: "深海科考船'探渊号'在海沟底部声呐扫描发现异常结构，沈洋带队乘深潜器抵达，目睹灯塔在万米深海中散发微弱磷光" },
      { chapter: "ch02", event: "团队进入灯塔第一层，发现内部空间违反物理定律地广阔；墙壁上刻满了不属于任何已知文明的符号，生物学家王萱采集到的样本是活的" },
      { chapter: "ch03", event: "下到第三层时，通讯官陈磊开始用一种没人听过的语言自言自语；走廊尽头的镜面中映出的不是他们的倒影，而是另一群穿着不同时代服装的探险者" },
      { chapter: "ch04", event: "沈洋在第五层发现一个巨大的球形空间，中心悬浮着一颗缓慢跳动的器官；他意识到整座灯塔是一个生物体的一部分，它正在通过灯塔感知他们" },
      { chapter: "ch05", event: "队员们开始不可逆转地异变：有人长出鳃裂，有人皮肤变成半透明；沈洋在第七层找到了之前所有探险队的日志，最早的一份写于1万年前" },
      { chapter: "ch06", event: "灯塔开始'呼吸'，海水倒灌；沈洋引爆了所有炸药试图摧毁灯塔，但爆炸只是让那个存在'睁开了眼睛'——最后的镜头是卫星拍到整个海沟在发光" }
    ]
  },
  {
    title: "Novel 6: The Doomsday Bookshop",
    seedPrompt:
      "写一部后末日温情长篇小说。核冬天后的第七年，大部分城市已成废墟，幸存者在辐射荒原中艰难求生。" +
      "流浪者陆辰在一座被遗弃的小镇中发现了一家仍在亮着灯的书店，店主是一位自称活了三百年的老人季先生。" +
      "季先生说书店里的每一本书都曾属于一个已经消失的人，而只要有人读完一本书并真正理解它，书中的故事就会在现实中生长出一小片新的世界。" +
      "陆辰起初以为这是疯话，直到他读完第一本书后，书店门外的焦土上长出了一棵真正的树。" +
      "小说至少6章，每章目标3000字以上，总计目标20000字以上。" +
      "包含废土世界的荒凉与美感、书籍与文明的隐喻、温暖而克制的人物关系、对人类文明存亡的深层思考，以及一个充满希望的结局。" +
      "语言：简体中文。基调：温暖、忧伤、诗意、治愈。",
    events: [
      { chapter: "ch01", event: "陆辰在辐射风暴中逃入一座废弃小镇，发现'季氏书屋'亮着温暖的灯光；季先生给他一碗热粥和一个靠窗的阅读位" },
      { chapter: "ch02", event: "陆辰读完第一本书——一个园丁的日记，第二天书店门外的焦土上长出了一棵樱花树；他开始相信季先生的话，但也怀疑这是辐射导致的幻觉" },
      { chapter: "ch03", event: "更多流浪者被灯光吸引而来；一个失去女儿的母亲读完一本童话后，书店二楼出现了一个永远充满笑声的儿童房间" },
      { chapter: "ch04", event: "陆辰发现书店的地下室里有成千上万本未被阅读的书，每本书的扉页都写着主人的名字和死亡日期；季先生承认自己是'最后一个图书管理员'" },
      { chapter: "ch05", event: "一群武装匪徒要抢占书店作为据点；陆辰和其他读者保护书店，季先生取出一本从未打开的书——它记录的是这个世界核战前最后一天的故事" },
      { chapter: "ch06", event: "陆辰读完最后那本书，书店外的废墟开始缓慢重建；季先生笑着化为光点消散——他自己就是最后一本书的故事；小镇重新有了生机，陆辰成为新的书店守护者" }
    ]
  }
];

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.floor(parsed);
}

function createConcurrencyLimiter(maxConcurrency: number): <T>(task: () => Promise<T>) => Promise<T> {
  const normalized = Math.max(1, Math.floor(maxConcurrency));
  let activeRuns = 0;
  const waitQueue: Array<() => void> = [];

  const release = (): void => {
    activeRuns = Math.max(0, activeRuns - 1);

    if (waitQueue.length === 0) {
      return;
    }

    activeRuns += 1;
    const next = waitQueue.shift();
    next?.();
  };

  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (activeRuns >= normalized) {
      await new Promise<void>((resolve) => {
        waitQueue.push(resolve);
      });
    } else {
      activeRuns += 1;
    }

    try {
      return await task();
    } finally {
      release();
    }
  };
}

async function mapWithConcurrency<TItem, TResult>(
  items: readonly TItem[],
  maxConcurrency: number,
  worker: (item: TItem, index: number) => Promise<TResult>
): Promise<TResult[]> {
  if (items.length === 0) {
    return [];
  }

  const results = new Array<TResult>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, Math.floor(maxConcurrency)), items.length);

  const runWorker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

  return results;
}

function withModelConcurrency(baseRunner: StructuredRunner, maxConcurrency: number): StructuredRunner {
  const limit = createConcurrencyLimiter(maxConcurrency);

  return async (options) => limit(() => baseRunner(options));
}

async function generateNovel(
  plan: NovelPlan,
  model: string,
  outputDir: string,
  runner: StructuredRunner,
  renderConcurrency: number
): Promise<{
  ok: boolean;
  error: string | null;
  manuscriptPath: string | null;
  projectJson: string | null;
  stages: string[];
}> {
  const stages: string[] = [];
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "storyforge-novel-"));
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${plan.title}`);
  console.log(`  Working dir: ${cwd}`);
  console.log(`${"=".repeat(60)}`);

  // 1. Bootstrap
  console.log("\n[1/5] Bootstrapping story project...");
  const project = createBlankStoryProject(new Date().toISOString(), plan.title);
  project.meta.status = "awaiting_brief";
  project.brief.seedPrompt = plan.seedPrompt;
  project.meta.status = "bootstrapping";

  let currentProject = project;

  try {
    const bootstrapResult = await runStoryTask({
      cwd,
      model,
      project: currentProject,
      runner,
      scope: "all",
      onStageStart: (progress) => {
        console.log(`  [bootstrap] ${progress.message}`);
      },
      onStageComplete: (progress) => {
        console.log(`  [bootstrap] ${progress.message}`);
        stages.push(`bootstrap:${progress.stage}:ok`);
      }
    });

    if (!bootstrapResult.ok) {
      const errMsg = `Bootstrap failed at stage ${bootstrapResult.failedStage}: ${bootstrapResult.errorMessage}`;
      console.error(`  ERROR: ${errMsg}`);
      stages.push(`bootstrap:${bootstrapResult.failedStage}:FAIL`);
      return { ok: false, error: errMsg, manuscriptPath: null, projectJson: null, stages };
    }

    currentProject = bootstrapResult.project;
    console.log(`  Bootstrap complete. Title: ${currentProject.meta.title}`);
    console.log(`  Chapters in outline: ${currentProject.outline.length}`);
    console.log(`  Characters: ${currentProject.characters.length}`);
    console.log(`  Timeline beats: ${currentProject.timeline.length}`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`  ERROR: ${errMsg}`);
    stages.push("bootstrap:EXCEPTION");
    return { ok: false, error: errMsg, manuscriptPath: null, projectJson: null, stages };
  }

  // 2. Commit events
  console.log("\n[2/5] Committing story events...");
  for (const { chapter, event } of plan.events) {
    console.log(`  Committing ${chapter}: ${event.slice(0, 60)}...`);
    try {
      const commitResult = await commitStoryEvent({
        cwd,
        model,
        project: currentProject,
        chapterId: chapter,
        eventText: event,
        patchFilePath: null,
        force: true,
        runner
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
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`    => ERROR: ${errMsg}`);
      stages.push(`commit:${chapter}:FAIL`);
    }
  }

  // 3. CI
  console.log("\n[3/5] Running CI checks...");
  try {
    const ciResult = await runStoryCi({ project: currentProject });
    currentProject = ciResult.project;
    const errCount = ciResult.report.errors.length;
    const warnCount = ciResult.report.warnings.length;
    console.log(`  CI: ${ciResult.report.passed ? "PASS" : "FAIL"} (${errCount} errors, ${warnCount} warnings)`);
    if (errCount > 0) {
      for (const e of ciResult.report.errors) {
        console.log(`    [error] ${e.rule}: ${e.message}`);
      }
    }
    if (warnCount > 0) {
      for (const w of ciResult.report.warnings) {
        console.log(`    [warn] ${w.rule}: ${w.message}`);
      }
    }
    stages.push(`ci:${ciResult.report.passed ? "pass" : "fail"}`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`  CI ERROR: ${errMsg}`);
    stages.push("ci:EXCEPTION");
  }

  // 4. Render all chapters
  console.log("\n[4/5] Rendering chapters...");
  const chapterIds = currentProject.outline.map(ch => `ch${String(ch.number).padStart(2, "0")}`);
  for (const { chapter } of plan.events) {
    if (!chapterIds.includes(chapter)) {
      chapterIds.push(chapter);
    }
  }
  chapterIds.sort();

  try {
    const renderResult = await renderStoryChapters({
      cwd,
      model,
      project: currentProject,
      chapterIds,
      style: null,
      force: true,
      runner,
      maxConcurrency: renderConcurrency
    });
    currentProject = renderResult.project;
    console.log(`  Rendered: ${renderResult.rendered.join(", ") || "none"}`);
    console.log(`  Skipped: ${renderResult.skipped.join(", ") || "none"}`);
    stages.push(`render:${renderResult.rendered.length}chapters`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`  Render ERROR: ${errMsg}`);
    stages.push("render:EXCEPTION");
  }

  // 5. Compile manuscript
  console.log("\n[5/5] Compiling manuscript...");
  const manuscriptOutputDir = path.join(outputDir, plan.title.replace(/[^a-zA-Z0-9_\-]/g, "_"));
  const manuscriptPath = path.join(manuscriptOutputDir, "manuscript.md");

  try {
    const compileResult = compileStoryChapters({
      cwd,
      project: currentProject,
      chapterIds,
      outputPath: manuscriptPath
    });

    console.log(`  Compiled chapters: ${compileResult.compiledChapters.join(", ") || "none"}`);
    console.log(`  Missing chapters: ${compileResult.missingChapters.join(", ") || "none"}`);
    console.log(`  Output: ${compileResult.outputPath}`);
    stages.push(`compile:${compileResult.compiledChapters.length}chapters`);

    const projectJsonPath = path.join(manuscriptOutputDir, "project.json");
    fs.mkdirSync(manuscriptOutputDir, { recursive: true });
    fs.writeFileSync(projectJsonPath, JSON.stringify(currentProject, null, 2) + "\n", "utf8");

    const srcChaptersDir = path.join(cwd, ".storyforge", "chapters");
    if (fs.existsSync(srcChaptersDir)) {
      const destChaptersDir = path.join(manuscriptOutputDir, "chapters");
      fs.mkdirSync(destChaptersDir, { recursive: true });
      for (const f of fs.readdirSync(srcChaptersDir)) {
        fs.copyFileSync(path.join(srcChaptersDir, f), path.join(destChaptersDir, f));
      }
    }

    return {
      ok: true,
      error: null,
      manuscriptPath: compileResult.outputPath,
      projectJson: projectJsonPath,
      stages
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`  Compile ERROR: ${errMsg}`);
    stages.push("compile:EXCEPTION");
    return { ok: false, error: errMsg, manuscriptPath: null, projectJson: null, stages };
  }
}

async function main() {
  console.log("Storyforge 3-Novel Generator — Batch 2");
  console.log("========================================\n");

  // Run all 3 novels in parallel
  const novelConcurrency = parsePositiveInt(process.env.STORYFORGE_NOVEL_CONCURRENCY, 3);
  const modelConcurrency = parsePositiveInt(process.env.STORYFORGE_MODEL_CONCURRENCY, 3);
  const renderConcurrency = parsePositiveInt(process.env.STORYFORGE_RENDER_CONCURRENCY, 3);

  const config = loadSessionConfig(getDefaultSessionConfigPath());
  if (!config.connection?.apiKey) {
    console.error("ERROR: No API key found in ~/.storyforge/config.json");
    process.exit(1);
  }

  const model = config.model || "openrouter/stepfun/step-3.5-flash:free";
  console.log(`Provider: ${config.connection.provider}`);
  console.log(`Model: ${model}`);
  console.log(`Novel concurrency: ${novelConcurrency}`);
  console.log(`Model call concurrency cap: ${modelConcurrency}`);
  console.log(`Per-novel render concurrency: ${renderConcurrency}`);

  const syncError = syncApiCredential(config.connection.provider, config.connection.apiKey);
  if (syncError) {
    console.error(`ERROR: Failed to sync credential: ${syncError}`);
    process.exit(1);
  }

  const outputDir = path.join(process.cwd(), "generated-novels", timestamp());
  fs.mkdirSync(outputDir, { recursive: true });
  console.log(`Output directory: ${outputDir}\n`);

  const throttledRunner = withModelConcurrency(runStructuredPrompt, modelConcurrency);
  const startTime = Date.now();
  const results = await mapWithConcurrency(novels, novelConcurrency, async (plan) => {
    const novelStartTime = Date.now();

    try {
      const result = await generateNovel(
        plan,
        model,
        outputDir,
        throttledRunner,
        renderConcurrency
      );
      const elapsed = ((Date.now() - novelStartTime) / 1000).toFixed(1);
      console.log(`\n  => ${plan.title} completed in ${elapsed}s (${result.ok ? "SUCCESS" : "PARTIAL"})`);

      return {
        title: plan.title,
        ...result
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const elapsed = ((Date.now() - novelStartTime) / 1000).toFixed(1);
      console.error(`\n  => ${plan.title} FAILED in ${elapsed}s: ${errMsg}`);

      return {
        title: plan.title,
        ok: false,
        error: errMsg,
        manuscriptPath: null,
        projectJson: null,
        stages: ["FATAL"]
      };
    }
  });

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Summary
  console.log("\n\n" + "=".repeat(60));
  console.log("  SUMMARY");
  console.log("=".repeat(60));
  console.log(`Total time: ${totalElapsed}s\n`);

  for (const result of results) {
    console.log(`${result.ok ? "OK" : "FAIL"} | ${result.title}`);
    if (result.manuscriptPath) {
      console.log(`     Manuscript: ${result.manuscriptPath}`);
      try {
        const content = fs.readFileSync(result.manuscriptPath, "utf8");
        const wordCount = content.length;
        console.log(`     Characters: ${wordCount}`);
      } catch {}
    }
    if (result.error) {
      console.log(`     Error: ${result.error}`);
    }
    console.log(`     Stages: ${result.stages.join(" -> ")}`);
    console.log();
  }

  const summaryPath = path.join(outputDir, "summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(results, null, 2) + "\n", "utf8");
  console.log(`Summary saved to: ${summaryPath}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
