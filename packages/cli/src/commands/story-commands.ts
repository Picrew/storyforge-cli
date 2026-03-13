import { randomUUID } from "node:crypto";
import { createBlankStoryProject } from "../story/project-store.js";
import {
  compareChapterIds,
  normalizeChapterId,
  parseChapterRange
} from "../story/chapter-id.js";
import type {
  ChapterPlan,
  CharacterProfile,
  StoryLibraryEntry,
  StoryProject,
  StoryRefreshScope,
  StoryView,
  TimelineBeat
} from "../story/types.js";

interface ParsedCommand {
  command: string;
  args: string[];
}

interface StoryCommandContext {
  currentProject: StoryProject | null;
  currentProjectId: string | null;
  projects: readonly StoryLibraryEntry[];
}

export interface StoryCommandNoticeResult {
  type: "notice";
  message: string;
}

export interface StoryCommandCreateResult {
  type: "create";
  message: string;
  activeView: StoryView;
  project: StoryProject;
}

export interface StoryCommandViewResult {
  type: "view";
  message: string;
  activeView: StoryView;
}

export interface StoryCommandMutateResult {
  type: "mutate";
  message: string;
  activeView: StoryView;
  project: StoryProject;
}

export interface StoryCommandRefreshResult {
  type: "refresh";
  message: string;
  activeView: StoryView;
  scope: StoryRefreshScope;
}

export interface StoryCommandLibraryResult {
  type: "library";
  message: string;
  response: string;
}

export interface StoryCommandOpenResult {
  type: "open";
  message: string;
  projectId: string;
}

export interface StoryCommandCommitResult {
  type: "commit";
  message: string;
  chapterId: string;
  eventText: string;
  patchFilePath: string | null;
  force: boolean;
}

export interface StoryCommandCiResult {
  type: "ci";
  message: string;
  scope: "all" | "commit";
  commitId: string | null;
}

export interface StoryCommandRenderResult {
  type: "render";
  message: string;
  chapterIds: string[];
  force: boolean;
  style: string | null;
}

export interface StoryCommandCompileResult {
  type: "compile";
  message: string;
  chapterIds: string[];
  outputPath: string | null;
}

export interface StoryCommandUnhandledResult {
  type: "not-handled";
}

export type StoryCommandResult =
  | StoryCommandNoticeResult
  | StoryCommandCreateResult
  | StoryCommandViewResult
  | StoryCommandMutateResult
  | StoryCommandRefreshResult
  | StoryCommandLibraryResult
  | StoryCommandOpenResult
  | StoryCommandCommitResult
  | StoryCommandCiResult
  | StoryCommandRenderResult
  | StoryCommandCompileResult
  | StoryCommandUnhandledResult;

function cloneProject(project: StoryProject): StoryProject {
  return {
    ...project,
    meta: { ...project.meta },
    brief: { ...project.brief },
    world: { ...project.world },
    characters: project.characters.map((entry) => ({ ...entry })),
    timeline: project.timeline.map((entry) => ({ ...entry })),
    outline: project.outline.map((entry) => ({ ...entry })),
    eventCommits: project.eventCommits.map((entry) => ({
      ...entry,
      patchOps: entry.patchOps.map((op) => ({
        ...op,
        payload: { ...op.payload }
      })),
      reads: [...entry.reads],
      writes: [...entry.writes],
      ciReport: entry.ciReport
        ? {
            ...entry.ciReport,
            errors: entry.ciReport.errors.map((issue) => ({ ...issue })),
            warnings: entry.ciReport.warnings.map((issue) => ({ ...issue }))
          }
        : null
    })),
    inventory: project.inventory.map((item) => ({
      ...item,
      holders: { ...item.holders }
    })),
    foreshadows: project.foreshadows.map((entry) => ({ ...entry })),
    dependencyGraph: {
      updatedAt: project.dependencyGraph.updatedAt,
      edges: project.dependencyGraph.edges.map((edge) => ({ ...edge }))
    },
    chapterRenders: project.chapterRenders.map((entry) => ({
      ...entry,
      commitIds: [...entry.commitIds]
    })),
    ciHistory: project.ciHistory.map((entry) => ({
      ...entry,
      errors: entry.errors.map((issue) => ({ ...issue })),
      warnings: entry.warnings.map((issue) => ({ ...issue }))
    })),
    dirtyChapters: [...project.dirtyChapters]
  };
}

