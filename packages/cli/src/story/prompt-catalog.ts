import type { StoryProject } from "./types.js";

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
