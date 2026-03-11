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
    '  "language": "English",',
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
    "- Use ASCII double quotes in JSON."
  ].join("\n");
}

export function buildCharactersPrompt(project: StoryProject): string {
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
    "- Use the same language as the story context."
  ].join("\n");
}

export function buildTimelinePrompt(project: StoryProject): string {
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
    "- Use the story language."
  ].join("\n");
}

export function buildOutlinePrompt(project: StoryProject): string {
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
    "- Keep hooks vivid and actionable."
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

export function buildChapterRenderPrompt(
  project: StoryProject,
  chapterId: string,
  patchOps: readonly EventPatchOp[],
  styleHint?: string
): string {
  const chapterNumber = Number.parseInt(chapterId.replace(/^ch/i, ""), 10);
  const chapterPlan = Number.isFinite(chapterNumber)
    ? project.outline.find((chapter) => chapter.number === chapterNumber)
    : null;
  const style = styleHint?.trim() || project.brief.tone || project.world.tone || "balanced narrative prose";

  return [
    "You are a fiction renderer.",
    "Write chapter prose directly. Do not return JSON.",
    "",
    "Render constraints:",
    `- Chapter id: ${chapterId}`,
    `- Style: ${style}`,
    `- Language: ${project.brief.language || "English"}`,
    `- Genre: ${project.brief.genre || "N/A"}`,
    `- Tone baseline: ${project.brief.tone || project.world.tone || "N/A"}`,
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
    "Event patches for this chapter:",
    stringifyForPrompt(compactPatchForPrompt(patchOps)),
    "",
    "Writing rules:",
    "- Keep continuity with provided state and patch operations.",
    "- Mention consequences implied by item and foreshadow changes when relevant.",
    "- Avoid meta commentary about prompts or system design.",
    "- Output only chapter text."
  ].join("\n");
}
