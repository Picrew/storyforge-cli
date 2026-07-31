import React from "react";
import { Box, Text } from "ink";
import { copy } from "../content/copy.js";
import { themeTokens } from "../theme/tokens.js";
import {
  getDisplayWidth,
  truncateEndByWidth,
  wrapTextByWidth
} from "../utils/display-width.js";

interface InputFrameProps {
  width: number;
  value: string;
  cursorPosition: number;
}

const MAX_INPUT_LINES = 6;

interface CursorLineInfo {
  lines: string[];
  cursorLineIndex: number;
  cursorColOffset: number;
}

function charCount(str: string): number {
  return [...str].length;
}

function buildCursorLines(value: string, cursorPosition: number, lineWidth: number): CursorLineInfo {
  if (!value) {
    return { lines: [], cursorLineIndex: 0, cursorColOffset: 0 };
  }

  const totalChars = charCount(value);
  const safePos = Math.min(Math.max(0, cursorPosition), totalChars);
  const lines = wrapTextByWidth(value, lineWidth);

  // Walk through lines to find which visual line the cursor falls on
  let charIndex = 0;
  let cursorLineIndex = 0;
  let cursorColOffset = 0;
  let found = false;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const lineLen = charCount(lines[lineIndex]);

    if (charIndex + lineLen >= safePos && !found) {
      cursorLineIndex = lineIndex;
      // Count display width of characters before cursor on this line
      let widthAccum = 0;
      let charInLine = 0;

      for (const char of lines[lineIndex]) {
        if (charIndex + charInLine >= safePos) {
          break;
        }

        widthAccum += getDisplayWidth(char);
        charInLine += 1;
      }

      cursorColOffset = widthAccum;
      found = true;
      break;
    }

    charIndex += lineLen;

    // Account for newline character between paragraphs
    if (lineIndex < lines.length - 1) {
      // Check if next chars are newline
      let count = 0;

      for (const char of value) {
        if (count >= charIndex) {
          if (char === "\n") {
            charIndex += 1;
          }

          break;
        }

        count += 1;
      }
    }
  }

  // If cursor is at the very end, place it on the last line
  if (!found && safePos >= totalChars) {
    cursorLineIndex = lines.length - 1;
    cursorColOffset = getDisplayWidth(lines[lines.length - 1]);
  }

  return { lines, cursorLineIndex, cursorColOffset };
}

function splitAtDisplayWidth(line: string, targetWidth: number): { before: string; after: string } {
  let before = "";
  let widthSoFar = 0;

  for (const char of line) {
    if (widthSoFar >= targetWidth) {
      break;
    }

    before += char;
    widthSoFar += getDisplayWidth(char);
  }

  return { before, after: line.slice(before.length) };
}

function firstChar(str: string): string {
  for (const char of str) {
    return char;
  }

  return "";
}

function restChars(str: string): string {
  const first = firstChar(str);
  return first ? str.slice(first.length) : "";
}

export function InputFrame({ width, value, cursorPosition }: InputFrameProps): React.JSX.Element {
  const prompt = "> ";
  const innerWidth = Math.max(8, width - 6);
  const showHint = width >= 64;
  const divider = "-".repeat(Math.max(8, innerWidth));
  const contentWidth = Math.max(6, innerWidth - getDisplayWidth(prompt));

  if (!value) {
    const placeholder = truncateEndByWidth(copy.placeholder, contentWidth);

    return (
      <Box
        width={width}
        flexDirection="column"
        borderStyle="single"
        borderColor={themeTokens.border}
        paddingX={2}
      >
        <Box justifyContent={showHint ? "space-between" : "flex-start"}>
          <Text color={themeTokens.accentSecondary}>PROMPT LANE</Text>
          {showHint ? (
            <Text color={themeTokens.textSecondary}>↑↓ scroll / / commands / Enter sends / Esc exits</Text>
          ) : null}
        </Box>
        <Text color={themeTokens.border}>{divider}</Text>
        <Box>
          <Text color={themeTokens.accent}>{prompt}</Text>
          <Text color={themeTokens.textSecondary}>{placeholder}</Text>
        </Box>
      </Box>
    );
  }

  const { lines, cursorLineIndex, cursorColOffset } = buildCursorLines(value, cursorPosition, contentWidth);

  // If there are too many lines, show a window around the cursor line
  let visibleStart = 0;
  let visibleEnd = lines.length;

  if (lines.length > MAX_INPUT_LINES) {
    const half = Math.floor(MAX_INPUT_LINES / 2);
    visibleStart = Math.max(0, cursorLineIndex - half);
    visibleEnd = visibleStart + MAX_INPUT_LINES;

    if (visibleEnd > lines.length) {
      visibleEnd = lines.length;
      visibleStart = Math.max(0, visibleEnd - MAX_INPUT_LINES);
    }
  }

  const visibleLines = lines.slice(visibleStart, visibleEnd);
  const cursorVisibleIndex = cursorLineIndex - visibleStart;

  return (
    <Box
      width={width}
      flexDirection="column"
      borderStyle="single"
      borderColor={themeTokens.border}
      paddingX={2}
    >
      <Box justifyContent={showHint ? "space-between" : "flex-start"}>
        <Text color={themeTokens.accentSecondary}>PROMPT LANE</Text>
        {showHint ? (
          <Text color={themeTokens.textSecondary}>
            ←→ move / ↑↓ scroll / Enter sends / Esc exits
          </Text>
        ) : null}
      </Box>
      <Text color={themeTokens.border}>{divider}</Text>
      {visibleLines.map((line, index) => {
        const isCursorLine = index === cursorVisibleIndex;
        const linePrefix = index === 0 && visibleStart === 0 ? prompt : "  ";

        if (isCursorLine) {
          const { before, after } = splitAtDisplayWidth(line, cursorColOffset);
          const cursorChar = after.length > 0 ? firstChar(after) : " ";
          const remaining = after.length > 0 ? restChars(after) : "";

          return (
            <Box key={`input-line-${visibleStart + index}`}>
              <Text color={themeTokens.accent}>{linePrefix}</Text>
              <Text color={themeTokens.accent}>{before}</Text>
              <Text color={themeTokens.accent} inverse>{cursorChar}</Text>
              {remaining ? <Text color={themeTokens.accent}>{remaining}</Text> : null}
            </Box>
          );
        }

        return (
          <Box key={`input-line-${visibleStart + index}`}>
            <Text color={themeTokens.accent}>{linePrefix}</Text>
            <Text color={themeTokens.accent}>{line}</Text>
          </Box>
        );
      })}
      {lines.length > MAX_INPUT_LINES ? (
        <Text color={themeTokens.textSecondary}>
          {"  "}[{lines.length} lines · showing {visibleStart + 1}-{visibleEnd}]
        </Text>
      ) : null}
    </Box>
  );
}
