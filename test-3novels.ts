/**
 * Generate 3 long novels using Storyforge + DeepSeek model.
 *
 * Usage:
 *   cd /Users/lijunjie/Downloads/storyforge
 *   pnpm exec tsx test-3novels.ts
 *
 * Optional env for throughput tuning:
 *   STORYFORGE_NOVEL_CONCURRENCY=2
 *   STORYFORGE_MODEL_CONCURRENCY=2
 *   STORYFORGE_RENDER_CONCURRENCY=2
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
    title: "Novel 1: The Silent Archive",
    seedPrompt:
      "Write a long-form literary thriller novel set in 1990s Shanghai. " +
      "A disgraced historian discovers that a sealed government archive contains evidence of a forgotten massacre. " +
      "As she digs deeper, she realizes the cover-up extends to the highest levels of power and that people are still being silenced today. " +
      "The novel should have at least 6 chapters, each chapter targeting 3000 words or more, for a total target of 20000+ words. " +
      "Include complex character arcs, political intrigue, atmospheric descriptions, and a morally ambiguous resolution. " +
      "Language: Chinese (Simplified). Tone: tense, literary, layered.",
    events: [
      { chapter: "ch01", event: "Historian Lin Shuyi finds a classified document reference in a routine auction catalog and becomes obsessed" },
      { chapter: "ch02", event: "Lin bribes a retired archivist and gains partial access to the sealed files; she discovers redacted casualty lists" },
      { chapter: "ch03", event: "A mysterious man warns Lin to stop; her apartment is broken into and her research notes are stolen" },
      { chapter: "ch04", event: "Lin travels to a rural village and interviews elderly survivors who give conflicting testimonies" },
      { chapter: "ch05", event: "Lin discovers her own father was involved in the cover-up; she confronts him and he denies everything" },
      { chapter: "ch06", event: "Lin publishes the findings anonymously online; she receives a final warning but chooses to disappear rather than be silenced" }
    ]
  },
  {
    title: "Novel 2: Echoes of Starfall",
    seedPrompt:
      "Write a long-form epic science fiction novel. In the year 2847, humanity has colonized seven star systems but is on the brink of civil war. " +
      "A young diplomat from the poorest colony is sent to negotiate peace, only to uncover that an alien signal—dormant for millennia—has been manipulating human expansion all along. " +
      "The novel should have at least 6 chapters, each chapter targeting 3000+ words, for a total target of 20000+ words. " +
      "Include grand space opera elements, detailed world-building, philosophical questions about free will, and a bittersweet ending. " +
      "Language: Chinese (Simplified). Tone: epic, philosophical, sweeping.",
    events: [
      { chapter: "ch01", event: "Diplomat Kael Voss arrives at the Grand Conclave space station and witnesses a terrorist bombing that kills three ambassadors" },
      { chapter: "ch02", event: "Kael discovers encrypted transmissions between two warring factions that reference 'the Signal'; both sides deny knowledge" },
      { chapter: "ch03", event: "Kael's ship is hijacked by a rogue AI that claims to serve the original signal source; it shows him visions of humanity's guided evolution" },
      { chapter: "ch04", event: "Kael finds the alien beacon on a dead planet; activating it reveals that humans were seeded by the signal-senders to serve as biological relay nodes" },
      { chapter: "ch05", event: "Civil war erupts; Kael broadcasts the alien truth to all colonies, causing half to surrender and half to rage harder" },
      { chapter: "ch06", event: "Kael makes a deal with the alien intelligence: humanity keeps its free will in exchange for serving as peaceful broadcasters of the signal into deeper space" }
    ]
  },
  {
    title: "Novel 3: The Bone Garden",
    seedPrompt:
      "Write a long-form gothic horror novel set in a crumbling English manor house in the 1920s. " +
      "A young botanist inherits her estranged grandmother's estate and discovers that the estate's legendary garden is growing on top of mass graves. " +
      "The plants have absorbed something from the dead, and they are changing anyone who tends them. " +
      "The novel should have at least 6 chapters, each targeting 3000+ words, for a total target of 20000+ words. " +
      "Include body horror, psychological dread, unreliable narration, and a devastating final twist. " +
      "Language: Chinese (Simplified). Tone: gothic, dreadful, atmospheric.",
    events: [
      { chapter: "ch01", event: "Botanist Eleanor Ashford arrives at Thornhaven Manor and finds the garden impossibly lush despite decades of neglect" },
      { chapter: "ch02", event: "Eleanor discovers her grandmother's journal describing 'the feeding' ritual and realizes the soil contains human remains" },
      { chapter: "ch03", event: "The gardener Mr. Holloway reveals he has been eating the garden's fruit for years; his skin has started growing bark-like patches" },
      { chapter: "ch04", event: "Eleanor finds a hidden ossuary beneath the greenhouse; the bones are intertwined with living roots that pulse with warmth" },
      { chapter: "ch05", event: "Eleanor is scratched by a thorn and begins hallucinating conversations with the dead buried beneath; she realizes they are conscious" },
      { chapter: "ch06", event: "Eleanor chooses to burn the garden but discovers she has already begun transforming; in the final scene she willingly takes root" }
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
      // Continue with other chapters even if one fails
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
  // Also add any chapters from events that might not be in the outline
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

    // Also save the full project JSON for inspection
    const projectJsonPath = path.join(manuscriptOutputDir, "project.json");
    fs.mkdirSync(manuscriptOutputDir, { recursive: true });
    fs.writeFileSync(projectJsonPath, JSON.stringify(currentProject, null, 2) + "\n", "utf8");

    // Copy rendered chapters too
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
  console.log("Storyforge 3-Novel Generator");
  console.log("============================\n");

  const novelConcurrency = parsePositiveInt(process.env.STORYFORGE_NOVEL_CONCURRENCY, 2);
  const modelConcurrency = parsePositiveInt(process.env.STORYFORGE_MODEL_CONCURRENCY, 2);
  const renderConcurrency = parsePositiveInt(process.env.STORYFORGE_RENDER_CONCURRENCY, 2);

  // Load config
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

  // Sync credential
  const syncError = syncApiCredential(config.connection.provider, config.connection.apiKey);
  if (syncError) {
    console.error(`ERROR: Failed to sync credential: ${syncError}`);
    process.exit(1);
  }

  // Output directory
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
        const wordCount = content.length; // for Chinese, character count is more meaningful
        console.log(`     Characters: ${wordCount}`);
      } catch {}
    }
    if (result.error) {
      console.log(`     Error: ${result.error}`);
    }
    console.log(`     Stages: ${result.stages.join(" -> ")}`);
    console.log();
  }

  // Save summary
  const summaryPath = path.join(outputDir, "summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(results, null, 2) + "\n", "utf8");
  console.log(`Summary saved to: ${summaryPath}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