function touchProject(project: StoryProject): StoryProject {
  return {
    ...project,
    meta: {
      ...project.meta,
      updatedAt: new Date().toISOString()
    }
  };
}

function withView(
  project: StoryProject,
  activeView: StoryView,
  message: string
): StoryCommandMutateResult {
  return {
    type: "mutate",
    message,
    activeView,
    project: touchProject(project)
  };
}

function requireProject(
  project: StoryProject | null,
  activeView: StoryView
): StoryCommandNoticeResult | StoryCommandViewResult {
  if (!project) {
    return {
      type: "notice",
      message: "Run /init first to create a story project."
    };
  }

  return {
    type: "view",
    activeView,
    message: `Showing ${activeView}.`
  };
}

function parseRow(value: string | undefined): number | null {
  const parsed = Number.parseInt(value ?? "", 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return null;
  }

  return parsed - 1;
}

function getRest(args: string[], startIndex: number): string {
  return args.slice(startIndex).join(" ").trim();
}

interface ParsedCommandFlags {
  positional: string[];
  booleanFlags: Set<string>;
  valueFlags: Map<string, string>;
}

const KNOWN_BOOLEAN_FLAGS = new Set(["force", "all", "visual"]);

function parseCommandFlags(args: readonly string[]): ParsedCommandFlags {
  const positional: string[] = [];
  const booleanFlags = new Set<string>();
  const valueFlags = new Map<string, string>();

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];

    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }

    const flagName = token.slice(2).toLowerCase();

    if (!flagName) {
      continue;
    }

    if (KNOWN_BOOLEAN_FLAGS.has(flagName)) {
      booleanFlags.add(flagName);
      continue;
    }

    const nextToken = args[index + 1];

    if (!nextToken || nextToken.startsWith("--")) {
      booleanFlags.add(flagName);
      continue;
    }

    valueFlags.set(flagName, nextToken);
    index += 1;
  }

  return {
    positional,
    booleanFlags,
    valueFlags
  };
}

function createBlankCharacter(name: string): CharacterProfile {
  return {
    id: randomUUID(),
    name,
    role: "",
    age: "",
    description: "",
    motivation: "",
    conflict: "",
    arc: "",
    relationships: "",
    tags: ""
  };
}

function createBlankTimelineBeat(label: string): TimelineBeat {
  return {
    id: randomUUID(),
    label,
    summary: "",
    chapterRef: "",
    stakes: "",
    notes: ""
  };
}

function createBlankChapterPlan(title: string, number: number): ChapterPlan {
  return {
    id: randomUUID(),
    number,
    title,
    purpose: "",
    summary: "",
    hook: "",
    targetWords: null
  };
}

function updateOutlineField(
  row: ChapterPlan,
  field: string,
  value: string
): ChapterPlan | null {
  const normalizedField = field.toLowerCase();

  switch (normalizedField) {
    case "number": {
      const parsed = Number.parseInt(value, 10);

      if (!Number.isFinite(parsed) || parsed < 1) {
        return null;
      }

      return {
        ...row,
        number: parsed
      };
    }
    case "title":
    case "purpose":
    case "summary":
    case "hook":
      return {
        ...row,
        [field]: value
      };
    case "targetwords":
    case "target_words": {
      if (!value) {
        return {
          ...row,
          targetWords: null
        };
      }

      const parsed = Number.parseInt(value, 10);

      if (!Number.isFinite(parsed) || parsed < 1) {
        return null;
      }

      return {
        ...row,
        targetWords: parsed
      };
    }
    default:
      return null;
  }
}

function updateCharacterField(
  row: CharacterProfile,
  field: string,
  value: string
): CharacterProfile | null {
  const normalizedField = field.toLowerCase();

  switch (normalizedField) {
    case "name":
    case "role":
    case "age":
    case "description":
    case "motivation":
    case "conflict":
    case "arc":
    case "relationships":
    case "tags":
      return {
        ...row,
        [normalizedField]: value
      };
    default:
      return null;
  }
}

