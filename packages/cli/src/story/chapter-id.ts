function padChapterNumber(value: number): string {
  return String(value).padStart(2, "0");
}

export function parseChapterNumber(chapterId: string): number | null {
  const match = /^ch(\d+)$/i.exec(chapterId.trim());

  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function normalizeChapterId(chapterId: string): string | null {
  const chapterNumber = parseChapterNumber(chapterId);

  if (chapterNumber === null) {
    return null;
  }

  return `ch${padChapterNumber(chapterNumber)}`;
}

export function formatChapterId(chapterNumber: number): string {
  const safeNumber = Math.max(1, Math.round(chapterNumber));
  return `ch${padChapterNumber(safeNumber)}`;
}

export function compareChapterIds(left: string, right: string): number {
  const leftNumber = parseChapterNumber(left);
  const rightNumber = parseChapterNumber(right);

  if (leftNumber === null && rightNumber === null) {
    return left.localeCompare(right);
  }

  if (leftNumber === null) {
    return 1;
  }

  if (rightNumber === null) {
    return -1;
  }

  return leftNumber - rightNumber;
}

export function parseChapterRange(token: string): string[] | null {
  const normalized = token.trim().toLowerCase();

  if (normalized.includes("..")) {
    const [startToken, endToken] = normalized.split("..");
    const start = parseChapterNumber(startToken);
    const end = parseChapterNumber(endToken);

    if (start === null || end === null || end < start) {
      return null;
    }

    return Array.from({ length: end - start + 1 }, (_, index) => formatChapterId(start + index));
  }

  const chapterId = normalizeChapterId(normalized);
  return chapterId ? [chapterId] : null;
}
