export type StoryStatus = "empty" | "awaiting_brief" | "ready" | "partial";

export interface StoryMeta {
  title: string;
  status: StoryStatus;
  createdAt: string;
  updatedAt: string;
}

export interface StoryBrief {
  seedPrompt: string;
  genre: string;
  targetWords: number | null;
  language: string;
  tone: string;
  premise: string;
}

export interface WorldState {
  premise: string;
  setting: string;
  tone: string;
  rules: string;
  stakes: string;
  resolutionShape: string;
}

export interface CharacterProfile {
  id: string;
  name: string;
  role: string;
  age: string;
  description: string;
  motivation: string;
  conflict: string;
  arc: string;
  relationships: string;
  tags: string;
}

export interface TimelineBeat {
  id: string;
  label: string;
  summary: string;
  chapterRef: string;
  stakes: string;
  notes: string;
}

export interface ChapterPlan {
  id: string;
  number: number;
  title: string;
  purpose: string;
  summary: string;
  hook: string;
  targetWords: number | null;
}

export type StoryView = "world" | "characters" | "timeline" | "outline";

export interface StoryProject {
  version: 1;
  meta: StoryMeta;
  brief: StoryBrief;
  world: WorldState;
  characters: CharacterProfile[];
  timeline: TimelineBeat[];
  outline: ChapterPlan[];
}

export interface StoryLibraryEntry {
  id: string;
  title: string;
  status: StoryStatus;
  createdAt: string;
  updatedAt: string;
  file: string;
}

export interface PendingTask {
  kind: "chat" | "story-bootstrap" | "story-refresh";
  stage: string | null;
}

export type StoryRefreshScope = "all" | "world" | "characters" | "timeline" | "outline";
