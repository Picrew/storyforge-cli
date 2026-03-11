export interface CommandPreviewItem {
  command: string;
  description: string;
  action:
    | "connect"
    | "models"
    | "init"
    | "projects"
    | "commit"
    | "status"
    | "log"
    | "ci"
    | "render"
    | "compile"
    | "world"
    | "characters"
    | "timeline"
    | "outline"
    | "exit";
  aliases?: readonly string[];
}

const commandPreviewItems: readonly CommandPreviewItem[] = [
  {
    command: "/connect",
    description: "Connect provider",
    action: "connect"
  },
  {
    command: "/models",
    description: "Switch model",
    action: "models",
    aliases: ["/model"]
  },
  {
    command: "/init",
    description: "Create or refresh a story project",
    action: "init"
  },
  {
    command: "/projects",
    description: "List or open saved story projects",
    action: "projects",
    aliases: ["/project"]
  },
  {
    command: "/commit",
    description: "Commit event patch into world state",
    action: "commit"
  },
  {
    command: "/status",
    description: "Show narrative health metrics",
    action: "status"
  },
  {
    command: "/log",
    description: "Show event timeline and dependencies",
    action: "log"
  },
  {
    command: "/ci",
    description: "Run deterministic story CI checks",
    action: "ci"
  },
  {
    command: "/render",
    description: "Render chapter text from state snapshot",
    action: "render"
  },
  {
    command: "/compile",
    description: "Compile rendered chapters into manuscript",
    action: "compile"
  },
  {
    command: "/world",
    description: "Show or edit world state",
    action: "world"
  },
  {
    command: "/char",
    description: "Show or edit characters",
    action: "characters"
  },
  {
    command: "/timeline",
    description: "Show or edit timeline beats",
    action: "timeline"
  },
  {
    command: "/outline",
    description: "Show or edit chapter plan",
    action: "outline"
  },
  {
    command: "/exit",
    description: "Exit the app",
    action: "exit"
  }
];

function getCommandToken(inputValue: string): string | null {
  const trimmed = inputValue.trimStart();

  if (!trimmed.startsWith("/")) {
    return null;
  }

  if (/\s/.test(trimmed)) {
    return null;
  }

  return trimmed.toLowerCase();
}

function getPreviewCandidates(item: CommandPreviewItem): readonly string[] {
  return item.aliases ? [item.command, ...item.aliases] : [item.command];
}

function getCommandMatchScore(query: string, item: CommandPreviewItem): number {
  return Math.max(...getPreviewCandidates(item).map((candidate) => scoreMatch(query, candidate)));
}

function scoreMatch(query: string, candidate: string): number {
  if (!query || query === "/") {
    return 1;
  }

  if (candidate.startsWith(query)) {
    return 100 - (candidate.length - query.length);
  }

  let queryIndex = 0;
  let penalty = 0;

  for (let index = 0; index < candidate.length && queryIndex < query.length; index += 1) {
    if (candidate[index] === query[queryIndex]) {
      queryIndex += 1;
    } else {
      penalty += 1;
    }
  }

  if (queryIndex === query.length) {
    return Math.max(5, 50 - penalty);
  }

  return 0;
}

export function shouldShowCommandPreview(inputValue: string): boolean {
  const token = getCommandToken(inputValue);

  if (!token) {
    return false;
  }

  return commandPreviewItems.some((item) => getCommandMatchScore(token, item) > 0);
}

export function getCommandPreviewItems(inputValue: string): readonly CommandPreviewItem[] {
  const token = getCommandToken(inputValue);

  if (!token) {
    return [];
  }

  return commandPreviewItems
    .map((item) => ({
      item,
      score: getCommandMatchScore(token, item)
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }

      return 0;
    })
    .map(({ item }) => item);
}

export function getCommandAutocompleteValue(
  inputValue: string,
  selectedIndex: number
): string | null {
  const matches = getCommandPreviewItems(inputValue);

  if (matches.length === 0) {
    return null;
  }

  const selectedItem = matches[Math.min(selectedIndex, matches.length - 1)];
  return `${selectedItem.command} `;
}

export function getSelectedCommandPreviewItem(
  inputValue: string,
  selectedIndex: number
): CommandPreviewItem | null {
  const matches = getCommandPreviewItems(inputValue);

  if (matches.length === 0) {
    return null;
  }

  return matches[Math.min(selectedIndex, matches.length - 1)];
}

export function isExitCommand(inputValue: string): boolean {
  return inputValue.trim() === "/exit";
}
