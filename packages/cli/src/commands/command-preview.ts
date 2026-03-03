export interface CommandPreviewItem {
  command: string;
  description: string;
  action: "connect" | "models" | "exit";
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
