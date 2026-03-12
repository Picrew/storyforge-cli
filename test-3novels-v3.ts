/**
 * Generate 3 NEW Chinese novels — Batch 3.
 *
 * Usage:
 *   cd /Users/lijunjie/Downloads/storyforge
 *   ./packages/cli/node_modules/.bin/tsx test-3novels-v3.ts
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
    title: "Novel 7: 镜中棋局",
    seedPrompt:
      "【重要：本小说必须全部使用简体中文撰写，包括所有章节正文、对话、描写、叙述，不得出现英文。】\n\n" +
      "写一部长篇悬疑推理小说《镜中棋局》。故事设定在2024年的杭州。" +
      "天才棋手陈奕在一场围棋人机大赛的直播中突然暴毙，死因被判定为心脏骤停。" +
      "但他的妹妹陈瑶——一名法医——在尸检中发现了不可能存在的神经毒素痕迹。" +
      "随着调查深入，她发现哥哥生前卷入了一个利用AI围棋程序操纵赌博的地下网络，" +
      "而这个网络的幕后操控者竟然隐藏在围棋协会的最高层。每个嫌疑人都像棋盘上的棋子，" +
      "各有不可告人的秘密。当陈瑶逼近真相时，她发现自己也已经成为棋局中的一枚棋子。" +
      "小说至少6章，每章目标3000字以上，总计目标20000字以上。" +
      "包含缜密的推理逻辑、围棋文化与AI技术的融合、复杂的人物关系网、反转迭出的剧情，以及一个出人意料的结局。" +
      "语言：必须全部使用简体中文。基调：冷峻、智性、紧张、烧脑。",
    events: [
      { chapter: "ch01", event: "围棋人机大赛直播现场，陈奕在第127手落子后突然倒地身亡；陈瑶在太平间发现哥哥指甲缝里嵌着一枚微型芯片" },
      { chapter: "ch02", event: "陈瑶破解芯片中的加密数据，发现一组神秘的围棋棋谱和一串地下赌场的交易记录；她开始秘密调查陈奕生前的社交圈" },
      { chapter: "ch03", event: "陈瑶接触到陈奕的AI合作伙伴方远，一个天才程序员；方远透露他们开发的AI不仅能下棋，还能预测人类的决策模式" },
      { chapter: "ch04", event: "赌博网络的打手警告陈瑶停止调查；她的公寓被纵火，所幸她不在家；与此同时她发现围棋协会副会长与地下网络有关" },
      { chapter: "ch05", event: "陈瑶设下圈套，利用方远的AI系统引诱幕后黑手现身；在一场秘密的线上围棋对决中，对手的棋风暴露了其真实身份" },
      { chapter: "ch06", event: "终极对决：陈瑶在围棋协会年度晚宴上公开揭露真相——杀害陈奕的正是他最信任的导师；但导师留下的遗书揭示了一个更深的秘密：陈奕自己也是共犯" }
    ]
  },
  {
    title: "Novel 8: 长安蜃楼",
    seedPrompt:
      "【重要：本小说必须全部使用简体中文撰写，包括所有章节正文、对话、描写、叙述，不得出现英文。】\n\n" +
      "写一部长篇历史奇幻小说《长安蜃楼》。故事设定在唐朝天宝年间的长安城。" +
      "一个来自西域的年轻乐师阿史那·云从因为一曲惊世的琵琶演奏被召入宫廷，" +
      "却意外发现长安城上空每逢月圆之夜会出现一座海市蜃楼般的幻影之城。" +
      "幻影中的长安是一百年后的废墟——安史之乱后的断壁残垣。" +
      "他逐渐发现自己的音乐能够打开现实与幻影之间的通道，" +
      "而朝中有人想利用这条通道改变历史。他必须在守护历史的命运与拯救他所爱之人之间做出选择。" +
      "小说至少6章，每章目标3000字以上，总计目标20000字以上。" +
      "包含盛唐长安的繁华景象、西域文化元素、宫廷权谋、音乐与时空的奇幻设定、深刻的宿命感，以及一个余韵悠长的结局。" +
      "语言：必须全部使用简体中文。基调：华丽、苍凉、奇幻、诗意。",
    events: [
      { chapter: "ch01", event: "阿史那·云从随商队抵达长安，在平康坊的酒肆中即兴演奏引发轰动；一位神秘的道士告诉他'你的琴声能穿透时间'" },
      { chapter: "ch02", event: "云从被召入梨园，在一次月夜独奏时亲眼目睹长安上空出现了另一座城的幻影——残破的城墙、焚毁的宫殿；他从幻影中听到了哭喊声" },
      { chapter: "ch03", event: "云从在宫中结识了杨贵妃的侍女玉环，她也能看到幻影之城；两人秘密探索发现，每演奏一次通道就会更加稳固，但也让两个时空的边界变薄" },
      { chapter: "ch04", event: "权臣李林甫得知幻影通道的存在，试图利用它窥探未来以巩固权力；云从被迫为李林甫演奏，在幻影中看到了安禄山叛乱的全过程" },
      { chapter: "ch05", event: "云从试图警告唐玄宗安史之乱的到来，却被当作妖言惑众下狱；玉环帮他越狱，两人逃入幻影通道，来到了一百年后荒凉的长安废墟" },
      { chapter: "ch06", event: "在废墟中云从找到了一块刻着他名字的石碑——他注定要留在未来修复时间裂隙；他用最后一曲将玉环送回盛唐，自己化为长安城墙上永恒的回声" }
    ]
  },
  {
    title: "Novel 9: 深海牧鲸人",
    seedPrompt:
      "【重要：本小说必须全部使用简体中文撰写，包括所有章节正文、对话、描写、叙述，不得出现英文。】\n\n" +
      "写一部长篇现实主义与魔幻现实主义交融的小说《深海牧鲸人》。故事跨越三代人，从1960年代的福建沿海渔村到2020年代的深圳。" +
      "爷爷林海生是最后一代传统捕鲸人，他声称能听到鲸鱼的歌声并与之对话；" +
      "父亲林建国在改革开放中离开渔村进城打工，一生与海洋决裂；" +
      "孙女林潮声是海洋生物学博士，在研究鲸鱼声呐时发现了爷爷的录音磁带——" +
      "磁带中记录的鲸歌包含了某种无法用科学解释的信息编码。" +
      "三代人的命运因这片海域而纠缠，最终在一次百年难遇的鲸群回游中交汇。" +
      "小说至少6章，每章目标3000字以上，总计目标20000字以上。" +
      "包含闽南渔村风俗、三代人的命运变迁、海洋的壮美与残酷、科学与民间传说的碰撞，以及一个充满诗意的和解结局。" +
      "语言：必须全部使用简体中文，可适当融入闽南方言词汇增加真实感。基调：厚重、温情、壮阔、魔幻。",
    events: [
      { chapter: "ch01", event: "2023年，林潮声在整理去世爷爷的遗物时发现一盒1972年录制的磁带；播放后她听到了从未在任何数据库中出现过的鲸鱼叫声" },
      { chapter: "ch02", event: "闪回1965年：年轻的林海生独自驾船出海，在暴风雨中被一头蓝鲸救起；他开始相信鲸鱼拥有智慧，从此放弃捕鲸转而保护它们，被全村视为疯子" },
      { chapter: "ch03", event: "1988年：林建国决定离开渔村去深圳打工；临行前与父亲大吵一架，林海生说'你走了就再也听不到海的声音了'；建国头也不回地离开了" },
      { chapter: "ch04", event: "林潮声用现代声学分析磁带，发现鲸歌中隐藏着类似语言的结构；她的导师认为这是突破性发现，但学术界质疑这是伪科学" },
      { chapter: "ch05", event: "林建国突发中风住院，在病床上第一次对女儿讲起渔村的往事；他承认这辈子最后悔的事是没有在父亲临终前回去，那时林海生独自面朝大海去世" },
      { chapter: "ch06", event: "林潮声带着爷爷的磁带回到渔村老屋，在海边播放录音；一群蓝鲸出现在近海回应，她终于理解了爷爷一生守护的秘密——鲸鱼的歌声中编码着这片海域千年的记忆" }
    ]
  }
];

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.floor(parsed);
}

function createConcurrencyLimiter(maxConcurrency: number): <T>(task: () => Promise<T>) => Promise<T> {
  const normalized = Math.max(1, Math.floor(maxConcurrency));
  let activeRuns = 0;
  const waitQueue: Array<() => void> = [];

  const release = (): void => {
    activeRuns = Math.max(0, activeRuns - 1);
    if (waitQueue.length === 0) return;
    activeRuns += 1;
    const next = waitQueue.shift();
    next?.();
  };

  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (activeRuns >= normalized) {
      await new Promise<void>((resolve) => { waitQueue.push(resolve); });
    } else {
      activeRuns += 1;
    }
    try { return await task(); }
    finally { release(); }
  };
}

async function mapWithConcurrency<TItem, TResult>(
  items: readonly TItem[],
  maxConcurrency: number,
  worker: (item: TItem, index: number) => Promise<TResult>
): Promise<TResult[]> {
  if (items.length === 0) return [];
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

  // 1. Bootstrap with retry
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
        cwd, model, project, runner, scope: "all",
        onStageStart: (p) => console.log(`  [bootstrap] ${p.message}`),
        onStageComplete: (p) => {
          console.log(`  [bootstrap] ${p.message}`);
          stages.push(`bootstrap:${p.stage}:ok`);
        }
      });

      if (result.ok) {
        currentProject = result.project;
        bootstrapOk = true;
        console.log(`  Bootstrap OK (attempt ${attempt}). Chapters: ${currentProject.outline.length}, Characters: ${currentProject.characters.length}`);
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
    return { ok: false, error: "All bootstrap attempts failed", manuscriptPath: null, projectJson: null, stages };
  }

  // 2. Commit events
  console.log("\n[2/5] Committing story events...");
  for (const { chapter, event } of plan.events) {
    console.log(`  Committing ${chapter}: ${event.slice(0, 50)}...`);
    try {
      const commitResult = await commitStoryEvent({
        cwd, model, project: currentProject,
        chapterId: chapter, eventText: event,
        patchFilePath: null, force: true, runner
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
    console.log(`  CI: ${ciResult.report.passed ? "PASS" : "FAIL"} (${ciResult.report.errors.length} errors, ${ciResult.report.warnings.length} warnings)`);
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
      cwd, model, project: currentProject,
      chapterIds, style: null, force: true,
      runner, maxConcurrency: renderConcurrency
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
  const manuscriptOutputDir = path.join(outputDir, plan.title.replace(/[^a-zA-Z0-9_\u4e00-\u9fff\-]/g, "_"));
  const manuscriptPath = path.join(manuscriptOutputDir, "manuscript.md");

  try {
    const compileResult = compileStoryChapters({
      cwd, project: currentProject, chapterIds, outputPath: manuscriptPath
    });
    console.log(`  Compiled: ${compileResult.compiledChapters.join(", ") || "none"}`);
    console.log(`  Output: ${compileResult.outputPath}`);
    stages.push(`compile:${compileResult.compiledChapters.length}chapters`);

    fs.mkdirSync(manuscriptOutputDir, { recursive: true });
    fs.writeFileSync(path.join(manuscriptOutputDir, "project.json"), JSON.stringify(currentProject, null, 2) + "\n", "utf8");

    const srcChapters = path.join(cwd, ".storyforge", "chapters");
    if (fs.existsSync(srcChapters)) {
      const destChapters = path.join(manuscriptOutputDir, "chapters");
      fs.mkdirSync(destChapters, { recursive: true });
      for (const f of fs.readdirSync(srcChapters)) {
        fs.copyFileSync(path.join(srcChapters, f), path.join(destChapters, f));
      }
    }

    return { ok: true, error: null, manuscriptPath: compileResult.outputPath, projectJson: path.join(manuscriptOutputDir, "project.json"), stages };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`  Compile ERROR: ${errMsg}`);
    stages.push("compile:EXCEPTION");
    return { ok: false, error: errMsg, manuscriptPath: null, projectJson: null, stages };
  }
}

async function main() {
  console.log("Storyforge 3-Novel Generator — Batch 3 (全中文)");
  console.log("================================================\n");

  const novelConcurrency = parsePositiveInt(process.env.STORYFORGE_NOVEL_CONCURRENCY, 3);
  const modelConcurrency = parsePositiveInt(process.env.STORYFORGE_MODEL_CONCURRENCY, 3);
  const renderConcurrency = parsePositiveInt(process.env.STORYFORGE_RENDER_CONCURRENCY, 3);

  const config = loadSessionConfig(getDefaultSessionConfigPath());
  if (!config.connection?.apiKey) {
    console.error("ERROR: No API key found");
    process.exit(1);
  }

  const model = config.model || "openrouter/stepfun/step-3.5-flash:free";
  console.log(`Model: ${model}`);
  console.log(`Concurrency: novel=${novelConcurrency}, model=${modelConcurrency}, render=${renderConcurrency}`);

  const syncError = syncApiCredential(config.connection.provider, config.connection.apiKey);
  if (syncError) {
    console.error(`ERROR: ${syncError}`);
    process.exit(1);
  }

  const outputDir = path.join(process.cwd(), "generated-novels", timestamp());
  fs.mkdirSync(outputDir, { recursive: true });
  console.log(`Output: ${outputDir}\n`);

  const throttledRunner = withModelConcurrency(runStructuredPrompt, modelConcurrency);
  const startTime = Date.now();

  const results = await mapWithConcurrency(novels, novelConcurrency, async (plan) => {
    const t0 = Date.now();
    try {
      const result = await generateNovel(plan, model, outputDir, throttledRunner, renderConcurrency);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`\n  => ${plan.title} completed in ${elapsed}s (${result.ok ? "SUCCESS" : "PARTIAL"})`);
      return { title: plan.title, ...result };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.error(`\n  => ${plan.title} FAILED in ${elapsed}s: ${errMsg}`);
      return { title: plan.title, ok: false, error: errMsg, manuscriptPath: null, projectJson: null, stages: ["FATAL"] };
    }
  });

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log("\n\n" + "=".repeat(60));
  console.log("  总结 SUMMARY");
  console.log("=".repeat(60));
  console.log(`总耗时: ${totalElapsed}s\n`);

  for (const result of results) {
    console.log(`${result.ok ? "OK" : "FAIL"} | ${result.title}`);
    if (result.manuscriptPath) {
      console.log(`     路径: ${result.manuscriptPath}`);
      try {
        const content = fs.readFileSync(result.manuscriptPath, "utf8");
        console.log(`     字数: ${content.length}`);
      } catch {}
    }
    if (result.error) console.log(`     错误: ${result.error}`);
    console.log(`     阶段: ${result.stages.join(" -> ")}`);
    console.log();
  }

  const summaryPath = path.join(outputDir, "summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(results, null, 2) + "\n", "utf8");
  console.log(`Summary: ${summaryPath}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