function updateTimelineFieldNormalized(
  row: TimelineBeat,
  field: string,
  value: string
): TimelineBeat | null {
  const normalizedField = field.toLowerCase();

  switch (normalizedField) {
    case "label":
      return {
        ...row,
        label: value
      };
    case "summary":
      return {
        ...row,
        summary: value
      };
    case "chapterref":
    case "chapter_ref":
      return {
        ...row,
        chapterRef: value
      };
    case "stakes":
      return {
        ...row,
        stakes: value
      };
    case "notes":
      return {
        ...row,
        notes: value
      };
    default:
      return null;
  }
}

function getUntitledTitle(projects: readonly StoryLibraryEntry[]): string {
  const usedTitles = new Set(projects.map((entry) => entry.title));

  if (!usedTitles.has("Untitled Story")) {
    return "Untitled Story";
  }

  let suffix = 2;

  while (usedTitles.has(`Untitled Story ${suffix}`)) {
    suffix += 1;
  }

  return `Untitled Story ${suffix}`;
}

function buildProjectLibraryResponse(
  projects: readonly StoryLibraryEntry[],
  currentProjectId: string | null
): string {
  if (projects.length === 0) {
    return "No saved story projects yet.\nRun /init to create your first project.";
  }

  const lines = projects.map((entry, index) => {
    const marker = entry.id === currentProjectId ? "*" : " ";

    return `${String(index + 1).padStart(2, "0")}${marker} | ${entry.title} | ${entry.status} | ${entry.file}`;
  });

  return [`${projects.length} saved story project(s).`, ...lines].join("\n");
}

function getKnownChapterIds(project: StoryProject): string[] {
  const chapterIds = new Set<string>();

  for (const chapter of project.outline) {
    chapterIds.add(`ch${String(Math.max(1, chapter.number)).padStart(2, "0")}`);
  }

  for (const commit of project.eventCommits) {
    const chapterId = normalizeChapterId(commit.chapterId);

    if (chapterId) {
      chapterIds.add(chapterId);
    }
  }

  for (const chapterId of project.dirtyChapters) {
    const normalized = normalizeChapterId(chapterId);

    if (normalized) {
      chapterIds.add(normalized);
    }
  }

  for (const render of project.chapterRenders) {
    const chapterId = normalizeChapterId(render.chapterId);

    if (chapterId) {
      chapterIds.add(chapterId);
    }
  }

  return [...chapterIds].sort(compareChapterIds);
}

function buildStoryStatusResponse(project: StoryProject): string {
  const openForeshadows = project.foreshadows.filter((entry) => entry.status !== "resolved");
  const ciFailedCount = project.ciHistory.filter((entry) => !entry.passed).length;
  const inventoryErrors = project.ciHistory
    .flatMap((entry) => entry.errors)
    .filter((issue) => issue.rule === "inventory_conservation").length;

  const lines = [
    `Story: ${project.meta.title}`,
    `Commits: ${project.eventCommits.length}`,
    `Dirty chapters: ${project.dirtyChapters.length > 0 ? project.dirtyChapters.join(", ") : "none"}`,
    `Open foreshadows: ${openForeshadows.length}`,
    `Inventory issues (recent CI history): ${inventoryErrors}`,
    `CI failed runs: ${ciFailedCount}`,
    `Last CI: ${project.ciHistory[project.ciHistory.length - 1]?.ranAt ?? "never"}`
  ];

  return lines.join("\n");
}

