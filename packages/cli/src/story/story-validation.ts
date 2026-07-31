import { parseStructuredJson, type StructuredRunner } from "./structured-run.js";
import { normalizeStoryProject } from "./project-store.js";
import type { StoryProject } from "./types.js";

export type StoryValidationCategory =
  | "schema"
  | "chapter_attribution"
  | "fact_conflict"
  | "word_count"
  | "character_rule"
  | "foreshadow_state";

export type StoryRepairTarget =
  | "foundation"
  | "characters"
  | "timeline"
  | "outline"
  | "eventCommits"
  | "foreshadows"
  | `chapter:${string}`;

export interface StoryValidationIssue {
  category: StoryValidationCategory;
  target: StoryRepairTarget;
  code: string;
  message: string;
  chapterId?: string;
}

export interface StoryValidationReport {
  passed: boolean;
  checkedAt: string;
  issues: StoryValidationIssue[];
}

export interface StoryValidationOptions {
  chapterTexts?: Readonly<Record<string, string>>;
  minimumWordRatio?: number;
  maximumWordRatio?: number;
}

export interface StoryRepairGateOptions extends StoryValidationOptions {
  cwd: string;
  model: string;
  runner: StructuredRunner;
  maxRepairRounds?: number;
  abortSignal?: AbortSignal;
  onTargetRepaired?: (progress: {
    project: StoryProject;
    target: Exclude<StoryRepairTarget, `chapter:${string}`>;
    repairedTargets: StoryRepairTarget[];
    repairAttempts: number;
  }) => void;
}

export interface StoryRepairGateResult {
  project: StoryProject;
  chapterTexts: Record<string, string>;
  report: StoryValidationReport;
  repairedTargets: StoryRepairTarget[];
  repairAttempts: number;
}

export interface ChapterRepairGateOptions {
  cwd: string;
  model: string;
  project: StoryProject;
  chapterId: string;
  text: string;
  runner: StructuredRunner;
  maxRepairAttempts?: number;
  abortSignal?: AbortSignal;
}

export interface ChapterRepairGateResult {
  text: string;
  report: StoryValidationReport;
  repairAttempts: number;
}

function normalizedChapterId(value: string): string | null {
  const match = /^ch0*([1-9]\d*)$/i.exec(value.trim());
  return match ? `ch${String(Number(match[1])).padStart(2, "0")}` : null;
}

function chapterIdForNumber(value: number): string {
  return `ch${String(value).padStart(2, "0")}`;
}

function normalizeFact(value: unknown): string {
  return typeof value === "string"
    ? value.trim().toLocaleLowerCase().replace(/\s+/g, " ")
    : JSON.stringify(value);
}

export function countStoryWords(value: string): number {
  const cjkCharacters = value.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0;
  const nonCjkWords = value
    .replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, " ")
    .match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
  return cjkCharacters + nonCjkWords;
}

