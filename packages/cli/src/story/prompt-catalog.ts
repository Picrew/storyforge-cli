import type { EventPatchOp, StoryProject } from "./types.js";

function stringifyForPrompt(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function buildFoundationPrompt(seedPrompt: string): string {
  return [
    "You are a senior story architect.",
    "Return valid JSON only.",
    "",
    "User brief:",
    seedPrompt,
    "",
    "Create a structured story foundation with this exact schema:",
    "{",
    '  "title": "Short story title",',
    '  "genre": "Genre or subgenre",',
    '  "targetWords": 900,',
    '  "language": "Language of the user brief (e.g. Chinese, English, Japanese...)",',
    '  "tone": "Tone description",',
    '  "premise": "One concise premise paragraph",',
    '  "world": {',
    '    "premise": "Short premise line",',
    '    "setting": "Primary setting",',
    '    "tone": "Narrative tone",',
    '    "rules": "Important social or physical rules",',
    '    "stakes": "What could go wrong",',
    '    "resolutionShape": "How the ending should generally feel"',
    "  }",
    "}",
    "",
    "Rules:",
    "- Output JSON only.",
    "- Infer missing fields from the brief.",
    "- Keep each natural-language field concise but useful.",
    "- Use ASCII double quotes in JSON.",
    "- IMPORTANT: Set the `language` field to the language the user wrote their brief in (e.g. if the brief is in Chinese, set language to \"Chinese\").",
    "- IMPORTANT: Write ALL natural-language fields (title, genre, tone, premise, and every world field) in the SAME language as the user's brief."
  ].join("\n");
}

export function buildCharactersPrompt(project: StoryProject): string {
  const storyLanguage = project.brief.language || "the same language as the story context";
  return [
    "You are a story development editor.",
    "Return valid JSON only.",
    "",
    "Story context:",
    stringifyForPrompt({
      title: project.meta.title,
      brief: project.brief,
      world: project.world
    }),
    "",
    "Create 3 to 6 character profiles with this exact schema:",
    "{",
    '  "characters": [',
    "    {",
    '      "name": "Character name",',
    '      "role": "Protagonist / Supporting / Antagonist / Ally",',
    '      "age": "Approximate age or life stage",',
    '      "description": "Brief description",',
    '      "motivation": "Primary motivation",',
    '      "conflict": "Internal or external conflict",',
    '      "arc": "Expected arc",',
    '      "relationships": "Compressed relationship notes",',
    '      "tags": "Comma-separated tags"',
    "    }",
    "  ]",
    "}",
    "",
    "Rules:",
    "- Output JSON only.",
    "- Keep descriptions specific and brief.",
    `- IMPORTANT: Write ALL natural-language field values in ${storyLanguage}. Do not mix languages.`
  ].join("\n");
}

export function buildTimelinePrompt(project: StoryProject): string {
  const storyLanguage = project.brief.language || "the same language as the story context";
  return [
    "You are a plot designer.",
    "Return valid JSON only.",
    "",
    "Story context:",
    stringifyForPrompt({
      title: project.meta.title,
      brief: project.brief,
      world: project.world,
      characters: project.characters
    }),
    "",
    "Create 5 to 9 ordered story beats with this exact schema:",
    "{",
    '  "timeline": [',
    "    {",
    '      "label": "Beat label",',
    '      "summary": "What happens",',
    '      "chapterRef": "Suggested chapter range or number",',
    '      "stakes": "Why this beat matters",',
    '      "notes": "Foreshadowing, continuity, or tone note"',
    "    }",
    "  ]",
    "}",
    "",
    "Rules:",
    "- Output JSON only.",
    "- Keep the sequence coherent from setup through resolution.",
    `- IMPORTANT: Write ALL natural-language field values in ${storyLanguage}. Do not mix languages.`
  ].join("\n");
}

export function buildOutlinePrompt(project: StoryProject): string {
  const storyLanguage = project.brief.language || "the same language as the story context";
  return [
    "You are a chapter planner.",
    "Return valid JSON only.",
    "",
    "Story context:",
    stringifyForPrompt({
      title: project.meta.title,
      brief: project.brief,
      world: project.world,
      characters: project.characters,
      timeline: project.timeline
    }),
    "",
    "Create 1 to 8 chapter plans with this exact schema:",
    "{",
    '  "outline": [',
    "    {",
    '      "number": 1,',
    '      "title": "Chapter title",',
    '      "purpose": "Narrative purpose",',
    '      "summary": "What this chapter covers",',
    '      "hook": "Opening or ending hook",',
    '      "targetWords": 300',
    "    }",
    "  ]",
    "}",
    "",
    "Rules:",
    "- Output JSON only.",
    "- Match the total target word count when distributing chapter sizes.",
    "- Keep hooks vivid and actionable.",
    `- IMPORTANT: Write ALL natural-language field values in ${storyLanguage}. Do not mix languages.`
  ].join("\n");
}

export function buildCommitPatchPrompt(
  project: StoryProject,
  chapterId: string,
  eventText: string
): string {
  return [
    "You are an event-patch planner for long-form fiction systems.",
    "Return strict JSON only.",
    "",
    "Story snapshot:",
    stringifyForPrompt({
      title: project.meta.title,
      chapterId,
      world: project.world,
      characters: project.characters.map((character) => ({
        id: character.id,
        name: character.name,
        role: character.role
      })),
      timelineTail: project.timeline.slice(-5),
      inventory: project.inventory,
      foreshadows: project.foreshadows
    }),
    "",
    "Event intent:",
    eventText,
    "",
    "Return this exact schema:",
    "{",
    '  "patchOps": [',
    "    {",
    '      "op": "timeline.add",',
    '      "target": "timeline",',
    '      "payload": {',
    '        "label": "string",',
    '        "summary": "string",',
    '        "chapterRef": "ch03",',
    '        "stakes": "string",',
    '        "notes": "string"',
    "      }",
    "    }",
    "  ],",
    '  "reads": ["character:<id-or-name>", "world:<field>", "item:<id-or-name>", "foreshadow:<id-or-label>"],',
    '  "writes": ["timeline", "character:<id-or-name>", "world:<field>", "item:<id-or-name>", "foreshadow:<id-or-label>"]',
    "}",
    "",
    "Allowed patch op values:",
    "- world.set",
    "- character.set",
    "- timeline.add",
    "- timeline.set",
    "- item.create",
    "- item.transfer",
    "- item.consume",
    "- foreshadow.add",
    "- foreshadow.resolve",
    "",
    "Rules:",
    "- Use chapterRef exactly as the provided chapter id when adding timeline beats.",
    "- Keep patchOps minimal and deterministic.",
    "- reads/writes must list compact symbolic access keys.",
    "- Output only JSON, no markdown fences."
  ].join("\n");
}

function compactPatchForPrompt(patchOps: readonly EventPatchOp[]): unknown {
  return patchOps.map((op) => ({
    op: op.op,
    target: op.target,
    payload: op.payload
  }));
}

export interface ChapterRenderPromptContext {
  previousChapterId?: string;
  previousChapterTitle?: string;
  previousChapterSummary?: string;
  previousChapterTail?: string;
  targetWords?: number | null;
}

export function buildChapterRenderPrompt(
  project: StoryProject,
  chapterId: string,
  patchOps: readonly EventPatchOp[],
  styleHint?: string,
  context: ChapterRenderPromptContext = {}
): string {
  const chapterNumber = Number.parseInt(chapterId.replace(/^ch/i, ""), 10);
  const chapterPlan = Number.isFinite(chapterNumber)
    ? project.outline.find((chapter) => chapter.number === chapterNumber)
    : null;
  const style = styleHint?.trim() || project.brief.tone || project.world.tone || "balanced narrative prose";
  const storyLanguage = project.brief.language || "English";
  const fallbackTargetWords = project.brief.targetWords && project.outline.length > 0
    ? Math.max(300, Math.round(project.brief.targetWords / project.outline.length))
    : null;
  const targetWords = context.targetWords ?? chapterPlan?.targetWords ?? fallbackTargetWords;
  const previousSummary = context.previousChapterSummary?.trim() || "N/A";
  const previousTail = context.previousChapterTail?.trim() || "N/A";
  const previousChapterLabel = context.previousChapterId
    ? `${context.previousChapterId}${context.previousChapterTitle ? ` (${context.previousChapterTitle})` : ""}`
    : "N/A";

  return [
    "You are a fiction renderer.",
    "Write chapter prose directly. Do not return JSON.",
    "Think through a draft, then self-edit once before producing the final text.",
    "",
    "Render constraints:",
    `- Chapter id: ${chapterId}`,
    `- Style: ${style}`,
    `- Language: ${storyLanguage}`,
    `- Genre: ${project.brief.genre || "N/A"}`,
    `- Tone baseline: ${project.brief.tone || project.world.tone || "N/A"}`,
    `- Target length: ${targetWords ?? "No strict target"} words`,
    "",
    "World snapshot:",
    stringifyForPrompt({
      title: project.meta.title,
      world: project.world,
      characters: project.characters.map((character) => ({
        id: character.id,
        name: character.name,
        role: character.role,
        motivation: character.motivation,
        conflict: character.conflict
      })),
      inventory: project.inventory,
      foreshadows: project.foreshadows
    }),
    "",
    "Chapter plan:",
    stringifyForPrompt(chapterPlan ?? { number: chapterId, title: "", purpose: "", summary: "", hook: "" }),
    "",
    "Previous chapter continuity anchor:",
    stringifyForPrompt({
      previousChapter: previousChapterLabel,
      summary: previousSummary
    }),
    "Previous chapter ending excerpt (continue naturally from this when present):",
    previousTail,
    "",
    "Event patches for this chapter:",
    stringifyForPrompt(compactPatchForPrompt(patchOps)),
    "",
    "Writing rules:",
    "- Keep continuity with provided state and patch operations.",
    "- If a previous chapter excerpt is present, open with an immediate next beat in the same narrative flow.",
    "- Use scene-level structure: Goal -> Conflict -> Outcome (often with a cost or setback).",
    "- Open with momentum: action, tension, or a meaningful question. Avoid warm-up exposition.",
    "- Do not open with weather-only description, waking-up routine, mirror self-description, or neutral commuting.",
    "- Show, do not tell: reveal emotion through action, dialogue, body response, and sensory detail.",
    "- Use concrete nouns and strong verbs. Avoid adjective/adverb stacking.",
    "- Avoid AI-flavor transitions and cliches: Meanwhile, Suddenly, In that moment, Little did they know.",
    "- Avoid repetitive sentence openings and repetitive rhythm patterns.",
    "- Avoid explaining an emotion right after already showing it.",
    "- Keep character voice, motives, and knowledge consistent with prior chapters.",
    "- End the chapter with forward momentum: unresolved tension, revelation, or a hard decision.",
    "- If language is Chinese, keep prose fully natural Chinese and avoid random English insertions.",
    "- If language is not Chinese, avoid random non-target-language text.",
    "- Mention consequences implied by item and foreshadow changes when relevant.",
    "- Avoid meta commentary about prompts or system design.",
    "- Output only chapter text.",
    "- Do not add markdown headings."
  ].join("\n");
}