function buildStoryLogResponse(
  project: StoryProject,
  options: {
    chapterId: string | null;
    limit: number;
    visual: boolean;
  }
): string {
  const commits = options.chapterId
    ? project.eventCommits.filter((entry) => normalizeChapterId(entry.chapterId) === options.chapterId)
    : project.eventCommits;
  const visibleCommits = commits.slice(-Math.max(1, options.limit));

  const lines: string[] = [];

  if (visibleCommits.length === 0) {
    lines.push("No event commits yet.");
  } else {
    lines.push(`Showing ${visibleCommits.length} commit(s).`);

    for (const entry of visibleCommits) {
      lines.push(
        `${entry.id.slice(0, 8)} | ${entry.chapterId} | ${entry.ciPassed ? "ci:pass" : "ci:fail"} | ${entry.message}`
      );
      lines.push(`reads: ${entry.reads.join(", ") || "-"}`);
      lines.push(`writes: ${entry.writes.join(", ") || "-"}`);
    }
  }

  if (options.visual) {
    lines.push("");
    lines.push("Dependency graph:");

    if (project.dependencyGraph.edges.length === 0) {
      lines.push("(empty)");
    } else {
      for (const edge of project.dependencyGraph.edges) {
        lines.push(`${edge.from} -> ${edge.to} [${edge.key}]`);
      }
    }
  }

  return lines.join("\n");
}