export function validateStoryProject(
  project: StoryProject,
  options: StoryValidationOptions = {}
): StoryValidationReport {
  const issues: StoryValidationIssue[] = [];
  const add = (
    category: StoryValidationCategory,
    target: StoryRepairTarget,
    code: string,
    message: string,
    chapterId?: string
  ): void => {
    issues.push({ category, target, code, message, chapterId });
  };
  const outlineChapterIds = new Set(
    project.outline
      .filter((entry) => Number.isInteger(entry.number) && entry.number > 0)
      .map((entry) => chapterIdForNumber(entry.number))
  );

  if (!project.meta.title.trim() || !project.world.premise.trim()) {
    add("schema", "foundation", "foundation_required", "A title and world premise are required.");
  }
  if (project.characters.length === 0) {
    add("schema", "characters", "characters_required", "At least one character is required.");
  }
  if (project.timeline.length === 0) {
    add("schema", "timeline", "timeline_required", "At least one timeline beat is required.");
  }
  if (project.outline.length === 0) {
    add("schema", "outline", "outline_required", "At least one chapter plan is required.");
  }

  const characterIds = new Set<string>();
  const characterNames = new Set<string>();
  for (const character of project.characters) {
    const id = character.id.trim().toLocaleLowerCase();
    const name = character.name.trim().toLocaleLowerCase();
    if (!id || !name || !character.role.trim()) {
      add(
        "character_rule",
        "characters",
        "character_required_fields",
        `Character '${character.name || character.id || "(unnamed)"}' requires id, name, and role.`
      );
    }
    if (id && characterIds.has(id)) {
      add("character_rule", "characters", "character_duplicate_id", `Duplicate character id '${character.id}'.`);
    }
    if (name && characterNames.has(name)) {
      add("character_rule", "characters", "character_duplicate_name", `Duplicate character name '${character.name}'.`);
    }
    characterIds.add(id);
    characterNames.add(name);
  }

  const timelineFacts = new Map<string, string>();
  for (const beat of project.timeline) {
    const chapterId = normalizedChapterId(beat.chapterRef);
    if (!chapterId || !outlineChapterIds.has(chapterId)) {
      add(
        "chapter_attribution",
        "timeline",
        "timeline_chapter_ref",
        `Timeline beat '${beat.label}' points to unknown chapter '${beat.chapterRef}'.`
      );
    }
    const factKey = beat.label.trim().toLocaleLowerCase();
    const factValue = normalizeFact(beat.summary);
    const prior = timelineFacts.get(factKey);
    if (factKey && prior && prior !== factValue) {
      add(
        "fact_conflict",
        "timeline",
        "timeline_duplicate_fact",
        `Timeline label '${beat.label}' has conflicting summaries.`
      );
    }
    if (factKey) {
      timelineFacts.set(factKey, factValue);
    }
  }

  for (const commit of project.eventCommits) {
    const chapterId = normalizedChapterId(commit.chapterId);
    if (!chapterId || !outlineChapterIds.has(chapterId)) {
      add(
        "chapter_attribution",
        "eventCommits",
        "commit_chapter_ref",
        `Commit '${commit.id}' points to unknown chapter '${commit.chapterId}'.`
      );
    }
    for (const op of commit.patchOps) {
      if (op.op !== "timeline.add") {
        continue;
      }
      const ref = typeof op.payload.chapterRef === "string"
        ? normalizedChapterId(op.payload.chapterRef)
        : null;
      if (ref !== chapterId) {
        add(
          "chapter_attribution",
          "eventCommits",
          "commit_patch_chapter_ref",
          `Commit '${commit.id}' contains a timeline beat assigned outside ${commit.chapterId}.`,
          chapterId ?? undefined
        );
      }
    }
  }

  const worldWrites = new Map<string, string>();
  for (const commit of project.eventCommits) {
    for (const op of commit.patchOps) {
      if (op.op !== "world.set") {
        continue;
      }
      const field = String(op.payload.field ?? "").trim();
      const value = normalizeFact(op.payload.value);
      // Separate commits are an ordered event log and may intentionally update
      // the same world field. Only contradictory writes inside one commit are
      // structurally ambiguous.
      const key = `${commit.id}:${field}`;
      const prior = worldWrites.get(key);
      if (field && prior && prior !== value) {
        add(
          "fact_conflict",
          "eventCommits",
          "world_write_conflict",
          `Chapter ${commit.chapterId} assigns conflicting values to world.${field}.`,
          commit.chapterId
        );
      }
      if (field) {
        worldWrites.set(key, value);
      }
    }
  }

  for (const entry of project.foreshadows) {
    const introduced = normalizedChapterId(entry.introducedChapter);
    const due = normalizedChapterId(entry.dueChapter);
    const resolved = entry.resolvedChapter ? normalizedChapterId(entry.resolvedChapter) : null;
    const introducedNumber = introduced ? Number(introduced.slice(2)) : null;
    const dueNumber = due ? Number(due.slice(2)) : null;

    if (!introduced || !due || !outlineChapterIds.has(introduced) || !outlineChapterIds.has(due)) {
      add(
        "foreshadow_state",
        "foreshadows",
        "foreshadow_chapter_ref",
        `Foreshadow '${entry.label}' has an invalid introduced/due chapter.`
      );
    } else if (introducedNumber !== null && dueNumber !== null && dueNumber < introducedNumber) {
      add(
        "foreshadow_state",
        "foreshadows",
        "foreshadow_due_order",
        `Foreshadow '${entry.label}' is due before it is introduced.`
      );
    }
    if (entry.status === "resolved" && (!resolved || !outlineChapterIds.has(resolved))) {
      add(
        "foreshadow_state",
        "foreshadows",
        "foreshadow_resolution_missing",
        `Resolved foreshadow '${entry.label}' requires a valid resolvedChapter.`
      );
    }
    if (entry.status === "open" && entry.resolvedChapter) {
      add(
        "foreshadow_state",
        "foreshadows",
        "foreshadow_open_with_resolution",
        `Open foreshadow '${entry.label}' cannot have resolvedChapter.`
      );
    }
  }

  const minimumWordRatio = options.minimumWordRatio ?? 0.7;
  const maximumWordRatio = options.maximumWordRatio ?? 1.35;
  for (const [rawChapterId, text] of Object.entries(options.chapterTexts ?? {})) {
    const chapterId = normalizedChapterId(rawChapterId);
    const chapterNumber = chapterId ? Number(chapterId.slice(2)) : null;
    const plan = chapterNumber === null
      ? null
      : project.outline.find((entry) => entry.number === chapterNumber);
    if (!chapterId || !plan) {
      add(
        "chapter_attribution",
        `chapter:${rawChapterId}`,
        "draft_unknown_chapter",
        `Draft '${rawChapterId}' has no matching outline chapter.`
      );
      continue;
    }
    if (!plan.targetWords) {
      continue;
    }
    const words = countStoryWords(text);
    const minimum = Math.max(1, Math.floor(plan.targetWords * minimumWordRatio));
    const maximum = Math.max(minimum, Math.ceil(plan.targetWords * maximumWordRatio));
    if (words < minimum || words > maximum) {
      add(
        "word_count",
        `chapter:${chapterId}`,
        "chapter_word_count",
        `${chapterId} has ${words} words; expected ${minimum}-${maximum}.`,
        chapterId
      );
    }
  }

  return {
    passed: issues.length === 0,
    checkedAt: new Date().toISOString(),
    issues
  };
}

