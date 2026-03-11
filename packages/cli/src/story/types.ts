export type StoryStatus =
  | "empty"
  | "awaiting_brief"
  | "bootstrapping"
  | "ready"
  | "partial";

export type StorySchemaVersion = 1 | 2;

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

export interface EventPatchOp {
  op: string;
  target: string;
  payload: Record<string, unknown>;
}

export interface InventoryItem {
  id: string;
  name: string;
  holders: Record<string, number>;
  total: number;
  status: "active" | "consumed";
  notes: string;
}

export interface ForeshadowEntry {
  id: string;
  label: string;
  introducedChapter: string;
  dueChapter: string;
  resolvedChapter: string | null;
  status: "open" | "resolved";
  notes: string;
}

export interface StoryCiIssue {
  rule: string;
  severity: "error" | "warning";
  message: string;
  chapterId?: string;
  commitId?: string;
}

export interface StoryCiReport {
  ranAt: string;
  scope: "all" | "commit";
  passed: boolean;
  errors: StoryCiIssue[];
  warnings: StoryCiIssue[];
}

export interface EventCommit {
  id: string;
  chapterId: string;
  createdAt: string;
  message: string;
  patchOps: EventPatchOp[];
  reads: string[];
  writes: string[];
  forced: boolean;
  ciPassed: boolean;
  ciReport: StoryCiReport | null;
}

export interface DependencyEdge {
  from: string;
  to: string;
  key: string;
}

export interface DependencyGraph {
  edges: DependencyEdge[];
  updatedAt: string;
}

export interface ChapterRender {
  chapterId: string;
  file: string;
  renderedAt: string;
  model: string;
  commitIds: string[];
  dirty: boolean;
}

export interface StoryProject {
  version: StorySchemaVersion;
  meta: StoryMeta;
  brief: StoryBrief;
  world: WorldState;
  characters: CharacterProfile[];
  timeline: TimelineBeat[];
  outline: ChapterPlan[];
  eventCommits: EventCommit[];
  inventory: InventoryItem[];
  foreshadows: ForeshadowEntry[];
  dependencyGraph: DependencyGraph;
  chapterRenders: ChapterRender[];
  ciHistory: StoryCiReport[];
  dirtyChapters: string[];
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
  kind:
    | "chat"
    | "story-bootstrap"
    | "story-refresh"
    | "story-commit"
    | "story-ci"
    | "story-render"
    | "story-compile";
  stage: string | null;
}

export type StoryRefreshScope = "all" | "world" | "characters" | "timeline" | "outline";
