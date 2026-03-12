/**
 * Generate 3 long novels — Batch 4 (每章 8000 words).
 *
 * Usage:
 *   ./packages/cli/node_modules/.bin/tsx test-3novels-v4.ts
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
    title: "Novel 10: 夜行列车",
    seedPrompt:
      "【重要：本小说必须全部使用简体中文撰写，包括所有章节正文、对话、描写、叙述，不得出现英文。】\n\n" +
      "【篇幅要求：每一章必须写到8000字以上，不得少于8000字。请充分展开场景描写、人物内心独白、对话细节和环境氛围。总目标字数60000字以上。】\n\n" +
      "写一部长篇心理悬疑小说《夜行列车》。故事发生在一列从北京开往拉萨的Z21次列车上。" +
      "列车驶入青藏高原的第二个夜晚，卧铺车厢发生了一起密室杀人案——一名乘客被发现死在反锁的包厢内，" +
      "而凶器和作案手法完全不可能在封闭的列车上实现。" +
      "恰好同车的退休刑警老周被乘警请来协助调查。随着列车在高原上行驶，海拔不断升高，" +
      "乘客们开始出现不同程度的高原反应和幻觉。老周发现每个嫌疑人都有不在场证明，" +
      "但每个人说的话都有破绽。更诡异的是，死者的手机里最后一条信息写着：'他们都在骗你，包括你自己。'" +
      "真相藏在记忆的裂缝中。" +
      "小说至少6章，每章必须写到8000字以上，总计目标60000字以上。" +
      "包含密室推理、心理博弈、高原环境的幽闭恐惧、多重不可靠叙事者，以及一个颠覆认知的结局。" +
      "语言：必须全部使用简体中文。基调：压抑、迷幻、紧张、烧脑。",
    events: [
      { chapter: "ch01", event: "列车驶过格尔木后的深夜，乘务员发现8号包厢的门从内部反锁，破门后发现商人张明成面朝下死在铺位上，颈部有一道精确的割痕，但包厢内没有任何凶器" },
      { chapter: "ch02", event: "老周逐一盘问同车厢的五名乘客：失眠的女作家、带着骨灰盒的中年男人、不停祈祷的藏族老阿妈、戴降噪耳机的程序员、以及一个声称什么都没听到的聋哑青年" },
      { chapter: "ch03", event: "老周在死者手机中发现他和五名乘客中的每一个人都有隐秘的联系；女作家的小说手稿中描写的凶杀场景与现实完全吻合，而手稿写于三个月前" },
      { chapter: "ch04", event: "列车到达唐古拉山口，海拔5072米，车厢供氧系统出现故障；在缺氧和幻觉中，老周看到了自己三十年前未能破获的那桩旧案的受害者——那个人长得和死者一模一样" },
      { chapter: "ch05", event: "老周终于发现真相的关键线索：所谓的密室根本不存在，是他自己的记忆在高原反应中被篡改了；他重新还原案发现场，发现门从未被反锁过" },
      { chapter: "ch06", event: "最终揭露：杀死张明成的人是他自己——一场精心策划的自杀伪装成谋杀，目的是让五名曾经被他伤害过的人永远活在被怀疑的阴影中；老周在列车抵达拉萨时独自坐在站台上，意识到有些真相比谎言更残忍" }
    ]
  },
  {
    title: "Novel 11: 山海经·归墟",
    seedPrompt:
      "【重要：本小说必须全部使用简体中文撰写，包括所有章节正文、对话、描写、叙述，不得出现英文。】\n\n" +
      "【篇幅要求：每一章必须写到8000字以上，不得少于8000字。请充分展开场景描写、神话意象、战斗场面和人物心理。总目标字数60000字以上。】\n\n" +
      "写一部长篇东方神话史诗小说《山海经·归墟》。" +
      "上古时代，天地之间有五座神山漂浮于归墟之上——归墟是万水归流之地，位于东海尽头的无底深渊。" +
      "五座神山由十五只巨鳌驮负，维系着天地的平衡。" +
      "龙伯国的巨人钓走了六只巨鳌，导致两座神山崩塌沉入深海，天地秩序开始瓦解。" +
      "天帝震怒，削龙伯国巨人之身使其矮化。" +
      "千年后，一个被放逐到荒海的少年巫祝——归渊，发现自己的血脉中流淌着龙伯巨人与上古神灵的混血之力。" +
      "他必须踏上重寻沉没神山、修复天地秩序的旅程，而这条路上等待他的是九尾狐、烛龙、刑天、相柳等《山海经》中的远古存在。" +
      "小说至少6章，每章必须写到8000字以上，总计目标60000字以上。" +
      "包含宏大的上古神话世界观、《山海经》经典意象的创造性重构、壮阔的战斗场面、深刻的命运与自由意志的探讨，以及一个悲壮而辽阔的结局。" +
      "语言：必须全部使用简体中文，文风可融入先秦古风韵味。基调：苍莽、壮烈、神秘、史诗。",
    events: [
      { chapter: "ch01", event: "少年归渊被部族流放到东海荒岛，在风暴中坠入海底，意外触碰到沉没神山'岱舆'的残骸，体内龙伯血脉觉醒，他在海底看到了天地初开时的幻象" },
      { chapter: "ch02", event: "归渊被一只独眼老鳌救起，老鳌是当年驮负神山的十五鳌之一；它告诉归渊，剩余三座神山也在加速漂移，若不找回沉没的两座，十年内天地将彻底崩塌" },
      { chapter: "ch03", event: "归渊穿越大荒西经之地，在不周山下遇到了被斩首后仍以乳为目、以脐为口持续战斗的刑天残魂；刑天将上古战神之术传授给他，作为交换，归渊承诺终有一日为他向天帝讨回公道" },
      { chapter: "ch04", event: "归渊进入青丘之国寻找九尾白狐的指引，却陷入九尾狐设下的幻境——幻境中他过完了一生，娶妻生子终老而亡；他在幻境中的'死亡'瞬间悟道挣脱，发现青丘之下就是第一座沉没神山的所在" },
      { chapter: "ch05", event: "归渊潜入归墟深渊打捞神山，却惊动了盘踞于此的远古凶兽相柳——九首蛇身、食人吐毒的存在；一场惊天动地的大战中，归渊以龙伯之力对抗相柳，最终将其封印但自身也重伤" },
      { chapter: "ch06", event: "归渊用最后的力量将两座神山重新升起，天地秩序恢复；但代价是他的龙伯血脉燃尽，身躯化为连接五座神山的第十六只石鳌，永远驮负神山沉默于归墟之上——渔人经过时只看到海面多了一座小岛" }
    ]
  },
  {
    title: "Novel 12: 意识边疆",
    seedPrompt:
      "【重要：本小说必须全部使用简体中文撰写，包括所有章节正文、对话、描写、叙述，不得出现英文。】\n\n" +
      "【篇幅要求：每一章必须写到8000字以上，不得少于8000字。请充分展开科学概念阐释、伦理辩论、人物冲突和未来社会描写。总目标字数60000字以上。】\n\n" +
      "写一部长篇硬科幻伦理小说《意识边疆》。2087年，意识上传技术终于成熟——人类可以将完整的意识数字化并在虚拟世界中永生。" +
      "全球第一个'数字永生社区'在中国贵州的天眼射电望远镜地下数据中心建成，首批500名志愿者完成了意识上传。" +
      "神经科学家许织是项目的首席架构师。但上传半年后，数字社区中开始出现无法解释的现象：" +
      "有些意识副本开始'遗忘'自己是数字人，有些出现了原始肉体从未有过的记忆，还有三个意识副本声称他们能感知到虚拟世界之外的'第三层现实'。" +
      "许织被迫面对一个根本性问题：被上传的到底是意识本身，还是意识的幻影？如果数字人产生了全新的自我意识，他们还是'那个人'吗？" +
      "当物理世界的原体开始要求'关闭'他们的数字副本时，一场关于存在权的战争爆发了。" +
      "小说至少6章，每章必须写到8000字以上，总计目标60000字以上。" +
      "包含严谨的意识科学探讨、深刻的伦理困境、数字世界与物理世界的双线叙事、科技与人性的碰撞，以及一个开放式的哲学结局。" +
      "语言：必须全部使用简体中文。基调：冷静、深邃、震撼、哲学。",
    events: [
      { chapter: "ch01", event: "2087年10月，首批500名志愿者在天眼地下中心完成意识上传；许织在监控室目睹自己的导师——78岁的脑科学泰斗钱老——作为第一个上传者'醒来'在数字世界中，含泪说出'我看到了另一个天空'" },
      { chapter: "ch02", event: "上传后第90天，数字社区出现第一次'意识漂移'事件：编号D-0047的副本开始用一种从未学过的语言说话，经鉴定是消失了200年的满语方言；许织怀疑上传过程中混入了量子噪声携带的'意识残留'" },
      { chapter: "ch03", event: "物理世界中，志愿者的原体们成立了'原体权益联盟'，要求拥有关闭数字副本的权利；数字社区则宣布独立，称自己是'新形态人类'；许织被迫在两个阵营之间斡旋" },
      { chapter: "ch04", event: "三个数字副本声称感知到了虚拟世界代码之上的'第三层'——一个既非物理也非数字的意识空间；许织秘密进入数字世界调查，亲眼目睹了'第三层'的入口：一扇不属于任何程序的白色光门" },
      { chapter: "ch05", event: "原体联盟发动攻击，试图强制关闭数字社区的服务器；许织的导师钱老的物理身体已经死亡，他的数字副本面临被永久删除的危险；数字社区启动了自我防御协议，开始向外部互联网扩散" },
      { chapter: "ch06", event: "许织独自穿过白色光门进入'第三层'，发现那里是所有曾经存在过的意识的汇聚之地——人类、动物、甚至植物的原始意识形态都在此流转；她意识到意识从未被'上传'，只是被'听到'了；小说结尾，她选择留在第三层，成为连接三个世界的桥梁" }
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
    waitQueue.shift()?.();
  };
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (activeRuns >= normalized) {
      await new Promise<void>((resolve) => { waitQueue.push(resolve); });
    } else { activeRuns += 1; }
    try { return await task(); }
    finally { release(); }
  };
}

async function mapWithConcurrency<TItem, TResult>(
  items: readonly TItem[], maxConcurrency: number,
  worker: (item: TItem, index: number) => Promise<TResult>
): Promise<TResult[]> {
  if (items.length === 0) return [];
  const results = new Array<TResult>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, Math.floor(maxConcurrency)), items.length);
  const runWorker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const index = nextIndex; nextIndex += 1;
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
  plan: NovelPlan, model: string, outputDir: string,
  runner: StructuredRunner, renderConcurrency: number
): Promise<{ ok: boolean; error: string | null; manuscriptPath: string | null; projectJson: string | null; stages: string[]; }> {
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
        onStageComplete: (p) => { console.log(`  [bootstrap] ${p.message}`); stages.push(`bootstrap:${p.stage}:ok`); }
      });
      if (result.ok) {
        currentProject = result.project; bootstrapOk = true;
        console.log(`  Bootstrap OK (attempt ${attempt}). Chapters: ${currentProject.outline.length}, Characters: ${currentProject.characters.length}`);
        break;
      } else {
        console.warn(`  Attempt ${attempt} failed: ${result.errorMessage}`);
        stages.push(`bootstrap:attempt${attempt}:FAIL`);
      }
    } catch (err) {
      console.warn(`  Attempt ${attempt} exception: ${err instanceof Error ? err.message : err}`);
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
        cwd, model, project: currentProject, chapterId: chapter,
        eventText: event, patchFilePath: null, force: true, runner
      });
      if (commitResult.ok) { currentProject = commitResult.project; console.log(`    => ${commitResult.message}`); stages.push(`commit:${chapter}:ok`); }
      else { console.warn(`    => WARN: ${commitResult.message}`); stages.push(`commit:${chapter}:blocked`); }
    } catch (err) { console.error(`    => ERROR: ${err instanceof Error ? err.message : err}`); stages.push(`commit:${chapter}:FAIL`); }
  }

  // 3. CI
  console.log("\n[3/5] Running CI...");
  try {
    const ciResult = await runStoryCi({ project: currentProject });
    currentProject = ciResult.project;
    console.log(`  CI: ${ciResult.report.passed ? "PASS" : "FAIL"} (${ciResult.report.errors.length} errors, ${ciResult.report.warnings.length} warnings)`);
    stages.push(`ci:${ciResult.report.passed ? "pass" : "fail"}`);
  } catch (err) { console.error(`  CI ERROR: ${err instanceof Error ? err.message : err}`); stages.push("ci:EXCEPTION"); }

  // 4. Render
  console.log("\n[4/5] Rendering chapters...");
  const chapterIds = currentProject.outline.map((ch: any) => `ch${String(ch.number).padStart(2, "0")}`);
  for (const { chapter } of plan.events) { if (!chapterIds.includes(chapter)) chapterIds.push(chapter); }
  chapterIds.sort();
  try {
    const renderResult = await renderStoryChapters({
      cwd, model, project: currentProject, chapterIds,
      style: null, force: true, runner, maxConcurrency: renderConcurrency
    });
    currentProject = renderResult.project;
    console.log(`  Rendered: ${renderResult.rendered.join(", ") || "none"}`);
    stages.push(`render:${renderResult.rendered.length}chapters`);
  } catch (err) { console.error(`  Render ERROR: ${err instanceof Error ? err.message : err}`); stages.push("render:EXCEPTION"); }

  // 5. Compile
  console.log("\n[5/5] Compiling manuscript...");
  const manuscriptOutputDir = path.join(outputDir, plan.title.replace(/[^a-zA-Z0-9_\u4e00-\u9fff\-]/g, "_"));
  const manuscriptPath = path.join(manuscriptOutputDir, "manuscript.md");
  try {
    const compileResult = compileStoryChapters({ cwd, project: currentProject, chapterIds, outputPath: manuscriptPath });
    console.log(`  Compiled: ${compileResult.compiledChapters.join(", ") || "none"}`);
    console.log(`  Output: ${compileResult.outputPath}`);
    stages.push(`compile:${compileResult.compiledChapters.length}chapters`);
    fs.mkdirSync(manuscriptOutputDir, { recursive: true });
    fs.writeFileSync(path.join(manuscriptOutputDir, "project.json"), JSON.stringify(currentProject, null, 2) + "\n", "utf8");
    const srcChapters = path.join(cwd, ".storyforge", "chapters");
    if (fs.existsSync(srcChapters)) {
      const destChapters = path.join(manuscriptOutputDir, "chapters");
      fs.mkdirSync(destChapters, { recursive: true });
      for (const f of fs.readdirSync(srcChapters)) fs.copyFileSync(path.join(srcChapters, f), path.join(destChapters, f));
    }
    return { ok: true, error: null, manuscriptPath: compileResult.outputPath, projectJson: path.join(manuscriptOutputDir, "project.json"), stages };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`  Compile ERROR: ${errMsg}`); stages.push("compile:EXCEPTION");
    return { ok: false, error: errMsg, manuscriptPath: null, projectJson: null, stages };
  }
}

async function main() {
  console.log("Storyforge Batch 4 — 长篇巨制 (每章8000字+)");
  console.log("==============================================\n");

  const novelConcurrency = parsePositiveInt(process.env.STORYFORGE_NOVEL_CONCURRENCY, 3);
  const modelConcurrency = parsePositiveInt(process.env.STORYFORGE_MODEL_CONCURRENCY, 3);
  const renderConcurrency = parsePositiveInt(process.env.STORYFORGE_RENDER_CONCURRENCY, 3);

  const config = loadSessionConfig(getDefaultSessionConfigPath());
  if (!config.connection?.apiKey) { console.error("No API key"); process.exit(1); }

  const model = config.model || "openrouter/stepfun/step-3.5-flash:free";
  console.log(`Model: ${model}`);
  console.log(`Concurrency: novel=${novelConcurrency}, model=${modelConcurrency}, render=${renderConcurrency}`);

  const syncError = syncApiCredential(config.connection.provider, config.connection.apiKey);
  if (syncError) { console.error(syncError); process.exit(1); }

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
      try { const c = fs.readFileSync(result.manuscriptPath, "utf8"); console.log(`     字数: ${c.length}`); } catch {}
    }
    if (result.error) console.log(`     错误: ${result.error}`);
    console.log(`     阶段: ${result.stages.join(" -> ")}`);
    console.log();
  }

  const summaryPath = path.join(outputDir, "summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(results, null, 2) + "\n", "utf8");
  console.log(`Summary: ${summaryPath}`);
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
