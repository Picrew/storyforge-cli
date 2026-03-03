function isWideCodePoint(codePoint: number): boolean {
  return (
    codePoint >= 0x1100 &&
    (
      codePoint <= 0x115f ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6)
    )
  );
}

export function getDisplayWidth(value: string): number {
  let width = 0;

  for (const char of value) {
    const codePoint = char.codePointAt(0);
    width += codePoint && isWideCodePoint(codePoint) ? 2 : 1;
  }

  return width;
}

export function truncateStartByWidth(value: string, maxWidth: number): string {
  if (maxWidth <= 0) {
    return "";
  }

  if (getDisplayWidth(value) <= maxWidth) {
    return value;
  }

  if (maxWidth <= 3) {
    let result = "";

    for (const char of [...value].reverse()) {
      const next = `${char}${result}`;

      if (getDisplayWidth(next) > maxWidth) {
        break;
      }

      result = next;
    }

    return result;
  }

  const targetWidth = maxWidth - 3;
  let result = "";

  for (const char of [...value].reverse()) {
    const next = `${char}${result}`;

    if (getDisplayWidth(next) > targetWidth) {
      break;
    }

    result = next;
  }

  return `...${result}`;
}

export function truncateEndByWidth(value: string, maxWidth: number): string {
  if (maxWidth <= 0) {
    return "";
  }

  if (getDisplayWidth(value) <= maxWidth) {
    return value;
  }

  if (maxWidth <= 3) {
    let result = "";

    for (const char of value) {
      const next = `${result}${char}`;

      if (getDisplayWidth(next) > maxWidth) {
        break;
      }

      result = next;
    }

    return result;
  }

  const targetWidth = maxWidth - 3;
  let result = "";

  for (const char of value) {
    const next = `${result}${char}`;

    if (getDisplayWidth(next) > targetWidth) {
      break;
    }

    result = next;
  }

  return `${result}...`;
}

export function wrapTextByWidth(value: string, maxWidth: number): string[] {
  if (maxWidth <= 0) {
    return [""];
  }

  const lines: string[] = [];

  for (const paragraph of value.split("\n")) {
    if (!paragraph) {
      lines.push("");
      continue;
    }

    let currentLine = "";

    for (const char of paragraph) {
      const nextLine = `${currentLine}${char}`;

      if (getDisplayWidth(nextLine) > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = char;
        continue;
      }

      currentLine = nextLine;
    }

    lines.push(currentLine);
  }

  return lines.length > 0 ? lines : [""];
}