export function handleStoryCommand(
  context: StoryCommandContext,
  parsedCommand: ParsedCommand
): StoryCommandResult {
  switch (parsedCommand.command) {
    case "/init": {
      if (parsedCommand.args.length === 0) {
        const nextProject = createBlankStoryProject(undefined, getUntitledTitle(context.projects));
        nextProject.meta.status = "awaiting_brief";

        return {
          type: "create",
          message: "Blank story project created. Enter the brief next.",
          activeView: "world",
          project: nextProject
        };
      }

      if (parsedCommand.args[0] === "reset" && parsedCommand.args.length === 1) {
        if (!context.currentProject) {
          return {
            type: "notice",
            message: "Run /init first to create a story project."
          };
        }

        const nextProject = createBlankStoryProject(
          undefined,
          context.currentProject.meta.title || getUntitledTitle(context.projects)
        );
        nextProject.meta.status = "awaiting_brief";

        return withView(nextProject, "world", "Current story project reset. Enter the new brief next.");
      }

      if (parsedCommand.args[0] === "refresh") {
        if (!context.currentProject) {
          return {
            type: "notice",
            message: "Run /init first to create a story project."
          };
        }

        if (!context.currentProject.brief.seedPrompt.trim()) {
          return {
            type: "notice",
            message: "No saved story brief was found. Enter a brief after /init first."
          };
        }

        if (parsedCommand.args.length === 1) {
          return {
            type: "refresh",
            message: "Refreshing all story tables...",
            activeView: "world",
            scope: "all"
          };
        }

        if (parsedCommand.args.length === 2) {
          const scopeMap: Record<string, Exclude<StoryRefreshScope, "all">> = {
            world: "world",
            char: "characters",
            characters: "characters",
            timeline: "timeline",
            outline: "outline"
          };
          const scope = scopeMap[parsedCommand.args[1]];

          if (!scope) {
            return {
              type: "notice",
              message: "Usage: /init refresh [world|char|timeline|outline]"
            };
          }

          return {
            type: "refresh",
            message: `Refreshing ${scope === "characters" ? "characters" : scope}...`,
            activeView: scope === "characters" ? "characters" : scope,
            scope
          };
        }

        return {
          type: "notice",
          message: "Usage: /init refresh [world|char|timeline|outline]"
        };
      }

      return {
        type: "notice",
        message: "Usage: /init | /init reset | /init refresh [world|char|timeline|outline]"
      };
    }

    case "/projects":
    case "/project": {
      if (parsedCommand.args.length === 0) {
        return {
          type: "library",
          message: context.projects.length > 0
            ? "Showing saved story projects."
            : "No saved story projects yet.",
          response: buildProjectLibraryResponse(context.projects, context.currentProjectId)
        };
      }

      if (parsedCommand.args[0] === "open" && parsedCommand.args.length === 2) {
        const rowIndex = parseRow(parsedCommand.args[1]);

        if (rowIndex === null || !context.projects[rowIndex]) {
          return {
            type: "notice",
            message: "Project row is out of range."
          };
        }

        const selectedProject = context.projects[rowIndex];

        if (selectedProject.id === context.currentProjectId) {
          return {
            type: "notice",
            message: `${selectedProject.title} is already active.`
          };
        }

        return {
          type: "open",
          message: `Opened ${selectedProject.title}.`,
          projectId: selectedProject.id
        };
      }

      return {
        type: "notice",
        message: "Usage: /projects | /projects open <row>"
      };
    }

    case "/world": {
      if (parsedCommand.args.length === 0) {
        return requireProject(context.currentProject, "world");
      }

      if (!context.currentProject) {
        return {
          type: "notice",
          message: "Run /init first to create a story project."
        };
      }

      if (parsedCommand.args[0] !== "set" || parsedCommand.args.length < 3) {
        return {
          type: "notice",
          message: "Usage: /world | /world set <field> <value...>"
        };
      }

      const rawField = parsedCommand.args[1];
      const value = getRest(parsedCommand.args, 2);
      const nextProject = cloneProject(context.currentProject);
      const worldFieldMap = new Map(
        Object.keys(nextProject.world).map((key) => [key.toLowerCase(), key])
      );
      const resolvedField = worldFieldMap.get(rawField.toLowerCase());

      if (!resolvedField) {
        return {
          type: "notice",
          message: `Unknown world field: ${rawField}`
        };
      }

      nextProject.world = {
        ...nextProject.world,
        [resolvedField]: value
      };

      return withView(nextProject, "world", `Updated world.${resolvedField}.`);
    }

    case "/char": {
      if (parsedCommand.args.length === 0) {
        return requireProject(context.currentProject, "characters");
      }

      if (!context.currentProject) {
        return {
          type: "notice",
          message: "Run /init first to create a story project."
        };
      }

      const nextProject = cloneProject(context.currentProject);
      const action = parsedCommand.args[0];

      if (action === "add" && parsedCommand.args.length >= 2) {
        nextProject.characters.push(createBlankCharacter(getRest(parsedCommand.args, 1)));
        return withView(nextProject, "characters", "Character added.");
      }

      if (action === "rm" && parsedCommand.args.length === 2) {
        const rowIndex = parseRow(parsedCommand.args[1]);

        if (rowIndex === null || !nextProject.characters[rowIndex]) {
          return {
            type: "notice",
            message: "Character row is out of range."
          };
        }

        nextProject.characters.splice(rowIndex, 1);
        return withView(nextProject, "characters", "Character removed.");
      }

      if (action === "set" && parsedCommand.args.length >= 4) {
        const rowIndex = parseRow(parsedCommand.args[1]);
        const field = parsedCommand.args[2];
        const value = getRest(parsedCommand.args, 3);

        if (rowIndex === null || !nextProject.characters[rowIndex]) {
          return {
            type: "notice",
            message: "Character row is out of range."
          };
        }

        const updatedRow = updateCharacterField(nextProject.characters[rowIndex], field, value);

        if (!updatedRow) {
          return {
            type: "notice",
            message: `Unknown character field: ${field}`
          };
        }

        nextProject.characters[rowIndex] = updatedRow;
        return withView(nextProject, "characters", `Updated character ${rowIndex + 1}.`);
      }

      return {
        type: "notice",
        message: "Usage: /char | /char add <name...> | /char set <row> <field> <value...> | /char rm <row>"
      };
    }

    case "/timeline": {
      if (parsedCommand.args.length === 0) {
        return requireProject(context.currentProject, "timeline");
      }

      if (!context.currentProject) {
        return {
          type: "notice",
          message: "Run /init first to create a story project."
        };
      }

      const nextProject = cloneProject(context.currentProject);
      const action = parsedCommand.args[0];

      if (action === "add" && parsedCommand.args.length >= 2) {
        nextProject.timeline.push(createBlankTimelineBeat(getRest(parsedCommand.args, 1)));
        return withView(nextProject, "timeline", "Timeline beat added.");
      }

      if (action === "rm" && parsedCommand.args.length === 2) {
        const rowIndex = parseRow(parsedCommand.args[1]);

        if (rowIndex === null || !nextProject.timeline[rowIndex]) {
          return {
            type: "notice",
            message: "Timeline row is out of range."
          };
        }

        nextProject.timeline.splice(rowIndex, 1);
        return withView(nextProject, "timeline", "Timeline beat removed.");
      }

      if (action === "set" && parsedCommand.args.length >= 4) {
        const rowIndex = parseRow(parsedCommand.args[1]);
        const field = parsedCommand.args[2];
        const value = getRest(parsedCommand.args, 3);

        if (rowIndex === null || !nextProject.timeline[rowIndex]) {
          return {
            type: "notice",
            message: "Timeline row is out of range."
          };
        }

        const updatedRow = updateTimelineFieldNormalized(nextProject.timeline[rowIndex], field, value);

        if (!updatedRow) {
          return {
            type: "notice",
            message: `Unknown timeline field: ${field}`
          };
        }

        nextProject.timeline[rowIndex] = updatedRow;
        return withView(nextProject, "timeline", `Updated timeline beat ${rowIndex + 1}.`);
      }

      return {
        type: "notice",
        message: "Usage: /timeline | /timeline add <event...> | /timeline set <row> <field> <value...> | /timeline rm <row>"
      };
    }

    case "/outline": {
      if (parsedCommand.args.length === 0) {
        return requireProject(context.currentProject, "outline");
      }

      if (!context.currentProject) {
        return {
          type: "notice",
          message: "Run /init first to create a story project."
        };
      }

      const nextProject = cloneProject(context.currentProject);
      const action = parsedCommand.args[0];

      if (action === "add" && parsedCommand.args.length >= 2) {
        const title = getRest(parsedCommand.args, 1);
        const nextNumber = nextProject.outline.length > 0
          ? Math.max(...nextProject.outline.map((entry) => entry.number)) + 1
          : 1;

        nextProject.outline.push(createBlankChapterPlan(title, nextNumber));
        return withView(nextProject, "outline", "Outline chapter added.");
      }

      if (action === "rm" && parsedCommand.args.length === 2) {
        const rowIndex = parseRow(parsedCommand.args[1]);

        if (rowIndex === null || !nextProject.outline[rowIndex]) {
          return {
            type: "notice",
            message: "Outline row is out of range."
          };
        }

        nextProject.outline.splice(rowIndex, 1);
        return withView(nextProject, "outline", "Outline chapter removed.");
      }

      if (action === "set" && parsedCommand.args.length >= 4) {
        const rowIndex = parseRow(parsedCommand.args[1]);
        const field = parsedCommand.args[2];
        const value = getRest(parsedCommand.args, 3);

        if (rowIndex === null || !nextProject.outline[rowIndex]) {
          return {
            type: "notice",
            message: "Outline row is out of range."
          };
        }

        const updatedRow = updateOutlineField(nextProject.outline[rowIndex], field, value);

        if (!updatedRow) {
          return {
            type: "notice",
            message: `Unknown outline field: ${field}`
          };
        }

        nextProject.outline[rowIndex] = updatedRow;
        return withView(nextProject, "outline", `Updated outline row ${rowIndex + 1}.`);
      }

      return {
        type: "notice",
        message: "Usage: /outline | /outline add <title...> | /outline set <row> <field> <value...> | /outline rm <row>"
      };
    }

    case "/commit": {
      if (!context.currentProject) {
        return {
          type: "notice",
          message: "Run /init first to create a story project."
        };
      }

      const parsed = parseCommandFlags(parsedCommand.args);
      const chapterId = normalizeChapterId(parsed.valueFlags.get("chapter") ?? "");
      const patchFilePath = parsed.valueFlags.get("patch-file")?.trim() || null;
      const force = parsed.booleanFlags.has("force");
      const eventText = parsed.positional.join(" ").trim();

      if (!chapterId) {
        return {
          type: "notice",
          message: "Usage: /commit --chapter chNN <event_text> [--force] | /commit --chapter chNN --patch-file <json_path>"
        };
      }

      if (!patchFilePath && !eventText) {
        return {
          type: "notice",
          message: "Event text is required when --patch-file is not provided."
        };
      }

      return {
        type: "commit",
        message: `Committing event patch for ${chapterId}...`,
        chapterId,
        eventText,
        patchFilePath,
        force
      };
    }

    case "/status": {
      if (!context.currentProject) {
        return {
          type: "notice",
          message: "Run /init first to create a story project."
        };
      }

      if (parsedCommand.args.length > 0) {
        return {
          type: "notice",
          message: "Usage: /status"
        };
      }

      return {
        type: "library",
        message: "Story health snapshot.",
        response: buildStoryStatusResponse(context.currentProject)
      };
    }

    case "/log": {
      if (!context.currentProject) {
        return {
          type: "notice",
          message: "Run /init first to create a story project."
        };
      }

      const parsed = parseCommandFlags(parsedCommand.args);
      const chapterIdRaw = parsed.valueFlags.get("chapter");
      const chapterId = chapterIdRaw ? normalizeChapterId(chapterIdRaw) : null;
      const limitRaw = parsed.valueFlags.get("limit");
      const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 20;

      if (chapterIdRaw && !chapterId) {
        return {
          type: "notice",
          message: "Usage: /log [--chapter chNN] [--limit N] [--visual]"
        };
      }

      if (!Number.isFinite(limit) || limit < 1) {
        return {
          type: "notice",
          message: "Log limit must be a positive integer."
        };
      }

      return {
        type: "library",
        message: "Story event log.",
        response: buildStoryLogResponse(context.currentProject, {
          chapterId,
          limit,
          visual: parsed.booleanFlags.has("visual")
        })
      };
    }

    case "/ci": {
      if (!context.currentProject) {
        return {
          type: "notice",
          message: "Run /init first to create a story project."
        };
      }

      if (parsedCommand.args[0] !== "run") {
        return {
          type: "notice",
          message: "Usage: /ci run [--all|--commit <id>]"
        };
      }

      const parsed = parseCommandFlags(parsedCommand.args.slice(1));
      const commitId = parsed.valueFlags.get("commit")?.trim() || null;

      if (parsed.booleanFlags.has("all") && commitId) {
        return {
          type: "notice",
          message: "Choose either --all or --commit <id>, not both."
        };
      }

      return {
        type: "ci",
        message: "Running story CI...",
        scope: commitId ? "commit" : "all",
        commitId
      };
    }

    case "/render": {
      if (!context.currentProject) {
        return {
          type: "notice",
          message: "Run /init first to create a story project."
        };
      }

      const parsed = parseCommandFlags(parsedCommand.args);

      if (parsed.positional.length !== 1) {
        return {
          type: "notice",
          message: "Usage: /render <chNN|chNN..chMM|all> [--force] [--style <name>]"
        };
      }

      const rangeToken = parsed.positional[0].toLowerCase();
      const chapterIds = rangeToken === "all"
        ? getKnownChapterIds(context.currentProject)
        : parseChapterRange(rangeToken);

      if (!chapterIds || chapterIds.length === 0) {
        return {
          type: "notice",
          message: "Render range is invalid."
        };
      }

      return {
        type: "render",
        message: `Rendering ${chapterIds.length} chapter(s)...`,
        chapterIds,
        force: parsed.booleanFlags.has("force"),
        style: parsed.valueFlags.get("style")?.trim() || null
      };
    }

    case "/compile": {
      if (!context.currentProject) {
        return {
          type: "notice",
          message: "Run /init first to create a story project."
        };
      }

      const parsed = parseCommandFlags(parsedCommand.args);
      const rangeToken = parsed.positional[0]?.toLowerCase() ?? "all";
      const chapterIds = rangeToken === "all"
        ? getKnownChapterIds(context.currentProject)
        : parseChapterRange(rangeToken);

      if (!chapterIds || chapterIds.length === 0) {
        return {
          type: "notice",
          message: "Compile range is invalid."
        };
      }

      return {
        type: "compile",
        message: `Compiling ${chapterIds.length} chapter(s)...`,
        chapterIds,
        outputPath: parsed.valueFlags.get("output")?.trim() || null
      };
    }

    default:
      return {
        type: "not-handled"
      };
  }
}