function buildRepairPrompt(
  project: StoryProject,
  target: Exclude<StoryRepairTarget, `chapter:${string}`>,
  issues: readonly StoryValidationIssue[]
): string {
  return [
    "You repair one failed section of a structured fiction project.",
    "Return strict JSON only. Do not rewrite unrelated sections.",
    `Repair target: ${target}`,
    "Failures:",
    JSON.stringify(issues, null, 2),
    "Current project:",
    JSON.stringify(project, null, 2),
    "Return an object containing only the requested top-level field:",
    target === "foundation"
      ? '{"meta":{"title":"..."}, "brief":{...}, "world":{...}}'
      : `{"${target}":[...]}`,
    "Preserve stable ids whenever the entity already exists."
  ].join("\n");
}

function applyRepairPayload(
  project: StoryProject,
  target: Exclude<StoryRepairTarget, `chapter:${string}`>,
  payload: Record<string, unknown>
): StoryProject {
  const candidate = normalizeStoryProject({
    ...project,
    ...(target === "foundation"
      ? {
          meta: {
            ...project.meta,
            ...(payload.meta && typeof payload.meta === "object" ? payload.meta : {})
          },
          brief: {
            ...project.brief,
            ...(payload.brief && typeof payload.brief === "object" ? payload.brief : {})
          },
          world: {
            ...project.world,
            ...(payload.world && typeof payload.world === "object" ? payload.world : {})
          }
        }
      : { [target]: payload[target] })
  });

  if (target !== "foundation" && !Array.isArray(payload[target])) {
    throw new Error(`Repair response omitted '${target}'.`);
  }

  return candidate;
}

