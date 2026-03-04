import { randomUUID } from "node:crypto";
import { createBlankStoryProject } from "../story/project-store.js";
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
  | StoryCommandUnhandledResult;

function cloneProject(project: StoryProject): StoryProject {
  return {
    ...project,
    meta: { ...project.meta },
    brief: { ...project.brief },
    world: { ...project.world },
    characters: project.characters.map((entry) => ({ ...entry })),
    timeline: project.timeline.map((entry) => ({ ...entry })),
    outline: project.outline.map((entry) => ({ ...entry }))
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

function updateOutlineField(
  row: ChapterPlan,
  field: string,
  value: string
): ChapterPlan | null {
  switch (field) {
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
  switch (field) {
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
        [field]: value
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
  switch (field) {
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

      const field = parsedCommand.args[1];
      const value = getRest(parsedCommand.args, 2);
      const nextProject = cloneProject(context.currentProject);

      if (!(field in nextProject.world)) {
        return {
          type: "notice",
          message: `Unknown world field: ${field}`
        };
      }

      nextProject.world = {
        ...nextProject.world,
        [field]: value
      };

      return withView(nextProject, "world", `Updated world.${field}.`);
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

      if (parsedCommand.args[0] === "rm" && parsedCommand.args.length === 2) {
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

      if (parsedCommand.args[0] === "set" && parsedCommand.args.length >= 4) {
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
        message: "Usage: /outline | /outline set <row> <field> <value...> | /outline rm <row>"
      };
    }

    default:
      return {
        type: "not-handled"
      };
  }
}