export async function runStoryValidationRepairGate(
  project: StoryProject,
  options: StoryRepairGateOptions
): Promise<StoryRepairGateResult> {
  let nextProject = project;
  const chapterTexts = { ...(options.chapterTexts ?? {}) };
  const repairedTargets: StoryRepairTarget[] = [];
  let repairAttempts = 0;
  let report = validateStoryProject(nextProject, { ...options, chapterTexts });
  const maxRepairRounds = Math.max(0, Math.min(5, options.maxRepairRounds ?? 2));

  for (let round = 0; round < maxRepairRounds && !report.passed; round += 1) {
    const targets = [...new Set(report.issues.map((issue) => issue.target))]
      .filter((target): target is Exclude<StoryRepairTarget, `chapter:${string}`> =>
        !target.startsWith("chapter:")
      );
    if (targets.length === 0) {
      break;
    }

    for (const target of targets) {
      if (options.abortSignal?.aborted) {
        const error = new Error("Story repair gate aborted.");
        error.name = "AbortError";
        throw error;
      }
      const targetIssues = report.issues.filter((issue) => issue.target === target);
      const raw = await options.runner({
        cwd: options.cwd,
        model: options.model,
        prompt: buildRepairPrompt(nextProject, target, targetIssues),
        stage: `repair-${target}`,
        signal: options.abortSignal
      });
      const payload = parseStructuredJson<Record<string, unknown>>(raw);
      nextProject = applyRepairPayload(nextProject, target, payload);
      repairedTargets.push(target);
      repairAttempts += 1;
      options.onTargetRepaired?.({
        project: nextProject,
        target,
        repairedTargets: [...repairedTargets],
        repairAttempts
      });
    }

    report = validateStoryProject(nextProject, { ...options, chapterTexts });
  }

  return {
    project: nextProject,
    chapterTexts,
    report,
    repairedTargets,
    repairAttempts
  };
}

export async function runChapterValidationRepairGate(
  options: ChapterRepairGateOptions
): Promise<ChapterRepairGateResult> {
  let text = options.text;
  let repairAttempts = 0;
  let report = validateStoryProject(options.project, {
    chapterTexts: { [options.chapterId]: text }
  });
  const maxRepairAttempts = Math.max(0, Math.min(5, options.maxRepairAttempts ?? 2));
  const chapterTarget = `chapter:${options.chapterId}`;
  let chapterIssues = report.issues.filter((issue) => issue.target === chapterTarget);

  while (chapterIssues.length > 0 && repairAttempts < maxRepairAttempts) {
    if (options.abortSignal?.aborted) {
      const error = new Error("Chapter repair gate aborted.");
      error.name = "AbortError";
      throw error;
    }
    text = (await options.runner({
      cwd: options.cwd,
      model: options.model,
      stage: `repair-${options.chapterId}`,
      signal: options.abortSignal,
      prompt: [
        "Repair only the failed chapter draft. Return prose only, without a markdown heading.",
        `Chapter: ${options.chapterId}`,
        "Validation failures:",
        JSON.stringify(chapterIssues, null, 2),
        "Chapter plan:",
        JSON.stringify(
          options.project.outline.find(
            (entry) => chapterIdForNumber(entry.number) === options.chapterId
          ) ?? null,
          null,
          2
        ),
        "Current draft:",
        text
      ].join("\n")
    })).trim();
    repairAttempts += 1;
    report = validateStoryProject(options.project, {
      chapterTexts: { [options.chapterId]: text }
    });
    chapterIssues = report.issues.filter((issue) => issue.target === chapterTarget);
  }

  return {
    text,
    report: {
      ...report,
      passed: chapterIssues.length === 0,
      issues: chapterIssues
    },
    repairAttempts
  };
}
